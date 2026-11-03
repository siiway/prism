// Signatures on SAML messages from service providers, checked against the
// certificate on file for the SP, never a key the message carries.
//
// HTTP-Redirect: the query string is signed (SAML Bindings §3.4.4.1).
// HTTP-POST: an enveloped XML Signature on the message's root element.
//
// Only the shape SAML signatures take is accepted: exactly one ds:Signature,
// a direct child of the root, with one Reference to the root by its ID, the
// enveloped-signature and exclusive c14n transforms, and RSA or ECDSA with
// SHA-256 or stronger, matching the certificate's key. Prism reads every
// field from that root, so a signature over some other element (signature
// wrapping) never vouches for what it reads.

import type { Element, Node } from "@xmldom/xmldom";
import {
  base64ToBytes,
  certificateKey,
  ecdsaSignatureFromDer,
  type EcCurve,
} from "./x509";

const DSIG = "http://www.w3.org/2000/09/xmldsig#";
const EXC_C14N = "http://www.w3.org/2001/10/xml-exc-c14n#";
const ENVELOPED = `${DSIG}enveloped-signature`;
const XMLNS = "http://www.w3.org/2000/xmlns/";

const MORE = "http://www.w3.org/2001/04/xmldsig-more#";
/** SignatureMethod / SigAlg → the key it needs and its hash. SHA-1 isn't
 *  accepted. */
const SIGNATURE_METHODS: Record<string, { kind: "rsa" | "ec"; hash: string }> =
  {
    [`${MORE}rsa-sha256`]: { kind: "rsa", hash: "SHA-256" },
    [`${MORE}rsa-sha384`]: { kind: "rsa", hash: "SHA-384" },
    [`${MORE}rsa-sha512`]: { kind: "rsa", hash: "SHA-512" },
    [`${MORE}ecdsa-sha256`]: { kind: "ec", hash: "SHA-256" },
    [`${MORE}ecdsa-sha384`]: { kind: "ec", hash: "SHA-384" },
    [`${MORE}ecdsa-sha512`]: { kind: "ec", hash: "SHA-512" },
  };
/** Bytes in each of an ECDSA signature's r and s, by curve. */
const EC_SIZES: Record<EcCurve, number> = {
  "P-256": 32,
  "P-384": 48,
  "P-521": 66,
};
/** DigestMethod → WebCrypto hash. */
const DIGEST_HASHES: Record<string, string> = {
  "http://www.w3.org/2001/04/xmlenc#sha256": "SHA-256",
  "http://www.w3.org/2001/04/xmldsig-more#sha384": "SHA-384",
  "http://www.w3.org/2001/04/xmlenc#sha512": "SHA-512",
};

const utf8 = new TextEncoder();

/** Whether signatures can be checked with this certificate (DER): an RSA
 *  or EC key WebCrypto accepts. */
export async function isUsableCertificate(der: Uint8Array): Promise<boolean> {
  const key = certificateKey(der);
  if (!key) return false;
  try {
    await crypto.subtle.importKey(
      "spki",
      key.spki as Uint8Array<ArrayBuffer>,
      key.kind === "rsa"
        ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }
        : { name: "ECDSA", namedCurve: key.curve },
      false,
      ["verify"],
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether `signature` over `data` is valid for the certificate's key with
 * the signature method `method` (a URI), which must suit that key.
 */
async function verifyWith(
  certificate: Uint8Array,
  method: string,
  signature: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  const alg = SIGNATURE_METHODS[method];
  const key = certificateKey(certificate);
  if (!alg || !key || alg.kind !== key.kind) return false;
  const spki = key.spki as Uint8Array<ArrayBuffer>;
  const bytes = data as Uint8Array<ArrayBuffer>;
  if (key.kind === "rsa") {
    const rsa = { name: "RSASSA-PKCS1-v1_5", hash: alg.hash };
    return crypto.subtle.verify(
      rsa,
      await crypto.subtle.importKey("spki", spki, rsa, false, ["verify"]),
      signature as Uint8Array<ArrayBuffer>,
      bytes,
    );
  }
  // XML Signature writes r and s side by side (RFC 4050), as WebCrypto
  // wants them; some signers write DER instead, the same (r, s) encoded.
  const size = EC_SIZES[key.curve];
  const raw =
    signature.length === size * 2
      ? signature
      : ecdsaSignatureFromDer(signature, size);
  if (!raw) return false;
  return crypto.subtle.verify(
    { name: "ECDSA", hash: alg.hash },
    await crypto.subtle.importKey(
      "spki",
      spki,
      { name: "ECDSA", namedCurve: key.curve },
      false,
      ["verify"],
    ),
    raw as Uint8Array<ArrayBuffer>,
    bytes,
  );
}

/** Base64 as it appears in XML or a query value: whitespace allowed, and a
 *  '+' that arrived as a space put back. */
function decodeBase64(text: string): Uint8Array<ArrayBuffer> {
  return base64ToBytes(text.replace(/ /g, "+").replace(/\s+/g, ""));
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ─── HTTP-Redirect ───────────────────────────────────────────────────────────

/**
 * Whether the query string of an HTTP-Redirect message carries a valid
 * signature by `certificate`. `rawQuery` is the query exactly as received:
 * the signature covers the URL-encoded values as the SP wrote them.
 */
export async function verifyRedirectSignature(
  rawQuery: string,
  field: "SAMLRequest" | "SAMLResponse",
  certificate: Uint8Array,
): Promise<boolean> {
  try {
    const raw = new Map<string, string>();
    for (const part of rawQuery.split("&")) {
      const eq = part.indexOf("=");
      const name = decodeURIComponent(eq < 0 ? part : part.slice(0, eq));
      // A repeated parameter could mean one value is checked and another
      // one used.
      if (raw.has(name)) return false;
      raw.set(name, eq < 0 ? "" : part.slice(eq + 1));
    }
    const message = raw.get(field);
    const sigAlg = raw.get("SigAlg");
    const signature = raw.get("Signature");
    if (!message || !sigAlg || !signature) return false;
    const decode = (v: string) => decodeURIComponent(v.replace(/\+/g, " "));
    const relayState = raw.get("RelayState");
    const signed =
      `${field}=${message}` +
      (relayState !== undefined ? `&RelayState=${relayState}` : "") +
      `&SigAlg=${sigAlg}`;
    return await verifyWith(
      certificate,
      decode(sigAlg),
      decodeBase64(decode(signature)),
      utf8.encode(signed),
    );
  } catch {
    return false;
  }
}

// ─── HTTP-POST: XML Signature ────────────────────────────────────────────────

function elementChildren(parent: Element): Element[] {
  const out: Element[] = [];
  for (let n = parent.firstChild; n; n = n.nextSibling)
    if (n.nodeType === 1) out.push(n as Element);
  return out;
}

function isDs(e: Element | undefined, localName: string): e is Element {
  return !!e && e.namespaceURI === DSIG && e.localName === localName;
}

/** The PrefixList of a c14n method's or transform's InclusiveNamespaces. */
function inclusivePrefixes(method: Element): string[] {
  const list = elementChildren(method).find(
    (e) => e.namespaceURI === EXC_C14N && e.localName === "InclusiveNamespaces",
  );
  return (list?.getAttribute("PrefixList") ?? "").split(/\s+/).filter(Boolean);
}

/**
 * Whether the message whose root is `root` carries a valid enveloped
 * signature by `certificate` over that root.
 */
export async function verifyPostSignature(
  root: Element,
  certificate: Uint8Array,
): Promise<boolean> {
  try {
    return await checkPostSignature(root, certificate);
  } catch {
    return false;
  }
}

async function checkPostSignature(
  root: Element,
  certificate: Uint8Array,
): Promise<boolean> {
  const signatures = elementChildren(root).filter((e) => isDs(e, "Signature"));
  if (signatures.length !== 1) return false;
  const signature = signatures[0];

  const [signedInfo, signatureValue] = elementChildren(signature);
  if (
    !isDs(signedInfo, "SignedInfo") ||
    !isDs(signatureValue, "SignatureValue")
  )
    return false;
  const [c14nMethod, signatureMethod, ...references] =
    elementChildren(signedInfo);
  if (
    !isDs(c14nMethod, "CanonicalizationMethod") ||
    c14nMethod.getAttribute("Algorithm") !== EXC_C14N ||
    !isDs(signatureMethod, "SignatureMethod")
  )
    return false;
  const method = signatureMethod.getAttribute("Algorithm") ?? "";
  if (!SIGNATURE_METHODS[method] || references.length !== 1) return false;

  const reference = references[0];
  const id = root.getAttribute("ID");
  if (
    !isDs(reference, "Reference") ||
    !id ||
    reference.getAttribute("URI") !== `#${id}`
  )
    return false;
  const [transforms, digestMethod, digestValue, ...extra] =
    elementChildren(reference);
  if (
    extra.length > 0 ||
    !isDs(transforms, "Transforms") ||
    !isDs(digestMethod, "DigestMethod") ||
    !isDs(digestValue, "DigestValue")
  )
    return false;
  const steps = elementChildren(transforms);
  if (
    steps.length !== 2 ||
    !steps.every((s) => isDs(s, "Transform")) ||
    steps[0].getAttribute("Algorithm") !== ENVELOPED ||
    steps[1].getAttribute("Algorithm") !== EXC_C14N
  )
    return false;
  const digestHash =
    DIGEST_HASHES[digestMethod.getAttribute("Algorithm") ?? ""];
  if (!digestHash) return false;

  const digest = new Uint8Array(
    await crypto.subtle.digest(
      digestHash,
      utf8.encode(
        canonicalizeElement(root, {
          exclude: signature,
          inclusivePrefixes: inclusivePrefixes(steps[1]),
        }),
      ),
    ),
  );
  if (!equalBytes(digest, decodeBase64(digestValue.textContent ?? "")))
    return false;

  return verifyWith(
    certificate,
    method,
    decodeBase64(signatureValue.textContent ?? ""),
    utf8.encode(
      canonicalizeElement(signedInfo, {
        inclusivePrefixes: inclusivePrefixes(c14nMethod),
      }),
    ),
  );
}

// ─── Exclusive XML Canonicalization ──────────────────────────────────────────
//
// https://www.w3.org/TR/xml-exc-c14n/ without comments, of the subtree at
// an element of a parsed document. (lib/saml/xml.ts writes XML Prism builds
// in canonical form directly; this is for XML it receives.)

interface C14nOptions {
  /** A node left out with everything under it: the enveloped signature. */
  exclude?: Node;
  /** InclusiveNamespaces PrefixList; "#default" is the default namespace. */
  inclusivePrefixes?: string[];
}

/** Code-point order, which c14n sorts by (not locale order). */
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r/g, "&#xD;");
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/\t/g, "&#x9;")
    .replace(/\n/g, "&#xA;")
    .replace(/\r/g, "&#xD;");
}

/** The exclusive canonical form of the subtree at `apex`. */
export function canonicalizeElement(
  apex: Element,
  options: C14nOptions = {},
): string {
  const out: string[] = [];
  // Namespaces the output's ancestors declared, by prefix ("" = default).
  writeElement(apex, new Map(), options, out);
  return out.join("");
}

function writeElement(
  e: Element,
  rendered: ReadonlyMap<string, string>,
  options: C14nOptions,
  out: string[],
): void {
  const scope = new Map(rendered);
  const declared = new Map<string, string>();
  // A namespace is declared where the output uses it and its nearest output
  // ancestor didn't already declare it with the same URI.
  const declare = (prefix: string, uri: string) => {
    if (prefix === "xml" || (scope.get(prefix) ?? "") === uri) return;
    scope.set(prefix, uri);
    declared.set(prefix, uri);
  };

  const prefix = e.prefix ?? "";
  declare(prefix, e.namespaceURI ?? "");
  const attrs: { name: string; ns: string; local: string; value: string }[] =
    [];
  for (let i = 0; i < e.attributes.length; i++) {
    const a = e.attributes[i];
    if (a.namespaceURI === XMLNS || a.name === "xmlns" || a.prefix === "xmlns")
      continue;
    if (a.prefix) declare(a.prefix, a.namespaceURI ?? "");
    attrs.push({
      name: a.name,
      ns: a.namespaceURI ?? "",
      local: a.localName ?? a.name,
      value: a.value,
    });
  }
  // Prefixes on the inclusive list are declared wherever they're in scope
  // and not declared yet, used or not.
  for (const p of options.inclusivePrefixes ?? []) {
    const key = p === "#default" ? "" : p;
    const uri = e.lookupNamespaceURI(key || null);
    if (uri || key === "") declare(key, uri ?? "");
  }

  out.push(`<${e.tagName}`);
  for (const p of [...declared.keys()].sort(byCodePoint)) {
    const uri = escapeAttr(declared.get(p)!);
    out.push(p ? ` xmlns:${p}="${uri}"` : ` xmlns="${uri}"`);
  }
  attrs.sort(
    (a, b) => byCodePoint(a.ns, b.ns) || byCodePoint(a.local, b.local),
  );
  for (const a of attrs) out.push(` ${a.name}="${escapeAttr(a.value)}"`);
  out.push(">");

  for (let n = e.firstChild; n; n = n.nextSibling) {
    if (n === options.exclude) continue;
    switch (n.nodeType) {
      case 1:
        writeElement(n as Element, scope, options, out);
        break;
      case 3: // text
      case 4: // CDATA: its text, escaped
        out.push(escapeText((n as unknown as { data: string }).data));
        break;
      case 7: {
        const pi = n as unknown as { target: string; data: string };
        out.push(`<?${pi.target}${pi.data ? ` ${pi.data}` : ""}?>`);
        break;
      }
      // Comments are left out.
    }
  }
  out.push(`</${e.tagName}>`);
}
