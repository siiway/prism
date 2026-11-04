// SAML IdP building blocks, checked against independent implementations:
// signatures with xml-crypto, the certificate with node:crypto.

import { describe, expect, test } from "bun:test";
import { X509Certificate } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";
import {
  NAMEID_EMAIL,
  NAMEID_PERSISTENT,
  SamlError,
  buildErrorResponse,
  buildIdpMetadata,
  buildSuccessResponse,
  decodePostBinding,
  decodeRedirectBinding,
  nameIdPolicyAllows,
  parseAuthnRequest,
  type AssertionContent,
  type Destination,
  type SignMode,
} from "../src/worker/lib/saml/protocol";
import type { SamlSigner } from "../src/worker/lib/saml/sign";
import { canonicalize, el } from "../src/worker/lib/saml/xml";
import { selfSignedCertificate, toPem } from "../src/worker/lib/saml/x509";

const DSIG = "http://www.w3.org/2000/09/xmldsig#";

async function makeSigner(): Promise<SamlSigner & { publicKey: CryptoKey }> {
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
    "prism.example",
  );
  return {
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
    certificate,
  };
}

const signerPromise = makeSigner();

const dest: Destination = {
  idpEntityId: "https://prism.example/saml/metadata",
  spEntityId: "https://sp.example/metadata",
  acsUrl: "https://sp.example/acs",
  inResponseTo: "_req1",
};

const content: AssertionContent = {
  nameId: { format: "persistent", value: "user-1" },
  attributes: {
    uid: ["user-1"],
    email: ["a&b@example.com"],
    groups: ["team-1:dev", "team-1:<ops>"],
    empty: [],
  },
  authnInstant: 1_800_000_000,
  sessionIndex: "_session1",
  amr: ["pwd"],
};

function parse(xml: string): Document {
  return new DOMParser().parseFromString(
    xml,
    "text/xml",
  ) as unknown as Document;
}

function decode(samlResponse: string): string {
  return new TextDecoder().decode(
    Uint8Array.from(atob(samlResponse), (c) => c.charCodeAt(0)),
  );
}

/** Verifies every ds:Signature in the document; returns the local names
 *  of the elements whose signatures check out. */
function verifiedElements(xml: string, pem: string): string[] {
  const doc = parse(xml);
  const sigs = Array.from(doc.getElementsByTagNameNS(DSIG, "Signature"));
  return sigs.map((sig) => {
    const verifier = new SignedXml({ publicCert: pem });
    verifier.loadSignature(sig.toString());
    if (!verifier.checkSignature(xml)) throw new Error("signature invalid");
    return (sig.parentNode as Element).localName;
  });
}

describe("certificate", () => {
  test("parses, is self-signed and carries the key", async () => {
    const signer = await signerPromise;
    const cert = new X509Certificate(signer.certificate);
    expect(cert.subject).toBe("CN=prism.example");
    expect(cert.issuer).toBe("CN=prism.example");
    expect(cert.verify(cert.publicKey)).toBe(true);
    const spki = new Uint8Array(
      await crypto.subtle.exportKey("spki", signer.publicKey),
    );
    expect(
      new Uint8Array(cert.publicKey.export({ type: "spki", format: "der" })),
    ).toEqual(spki);
    expect(new Date(cert.validTo).getUTCFullYear()).toBe(2049);
  });

  test("is deterministic for a key pair", async () => {
    const signer = await signerPromise;
    const again = await selfSignedCertificate(
      signer.publicKey,
      signer.privateKey,
      "prism.example",
    );
    expect(again).toEqual(signer.certificate);
  });
});

describe("canonical serialization", () => {
  test("declares namespaces where used, sorts and escapes attributes", () => {
    const xml = canonicalize(
      el(
        "samlp:Response",
        { b: "2", a: 'x"<&\n' },
        el("saml:Issuer", {}, "a<b>&c"),
        el("samlp:Status", {}),
      ),
    );
    expect(xml).toBe(
      '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" a="x&quot;&lt;&amp;&#xA;" b="2">' +
        '<saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">a&lt;b&gt;&amp;c</saml:Issuer>' +
        "<samlp:Status></samlp:Status></samlp:Response>",
    );
  });
});

describe("responses", () => {
  for (const sign of ["assertion", "response", "both"] as SignMode[]) {
    test(`signed ${sign} verifies with xml-crypto`, async () => {
      const signer = await signerPromise;
      const pem = toPem(signer.certificate);
      const xml = decode(
        await buildSuccessResponse(dest, content, signer, sign),
      );
      const signed = verifiedElements(xml, pem).sort();
      expect(signed).toEqual(
        sign === "both"
          ? ["Assertion", "Response"]
          : [sign === "assertion" ? "Assertion" : "Response"],
      );
    });
  }

  test("a tampered assertion fails verification", async () => {
    const signer = await signerPromise;
    const xml = decode(
      await buildSuccessResponse(dest, content, signer, "assertion"),
    ).replace(">user-1<", ">admin<");
    expect(() => verifiedElements(xml, toPem(signer.certificate))).toThrow();
  });

  test("carries subject, conditions and attributes", async () => {
    const signer = await signerPromise;
    const now = 1_800_000_100;
    const xml = decode(
      await buildSuccessResponse(dest, content, signer, "assertion", now),
    );
    const doc = parse(xml);
    const response = doc.documentElement;
    expect(response.getAttribute("InResponseTo")).toBe("_req1");
    expect(response.getAttribute("Destination")).toBe(dest.acsUrl);
    const nameId = doc.getElementsByTagNameNS("*", "NameID")[0];
    expect(nameId.textContent).toBe("user-1");
    expect(nameId.getAttribute("Format")).toBe(NAMEID_PERSISTENT);
    expect(doc.getElementsByTagNameNS("*", "Audience")[0].textContent).toBe(
      dest.spEntityId,
    );
    const conditions = doc.getElementsByTagNameNS("*", "Conditions")[0];
    expect(conditions.getAttribute("NotBefore")).toBe("2027-01-15T08:00:40Z");
    expect(conditions.getAttribute("NotOnOrAfter")).toBe(
      "2027-01-15T08:06:40Z",
    );
    const attrs = Object.fromEntries(
      Array.from(doc.getElementsByTagNameNS("*", "Attribute")).map((a) => [
        a.getAttribute("Name"),
        Array.from(a.getElementsByTagNameNS("*", "AttributeValue")).map(
          (v) => v.textContent,
        ),
      ]),
    );
    expect(attrs).toEqual({
      uid: ["user-1"],
      email: ["a&b@example.com"],
      groups: ["team-1:dev", "team-1:<ops>"],
    });
  });

  test("error responses are signed and carry the nested status, no assertion", async () => {
    const signer = await signerPromise;
    const xml = decode(await buildErrorResponse(dest, "NoPassive", signer));
    const doc = parse(xml);
    const codes = Array.from(doc.getElementsByTagNameNS("*", "StatusCode")).map(
      (c) => c.getAttribute("Value"),
    );
    expect(codes).toEqual([
      "urn:oasis:names:tc:SAML:2.0:status:Responder",
      "urn:oasis:names:tc:SAML:2.0:status:NoPassive",
    ]);
    expect(doc.getElementsByTagNameNS("*", "Assertion").length).toBe(0);
    expect(verifiedElements(xml, toPem(signer.certificate))).toEqual([
      "Response",
    ]);
  });
});

describe("AuthnRequest", () => {
  const request = `<?xml version="1.0"?>
<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
    xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
    ID="_abc123" Version="2.0" IssueInstant="2026-11-02T10:00:00Z"
    AssertionConsumerServiceURL="https://sp.example/acs"
    ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
    ForceAuthn="true">
  <saml:Issuer> https://sp.example/metadata </saml:Issuer>
  <samlp:NameIDPolicy Format="${NAMEID_EMAIL}" AllowCreate="true"/>
</samlp:AuthnRequest>`;

  test("decodes the redirect binding and reads the fields", async () => {
    const encoded = Buffer.from(deflateRawSync(request)).toString("base64");
    const parsed = parseAuthnRequest(await decodeRedirectBinding(encoded));
    expect(parsed).toEqual({
      id: "_abc123",
      issuer: "https://sp.example/metadata",
      acsUrl: "https://sp.example/acs",
      protocolBinding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
      nameIdFormat: NAMEID_EMAIL,
      destination: null,
      forceAuthn: true,
      isPassive: false,
    });
  });

  test("decodes the POST binding, even with + turned into spaces", () => {
    const encoded = Buffer.from(request).toString("base64");
    expect(parseAuthnRequest(decodePostBinding(encoded)).id).toBe("_abc123");
    expect(
      parseAuthnRequest(decodePostBinding(encoded.replace(/\+/g, " "))).id,
    ).toBe("_abc123");
  });

  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return e instanceof SamlError ? e.code : String(e);
    }
    return null;
  };

  test("rejects DTDs, malformed XML and other messages", () => {
    expect(
      code(() =>
        parseAuthnRequest(
          request.replace(
            '<?xml version="1.0"?>',
            '<?xml version="1.0"?><!DOCTYPE samlp:AuthnRequest [<!ENTITY a "b">]>',
          ),
        ),
      ),
    ).toBe("saml_request_invalid");
    expect(code(() => parseAuthnRequest("<samlp:AuthnRequest"))).toBe(
      "saml_request_invalid",
    );
    expect(
      code(() =>
        parseAuthnRequest(request.replace(/AuthnRequest/g, "LogoutRequest")),
      ),
    ).toBe("saml_request_unsupported");
    expect(
      code(() =>
        parseAuthnRequest(
          request.replace(/<saml:Issuer>.*<\/saml:Issuer>/, ""),
        ),
      ),
    ).toBe("saml_request_invalid");
  });

  test("refuses a deflate bomb", async () => {
    const bomb = Buffer.from(deflateRawSync("a".repeat(1_000_000))).toString(
      "base64",
    );
    let err: unknown;
    await decodeRedirectBinding(bomb).catch((e) => (err = e));
    expect(err).toBeInstanceOf(SamlError);
  });

  test("NameIDPolicy matching", () => {
    expect(nameIdPolicyAllows(null, "persistent")).toBe(true);
    expect(
      nameIdPolicyAllows(
        "urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified",
        "email",
      ),
    ).toBe(true);
    expect(nameIdPolicyAllows(NAMEID_EMAIL, "email")).toBe(true);
    expect(nameIdPolicyAllows(NAMEID_EMAIL, "persistent")).toBe(false);
  });
});

describe("metadata", () => {
  test("names the SSO and SLO endpoints and the signing certificate", async () => {
    const signer = await signerPromise;
    const xml = buildIdpMetadata({
      entityId: "https://prism.example/saml/metadata",
      ssoUrl: "https://prism.example/saml/sso",
      sloUrl: "https://prism.example/saml/slo",
      certificate: signer.certificate,
    });
    const doc = parse(xml);
    expect(doc.documentElement.getAttribute("entityID")).toBe(
      "https://prism.example/saml/metadata",
    );
    const sso = Array.from(
      doc.getElementsByTagNameNS("*", "SingleSignOnService"),
    ).map((e) => e.getAttribute("Binding"));
    expect(sso).toHaveLength(2);
    const slo = Array.from(
      doc.getElementsByTagNameNS("*", "SingleLogoutService"),
    ).map((e) => e.getAttribute("Location"));
    expect(slo).toEqual([
      "https://prism.example/saml/slo",
      "https://prism.example/saml/slo",
    ]);
    const certText = doc.getElementsByTagNameNS(DSIG, "X509Certificate")[0]
      .textContent!;
    expect(new X509Certificate(Buffer.from(certText, "base64")).subject).toBe(
      "CN=prism.example",
    );
  });
});
