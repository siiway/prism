// Checking SPs' signatures on logout messages, against an independent
// implementation: xml-crypto canonicalizes and signs the way SPs do.

import { describe, expect, test } from "bun:test";
import { createPrivateKey, createSign } from "node:crypto";
import { DOMParser, type Element } from "@xmldom/xmldom";
import { ExclusiveCanonicalization, SignedXml } from "xml-crypto";
import { parseLogoutRequest } from "../src/worker/lib/saml/protocol";
import {
  canonicalizeElement,
  isUsableCertificate,
  verifyPostSignature,
  verifyRedirectSignature,
} from "../src/worker/lib/saml/verify";
import {
  bytesToBase64,
  certificateFromText,
  certificateKey,
  selfSignedCertificate,
  toPem,
} from "../src/worker/lib/saml/x509";

const SAMLP = "urn:oasis:names:tc:SAML:2.0:protocol";
const SAML = "urn:oasis:names:tc:SAML:2.0:assertion";
const EXC_C14N = "http://www.w3.org/2001/10/xml-exc-c14n#";
const RSA_SHA256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";

/** A private key as PEM, the form xml-crypto and node:crypto sign with. */
async function pemPrivateKey(key: CryptoKey): Promise<string> {
  const der = Buffer.from(await crypto.subtle.exportKey("pkcs8", key));
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" })
    .export({ format: "pem", type: "pkcs8" })
    .toString();
}

/** An SP's key pair: its certificate (DER) and its private key as PEM. */
async function makeSp() {
  const keys = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const certificate = await selfSignedCertificate(
    keys.publicKey,
    keys.privateKey,
    "sp.example",
  );
  const privateKeyPem = await pemPrivateKey(keys.privateKey);
  return { certificate, privateKey: keys.privateKey, privateKeyPem };
}

const spPromise = makeSp();
const otherSpPromise = makeSp();

const parse = (xml: string) =>
  new DOMParser().parseFromString(xml, "text/xml").documentElement as Element;

function logoutRequestXml(nameId = "u1", id = "_lr1"): string {
  return `<samlp:LogoutRequest xmlns:samlp="${SAMLP}" xmlns:saml="${SAML}" ID="${id}" Version="2.0" IssueInstant="2026-11-03T10:00:00Z" Destination="https://prism.example/saml/slo"><saml:Issuer>https://sp.example/metadata</saml:Issuer><saml:NameID>${nameId}</saml:NameID></samlp:LogoutRequest>`;
}

/** Sign the way SAML SPs do: an enveloped signature after the Issuer. */
function signXml(
  xml: string,
  privateKeyPem: string,
  opts: { signatureAlgorithm?: string; xpath?: string } = {},
): string {
  const sig = new SignedXml({
    privateKey: privateKeyPem,
    canonicalizationAlgorithm: EXC_C14N,
    signatureAlgorithm: opts.signatureAlgorithm ?? RSA_SHA256,
  });
  sig.addReference({
    xpath: opts.xpath ?? "/*",
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      EXC_C14N,
    ],
  });
  sig.computeSignature(xml, {
    location: { reference: "/*/*[local-name()='Issuer']", action: "after" },
  });
  return sig.getSignedXml();
}

describe("exclusive canonicalization", () => {
  const docs = [
    // Unused and used prefixes, attribute order and escaping, nested
    // default namespaces, comments, CDATA and whitespace.
    `<samlp:LogoutRequest xmlns:samlp="${SAMLP}" xmlns:saml="${SAML}" xmlns:unused="urn:unused" ID="_1" b="2" a="1&amp;&lt;&quot;&gt;"><saml:Issuer>sp</saml:Issuer>
  <saml:NameID Format="f">u&amp;1 &gt;</saml:NameID><!-- a comment -->
  <x:Ext xmlns:x="urn:ext" x:attr="v" xmlns="urn:default"><Inner a="&#9;&#10;"><Deeper xmlns="">t</Deeper></Inner><![CDATA[a<b&c]]></x:Ext></samlp:LogoutRequest>`,
    // A default namespace on the root, redeclared and undeclared below.
    `<LogoutRequest xmlns="${SAMLP}" ID="_2"><Issuer xmlns="${SAML}">sp</Issuer><child xmlns="">x</child><again>y</again></LogoutRequest>`,
    // Namespaced attributes sort by namespace URI, then local name; a
    // prefix rebound to another URI is declared again.
    `<a:r xmlns:a="urn:a" xmlns:b="urn:b" xmlns:c="urn:c" c:z="1" b:y="2" x="3" b:a="4"><a:k xmlns:a="urn:a2" a:q="5"/><a:k/></a:r>`,
  ];

  test("matches xml-crypto on the whole document", () => {
    for (const xml of docs) {
      const root = parse(xml);
      expect(canonicalizeElement(root)).toBe(
        new ExclusiveCanonicalization().process(parse(xml) as never, {}),
      );
    }
  });

  test("matches xml-crypto on a subtree, with an InclusiveNamespaces list", () => {
    const xml = docs[0];
    const subtree = (root: Element) =>
      root.getElementsByTagNameNS(SAML, "NameID")[0] as Element;
    expect(
      canonicalizeElement(subtree(parse(xml)), {
        inclusivePrefixes: ["unused", "samlp"],
      }),
    ).toBe(
      new ExclusiveCanonicalization().process(subtree(parse(xml)) as never, {
        inclusiveNamespacesPrefixList: ["unused", "samlp"],
        ancestorNamespaces: [
          { prefix: "unused", namespaceURI: "urn:unused" },
          { prefix: "samlp", namespaceURI: SAMLP },
        ],
      }),
    );
  });

  test("leaves out the excluded node", () => {
    const root = parse(docs[1]);
    const issuer = root.getElementsByTagNameNS(SAML, "Issuer")[0];
    expect(canonicalizeElement(root, { exclude: issuer })).not.toContain(
      "Issuer",
    );
  });
});

describe("certificates", () => {
  test("reads PEM and bare base64; refuses anything else", async () => {
    const { certificate } = await spPromise;
    const pem = toPem(certificate);
    expect(certificateFromText(pem)).toEqual(certificate);
    expect(certificateFromText(bytesToBase64(certificate))).toEqual(
      certificate,
    );
    expect(certificateFromText("not a certificate")).toBeNull();
    expect(certificateFromText(btoa("garbage bytes here"))).toBeNull();
    expect(certificateKey(certificate)?.kind).toBe("rsa");
    expect(await isUsableCertificate(certificate)).toBe(true);
  });
});

describe("HTTP-POST signatures", () => {
  test("an SP's signed LogoutRequest verifies with its certificate only", async () => {
    const sp = await spPromise;
    const other = await otherSpPromise;
    const signed = signXml(logoutRequestXml(), sp.privateKeyPem);
    const { root } = parseLogoutRequest(signed);
    expect(await verifyPostSignature(root, sp.certificate)).toBe(true);
    expect(await verifyPostSignature(root, other.certificate)).toBe(false);
  });

  test("unsigned, tampered, SHA-1 and wrapped messages fail", async () => {
    const sp = await spPromise;
    const check = async (xml: string) =>
      verifyPostSignature(parseLogoutRequest(xml).root, sp.certificate);

    expect(await check(logoutRequestXml())).toBe(false);
    const signed = signXml(logoutRequestXml(), sp.privateKeyPem);
    expect(await check(signed.replace(">u1<", ">u2<"))).toBe(false);
    expect(
      await check(
        signXml(logoutRequestXml(), sp.privateKeyPem, {
          signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
        }),
      ),
    ).toBe(false);

    // Signature wrapping: a new root, naming someone else, carries the
    // original signature, which still points at the original's ID.
    const original = parse(signed);
    const signature = original.getElementsByTagNameNS(
      "http://www.w3.org/2000/09/xmldsig#",
      "Signature",
    )[0];
    const wrapped = `<samlp:LogoutRequest xmlns:samlp="${SAMLP}" xmlns:saml="${SAML}" ID="_evil" Version="2.0" IssueInstant="2026-11-03T10:00:00Z"><saml:Issuer>https://sp.example/metadata</saml:Issuer>${signature.toString()}<saml:NameID>victim</saml:NameID><samlp:Extensions>${signed.replace(/^<\?xml[^>]*>/, "")}</samlp:Extensions></samlp:LogoutRequest>`;
    expect(await check(wrapped)).toBe(false);

    // A second signature next to the first is refused outright.
    const doubled = signed.replace(
      "</samlp:LogoutRequest>",
      `${signature.toString()}</samlp:LogoutRequest>`,
    );
    expect(await check(doubled)).toBe(false);
  });
});

describe("HTTP-Redirect signatures", () => {
  async function signedQuery(
    privateKey: CryptoKey,
    parts: string[],
  ): Promise<string> {
    const signed = parts.join("&");
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        privateKey,
        new TextEncoder().encode(signed),
      ),
    );
    return `${signed}&Signature=${encodeURIComponent(bytesToBase64(signature))}`;
  }

  test("checks the query as sent", async () => {
    const sp = await spPromise;
    const parts = [
      "SAMLRequest=fZBBa4MwFIb%2FSsjdxKht1aAWoQMHg8LGDrvFmGZhZXlxN%2FXvN9V1XQ7bLfLk%2FfJcgfiF",
      "RelayState=back%20here",
      `SigAlg=${encodeURIComponent(RSA_SHA256)}`,
    ];
    const query = await signedQuery(sp.privateKey, parts);
    expect(
      await verifyRedirectSignature(query, "SAMLRequest", sp.certificate),
    ).toBe(true);
    // Another certificate, another field, a changed RelayState, a repeated
    // parameter and a missing SigAlg all fail.
    expect(
      await verifyRedirectSignature(
        query,
        "SAMLRequest",
        (await otherSpPromise).certificate,
      ),
    ).toBe(false);
    expect(
      await verifyRedirectSignature(query, "SAMLResponse", sp.certificate),
    ).toBe(false);
    expect(
      await verifyRedirectSignature(
        query.replace("back%20here", "elsewhere"),
        "SAMLRequest",
        sp.certificate,
      ),
    ).toBe(false);
    expect(
      await verifyRedirectSignature(
        `${query}&RelayState=x`,
        "SAMLRequest",
        sp.certificate,
      ),
    ).toBe(false);
    const noAlg = await signedQuery(sp.privateKey, parts.slice(0, 2));
    expect(
      await verifyRedirectSignature(noAlg, "SAMLRequest", sp.certificate),
    ).toBe(false);
  });

  test("refuses SHA-1", async () => {
    const sp = await spPromise;
    const query = await signedQuery(sp.privateKey, [
      "SAMLRequest=abc",
      `SigAlg=${encodeURIComponent("http://www.w3.org/2000/09/xmldsig#rsa-sha1")}`,
    ]);
    expect(
      await verifyRedirectSignature(query, "SAMLRequest", sp.certificate),
    ).toBe(false);
  });
});

describe("EC keys", () => {
  const MORE = "http://www.w3.org/2001/04/xmldsig-more#";
  const cases = [
    {
      curve: "P-256",
      hash: "SHA-256",
      node: "sha256",
      alg: `${MORE}ecdsa-sha256`,
    },
    {
      curve: "P-384",
      hash: "SHA-384",
      node: "sha384",
      alg: `${MORE}ecdsa-sha384`,
    },
    {
      curve: "P-521",
      hash: "SHA-512",
      node: "sha512",
      alg: `${MORE}ecdsa-sha512`,
    },
  ] as const;

  /** An SP with an EC key. The certificate wrapping it is signed with an
   *  RSA key, which doesn't matter: only the key inside is used. */
  async function makeEcSp(curve: string) {
    const keys = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: curve },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const certificate = await selfSignedCertificate(
      keys.publicKey,
      (await spPromise).privateKey,
      "sp.example",
    );
    const privateKeyPem = await pemPrivateKey(keys.privateKey);
    return { certificate, privateKey: keys.privateKey, privateKeyPem };
  }

  for (const c of cases) {
    test(`${c.curve}: reads the key; checks Redirect signatures, raw or DER`, async () => {
      const sp = await makeEcSp(c.curve);
      expect(certificateKey(sp.certificate)).toMatchObject({
        kind: "ec",
        curve: c.curve,
      });
      expect(certificateFromText(toPem(sp.certificate))).toEqual(
        sp.certificate,
      );
      expect(await isUsableCertificate(sp.certificate)).toBe(true);

      const signed = `SAMLRequest=abc%2B&RelayState=rs&SigAlg=${encodeURIComponent(c.alg)}`;
      const raw = new Uint8Array(
        await crypto.subtle.sign(
          { name: "ECDSA", hash: c.hash },
          sp.privateKey,
          new TextEncoder().encode(signed),
        ),
      );
      const der = createSign(c.node)
        .update(signed)
        .sign({ key: sp.privateKeyPem, dsaEncoding: "der" });
      const withSig = (sig: Uint8Array) =>
        `${signed}&Signature=${encodeURIComponent(bytesToBase64(sig))}`;
      expect(
        await verifyRedirectSignature(
          withSig(raw),
          "SAMLRequest",
          sp.certificate,
        ),
      ).toBe(true);
      expect(
        await verifyRedirectSignature(
          withSig(new Uint8Array(der)),
          "SAMLRequest",
          sp.certificate,
        ),
      ).toBe(true);
      // Changed content, and an RSA SigAlg for an EC key.
      expect(
        await verifyRedirectSignature(
          withSig(raw).replace("abc", "abd"),
          "SAMLRequest",
          sp.certificate,
        ),
      ).toBe(false);
      expect(
        await verifyRedirectSignature(
          withSig(raw).replace(
            encodeURIComponent(c.alg),
            encodeURIComponent(RSA_SHA256),
          ),
          "SAMLRequest",
          sp.certificate,
        ),
      ).toBe(false);
    });

    test(`${c.curve}: checks an XML signature`, async () => {
      const sp = await makeEcSp(c.curve);
      // xml-crypto has no ECDSA of its own; this signs the way XML
      // Signature does (RFC 4050: r and s side by side).
      class Ecdsa {
        getSignature(
          signedInfo: Parameters<typeof createSign>[0],
          key: string,
        ) {
          return createSign(c.node)
            .update(signedInfo)
            .sign({ key, dsaEncoding: "ieee-p1363" }, "base64");
        }
        verifySignature() {
          return false;
        }
        getAlgorithmName() {
          return c.alg;
        }
      }
      const sig = new SignedXml({
        privateKey: sp.privateKeyPem,
        canonicalizationAlgorithm: EXC_C14N,
      });
      (sig.SignatureAlgorithms as Record<string, unknown>)[c.alg] = Ecdsa;
      sig.signatureAlgorithm = c.alg as never;
      sig.addReference({
        xpath: "/*",
        digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
        transforms: [
          "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
          EXC_C14N,
        ],
      });
      sig.computeSignature(logoutRequestXml(), {
        location: { reference: "/*/*[local-name()='Issuer']", action: "after" },
      });
      const signed = sig.getSignedXml();
      expect(signed).toContain(c.alg);
      const check = (xml: string) =>
        verifyPostSignature(parseLogoutRequest(xml).root, sp.certificate);
      expect(await check(signed)).toBe(true);
      expect(await check(signed.replace(">u1<", ">u2<"))).toBe(false);
      // The RSA SP's certificate doesn't verify it.
      expect(
        await verifyPostSignature(
          parseLogoutRequest(signed).root,
          (await spPromise).certificate,
        ),
      ).toBe(false);
    });
  }
});
