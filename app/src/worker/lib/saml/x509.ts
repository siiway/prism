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

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** PEM text for DER certificate bytes, as operators paste it into SPs. */
export function toPem(der: Uint8Array): string {
  const b64 = bytesToBase64(der);
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

/** Base64 as it appears in XML or a query value: whitespace allowed, and a
 *  '+' that arrived as a space (left unescaped in a query) put back. */
export function decodeBase64(text: string): Uint8Array<ArrayBuffer> {
  return base64ToBytes(text.replace(/ /g, "+").replace(/\s+/g, ""));
}

// ─── Reading certificates ────────────────────────────────────────────────────
//
// An SP's signing certificate, like Prism's own, is only a key container:
// what matters is its public key, trusted because an app owner pasted it.

/** A pasted certificate is at most this long; real ones are 1-3 KiB. */
const MAX_CERTIFICATE_TEXT = 16 * 1024;

// Key algorithm OIDs (RFC 3279, RFC 5480), as their encoded bytes.
const RSA_ENCRYPTION = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01];
const EC_PUBLIC_KEY = [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01];
const CURVES: Array<{ oid: number[]; curve: EcCurve }> = [
  { oid: [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07], curve: "P-256" },
  { oid: [0x2b, 0x81, 0x04, 0x00, 0x22], curve: "P-384" },
  { oid: [0x2b, 0x81, 0x04, 0x00, 0x23], curve: "P-521" },
];

export type EcCurve = "P-256" | "P-384" | "P-521";

/** A certificate's public key: its SubjectPublicKeyInfo (DER), and what
 *  kind of key it is. */
type CertificateKey =
  | { kind: "rsa"; spki: Uint8Array }
  | { kind: "ec"; curve: EcCurve; spki: Uint8Array };

/**
 * DER bytes of a certificate pasted as PEM, or as the bare base64 that SAML
 * metadata holds in ds:X509Certificate; null when it isn't one with an RSA
 * or EC key.
 */
export function certificateFromText(text: string): Uint8Array | null {
  if (text.length > MAX_CERTIFICATE_TEXT) return null;
  const b64 = text
    .replace(/-----(BEGIN|END) CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  let der: Uint8Array;
  try {
    der = base64ToBytes(b64);
  } catch {
    return null;
  }
  return certificateKey(der) ? der : null;
}

interface Tlv {
  tag: number;
  /** Offset of the tag byte. */
  offset: number;
  /** Offset of the contents. */
  start: number;
  /** Offset just past the contents. */
  end: number;
}

function readTlv(der: Uint8Array, offset: number, limit: number): Tlv | null {
  if (offset + 2 > limit) return null;
  const tag = der[offset];
  let length = der[offset + 1];
  let start = offset + 2;
  if (length & 0x80) {
    const n = length & 0x7f;
    if (n === 0 || n > 4 || start + n > limit) return null;
    length = 0;
    for (let i = 0; i < n; i++) length = length * 256 + der[start++];
  }
  const end = start + length;
  return end <= limit ? { tag, offset, start, end } : null;
}

/** The child elements of a constructed TLV, or null when they don't parse. */
function children(der: Uint8Array, parent: Tlv): Tlv[] | null {
  const out: Tlv[] = [];
  for (let p = parent.start; p < parent.end;) {
    const child = readTlv(der, p, parent.end);
    if (!child) return null;
    out.push(child);
    p = child.end;
  }
  return out;
}

const isOid = (der: Uint8Array, t: Tlv | undefined, oid: number[]) =>
  t?.tag === 0x06 &&
  t.end - t.start === oid.length &&
  oid.every((b, i) => der[t.start + i] === b);

/**
 * The public key of an X.509 certificate with an RSA key or an EC key on
 * P-256, P-384 or P-521; null when `der` isn't one (RFC 5280 §4.1).
 */
export function certificateKey(der: Uint8Array): CertificateKey | null {
  const certificate = readTlv(der, 0, der.length);
  if (
    !certificate ||
    certificate.tag !== 0x30 ||
    certificate.end !== der.length
  )
    return null;
  const [tbs] = children(der, certificate) ?? [];
  if (tbs?.tag !== 0x30) return null;
  const fields = children(der, tbs);
  if (!fields) return null;
  // version [0] is optional; then serial, signature, issuer, validity,
  // subject and subjectPublicKeyInfo.
  const rest = fields[0]?.tag === 0xa0 ? fields.slice(1) : fields;
  const spkiTlv = rest[5];
  if (spkiTlv?.tag !== 0x30) return null;
  const [algorithm, key] = children(der, spkiTlv) ?? [];
  if (algorithm?.tag !== 0x30 || key?.tag !== 0x03) return null;
  const [oid, params] = children(der, algorithm) ?? [];
  const spki = der.slice(spkiTlv.offset, spkiTlv.end);
  if (isOid(der, oid, RSA_ENCRYPTION)) return { kind: "rsa", spki };
  if (isOid(der, oid, EC_PUBLIC_KEY)) {
    const curve = CURVES.find((c) => isOid(der, params, c.oid))?.curve;
    return curve ? { kind: "ec", curve, spki } : null;
  }
  return null;
}

/**
 * An ECDSA signature as WebCrypto takes it, r and s side by side, `size`
 * bytes each, from a DER Ecdsa-Sig-Value (SEQUENCE of two INTEGERs);
 * null when `der` isn't one.
 */
export function ecdsaSignatureFromDer(
  der: Uint8Array,
  size: number,
): Uint8Array | null {
  const seqTlv = readTlv(der, 0, der.length);
  if (seqTlv?.tag !== 0x30 || seqTlv.end !== der.length) return null;
  const ints = children(der, seqTlv);
  if (ints?.length !== 2 || ints.some((t) => t.tag !== 0x02)) return null;
  const out = new Uint8Array(size * 2);
  for (const [i, t] of ints.entries()) {
    // Drop the sign byte(s); what's left must fit, right-aligned.
    let start = t.start;
    while (start < t.end - 1 && der[start] === 0) start++;
    const length = t.end - start;
    if (length > size) return null;
    out.set(der.subarray(start, t.end), i * size + size - length);
  }
  return out;
}
