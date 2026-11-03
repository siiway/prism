// A self-signed X.509 certificate for SAML metadata and signatures.
//
// SAML carries the signing key as an X.509 certificate, and WebCrypto can't
// make one, so this DER-encodes the few structures a minimal certificate
// needs (RFC 5280). Service providers use the certificate only as a key
// container: they trust it because it's in Prism's metadata, not because of
// who signed it.
//
// The certificate is a pure function of the key pair and host name: the
// serial is derived from the public key, the validity dates are fixed, and
// RSASSA-PKCS1-v1_5 signatures are deterministic. Every isolate therefore
// builds the same certificate, so nothing has to be stored and the one a
// service provider imported keeps matching the one in each response.

const SHA256_WITH_RSA = "1.2.840.113549.1.1.11";
const COMMON_NAME = "2.5.4.3";

// Fixed validity. 2049 is the last year UTCTime can encode, which every
// X.509 parser accepts; SAML service providers don't enforce expiry of a
// certificate they pinned from metadata anyway.
const NOT_BEFORE = Date.UTC(2025, 0, 1);
const NOT_AFTER = Date.UTC(2049, 11, 31, 23, 59, 59);

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function tlv(tag: number, ...contents: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const body = concat(contents);
  const n = body.length;
  let length: number[];
  if (n < 0x80) length = [n];
  else {
    const bytes: number[] = [];
    for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
    length = [0x80 | bytes.length, ...bytes];
  }
  return concat([new Uint8Array([tag, ...length]), body]);
}

const seq = (...items: Uint8Array[]) => tlv(0x30, ...items);
const set = (...items: Uint8Array[]) => tlv(0x31, ...items);
const NULL = new Uint8Array([0x05, 0x00]);

/** A non-negative INTEGER from big-endian magnitude bytes. */
function integer(bytes: Uint8Array): Uint8Array {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i++;
  const trimmed = bytes.slice(i);
  // A leading 1 bit would read as negative; pad with a zero byte.
  return tlv(
    0x02,
    trimmed[0] & 0x80 ? concat([new Uint8Array([0]), trimmed]) : trimmed,
  );
}

function oid(dotted: string): Uint8Array {
  const [a, b, ...rest] = dotted.split(".").map(Number);
  const bytes = [a * 40 + b];
  for (const n of rest) {
    const chunk: number[] = [n & 0x7f];
    for (let v = Math.floor(n / 128); v > 0; v = Math.floor(v / 128))
      chunk.unshift(0x80 | (v & 0x7f));
    bytes.push(...chunk);
  }
  return tlv(0x06, new Uint8Array(bytes));
}

function utcTime(ms: number): Uint8Array {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, "0");
  const s =
    two(d.getUTCFullYear() % 100) +
    two(d.getUTCMonth() + 1) +
    two(d.getUTCDate()) +
    two(d.getUTCHours()) +
    two(d.getUTCMinutes()) +
    two(d.getUTCSeconds()) +
    "Z";
  return tlv(0x17, new TextEncoder().encode(s));
}

function name(commonName: string): Uint8Array {
  return seq(
    set(seq(oid(COMMON_NAME), tlv(0x0c, new TextEncoder().encode(commonName)))),
  );
}

/**
 * DER bytes of a self-signed certificate for `publicKey`, signed with
 * `privateKey` (RSASSA-PKCS1-v1_5 / SHA-256), issued to `commonName`.
 */
export async function selfSignedCertificate(
  publicKey: CryptoKey,
  privateKey: CryptoKey,
  commonName: string,
): Promise<Uint8Array> {
  const spki = new Uint8Array(
    (await crypto.subtle.exportKey("spki", publicKey)) as ArrayBuffer,
  );
  // Serial: the first 16 bytes of the key's SHA-256, made positive and
  // non-zero (RFC 5280 §4.1.2.2 caps serials at 20 octets).
  const serial = new Uint8Array(await crypto.subtle.digest("SHA-256", spki))
    .slice(0, 16)
    .map((b, i) => (i === 0 ? (b & 0x7f) | 0x01 : b));
  const algorithm = seq(oid(SHA256_WITH_RSA), NULL);
  const subject = name(commonName);

  const tbs = seq(
    tlv(0xa0, integer(new Uint8Array([2]))), // [0] EXPLICIT version v3
    integer(serial),
    algorithm,
    subject, // issuer: self-signed
    seq(utcTime(NOT_BEFORE), utcTime(NOT_AFTER)),
    subject,
    spki,
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, tbs),
  );
  // BIT STRING: a leading byte for the unused-bit count (none).
  return seq(tbs, algorithm, tlv(0x03, new Uint8Array([0]), signature));
}

/** PEM text for DER certificate bytes, as operators paste it into SPs. */
export function toPem(der: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...der));
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
}
