// Enveloped XML Signatures (RSA-SHA256, exclusive c14n) over elements Prism
// builds, and the key + certificate they're made with.

import { getRsaKeyPair } from "../config";
import { canonicalize, el, type XmlElement } from "./xml";
import { selfSignedCertificate } from "./x509";

const C14N = "http://www.w3.org/2001/10/xml-exc-c14n#";
const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const RSA_SHA256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256";

const utf8 = new TextEncoder();

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export interface SamlSigner {
  privateKey: CryptoKey;
  /** DER certificate for the signing key. */
  certificate: Uint8Array;
}

// The certificate is deterministic (see x509.ts), so caching it per isolate
// only saves the RSA signature; keyed by kid and host so a rotated key or a
// changed APP_URL never serves a stale one.
const signerCache = new Map<string, Promise<SamlSigner>>();

/** The signing key (Prism's RS256 key, shared with ID tokens) and its
 *  self-signed certificate, issued to the APP_URL host. */
export async function getSamlSigner(env: Env): Promise<SamlSigner> {
  const keys = await getRsaKeyPair(env.KV_SESSIONS);
  const host = new URL(env.APP_URL).host;
  const cacheKey = `${keys.kid}:${host}`;
  let signer = signerCache.get(cacheKey);
  if (!signer) {
    signer = selfSignedCertificate(keys.publicKey, keys.privateKey, host).then(
      (certificate) => ({ privateKey: keys.privateKey, certificate }),
    );
    signer.catch(() => signerCache.delete(cacheKey));
    signerCache.set(cacheKey, signer);
  }
  return signer;
}

export function keyInfo(certificate: Uint8Array): XmlElement {
  return el(
    "ds:KeyInfo",
    {},
    el(
      "ds:X509Data",
      {},
      el("ds:X509Certificate", {}, bytesToBase64(certificate)),
    ),
  );
}

/**
 * `element` with an enveloped signature over it, inserted as its second
 * child: SAML puts ds:Signature right after the Issuer in both Response and
 * Assertion. The element must have an `ID` attribute and no signature yet.
 */
export async function signElement(
  element: XmlElement,
  signer: SamlSigner,
): Promise<XmlElement> {
  const id = element.attrs?.ID;
  if (!id) throw new Error("Signed element needs an ID");

  // The enveloped-signature transform removes the signature before the
  // digest, so the digest is over the element as it is now.
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", utf8.encode(canonicalize(element))),
  );
  const signedInfo = el(
    "ds:SignedInfo",
    {},
    el("ds:CanonicalizationMethod", { Algorithm: C14N }),
    el("ds:SignatureMethod", { Algorithm: RSA_SHA256 }),
    el(
      "ds:Reference",
      { URI: `#${id}` },
      el(
        "ds:Transforms",
        {},
        el("ds:Transform", { Algorithm: ENVELOPED }),
        el("ds:Transform", { Algorithm: C14N }),
      ),
      el("ds:DigestMethod", { Algorithm: SHA256 }),
      el("ds:DigestValue", {}, bytesToBase64(digest)),
    ),
  );
  const signatureValue = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      signer.privateKey,
      utf8.encode(canonicalize(signedInfo)),
    ),
  );
  const signature = el(
    "ds:Signature",
    {},
    signedInfo,
    el("ds:SignatureValue", {}, bytesToBase64(signatureValue)),
    keyInfo(signer.certificate),
  );
  const [first, ...rest] = element.children ?? [];
  return { ...element, children: [first, signature, ...rest] };
}
