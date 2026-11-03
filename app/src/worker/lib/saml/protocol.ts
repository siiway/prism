// SAML 2.0 Web Browser SSO, identity-provider side: decode AuthnRequests
// (HTTP-Redirect and HTTP-POST bindings), build signed Responses for the
// HTTP-POST binding, and describe the IdP in metadata.
//
// AuthnRequest signatures are not verified. A request only names where the
// response goes, and Prism sends it only to an ACS URL registered for that
// service provider, which is what keeps assertions from reaching anyone else.

import {
  DOMParser,
  onWarningStopParsing,
  type Document,
  type Element,
} from "@xmldom/xmldom";
import { randomId } from "../crypto";
import { bytesToBase64, keyInfo, signElement, type SamlSigner } from "./sign";
import { NS, el, serializeDocument, type XmlElement } from "./xml";

export const NAMEID_PERSISTENT =
  "urn:oasis:names:tc:SAML:2.0:nameid-format:persistent";
export const NAMEID_EMAIL =
  "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress";
const NAMEID_UNSPECIFIED =
  "urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified";

export const BINDING_REDIRECT =
  "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect";
export const BINDING_POST = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST";

const STATUS = "urn:oasis:names:tc:SAML:2.0:status:";
export type SamlStatus =
  | "Success"
  | "Requester"
  | "Responder"
  | "RequestDenied"
  | "NoPassive"
  | "InvalidNameIDPolicy";

export type NameIdFormat = "persistent" | "email";
export type SignMode = "assertion" | "response" | "both";

export const NAMEID_FORMAT_URIS: Record<NameIdFormat, string> = {
  persistent: NAMEID_PERSISTENT,
  email: NAMEID_EMAIL,
};

/** Coded failure, reported to the browser as an API error code. */
export class SamlError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

// ─── AuthnRequest ────────────────────────────────────────────────────────────

/** Encoded SAMLRequest size cap; real requests are well under 4 KiB. */
const MAX_ENCODED = 32 * 1024;
/** Inflated size cap, so a small deflate bomb can't eat the isolate. */
const MAX_XML = 64 * 1024;

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (value.length > MAX_ENCODED) throw new SamlError("saml_request_invalid");
  // A '+' left unescaped in a query string arrives as a space.
  const clean = value.replace(/ /g, "+").replace(/[\r\n\t]/g, "");
  let binary: string;
  try {
    binary = atob(clean);
  } catch {
    throw new SamlError("saml_request_invalid");
  }
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

async function inflateRaw(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const reader = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_XML) {
        await reader.cancel();
        throw new SamlError("saml_request_invalid");
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof SamlError) throw err;
    throw new SamlError("saml_request_invalid");
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function utf8Decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
      bytes,
    );
  } catch {
    throw new SamlError("saml_request_invalid");
  }
}

/** XML of a SAMLRequest sent with the HTTP-Redirect binding (deflated). */
export async function decodeRedirectBinding(value: string): Promise<string> {
  return utf8Decode(await inflateRaw(base64ToBytes(value)));
}

/** XML of a SAMLRequest sent with the HTTP-POST binding. */
export function decodePostBinding(value: string): string {
  const bytes = base64ToBytes(value);
  if (bytes.length > MAX_XML) throw new SamlError("saml_request_invalid");
  return utf8Decode(bytes);
}

export interface AuthnRequest {
  id: string;
  issuer: string;
  /** AssertionConsumerServiceURL, when the SP named one. */
  acsUrl: string | null;
  /** ProtocolBinding, when the SP named one. */
  protocolBinding: string | null;
  /** NameIDPolicy Format, when the SP named one. */
  nameIdFormat: string | null;
  /** Destination, when present: the URL the SP sent the request to. */
  destination: string | null;
  forceAuthn: boolean;
  isPassive: boolean;
}

function childElement(
  parent: Element,
  ns: string,
  localName: string,
): Element | null {
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType !== 1) continue;
    const e = n as Element;
    if (e.namespaceURI === ns && e.localName === localName) return e;
  }
  return null;
}

const xmlBool = (v: string | null) => v === "true" || v === "1";

export function parseAuthnRequest(xml: string): AuthnRequest {
  // No DTDs at all: SAML never needs one, and refusing them rules out
  // entity-expansion tricks whatever the parser would do with them.
  if (/<!DOCTYPE/i.test(xml)) throw new SamlError("saml_request_invalid");
  let doc: Document;
  try {
    doc = new DOMParser({
      onError: onWarningStopParsing,
      locator: false,
    }).parseFromString(xml, "text/xml");
  } catch {
    throw new SamlError("saml_request_invalid");
  }
  const root = doc.documentElement;
  if (
    !root ||
    root.namespaceURI !== NS.samlp ||
    root.localName !== "AuthnRequest"
  )
    throw new SamlError("saml_request_unsupported");
  const id = root.getAttribute("ID") ?? "";
  if (
    root.getAttribute("Version") !== "2.0" ||
    !id ||
    id.length > 256 ||
    /\s/.test(id)
  )
    throw new SamlError("saml_request_invalid");

  const issuer = childElement(root, NS.saml, "Issuer")?.textContent?.trim();
  if (!issuer) throw new SamlError("saml_request_invalid");
  const policy = childElement(root, NS.samlp, "NameIDPolicy");

  return {
    id,
    issuer,
    acsUrl: root.getAttribute("AssertionConsumerServiceURL") || null,
    protocolBinding: root.getAttribute("ProtocolBinding") || null,
    nameIdFormat: policy?.getAttribute("Format") || null,
    destination: root.getAttribute("Destination") || null,
    forceAuthn: xmlBool(root.getAttribute("ForceAuthn")),
    isPassive: xmlBool(root.getAttribute("IsPassive")),
  };
}

/** Whether the NameIDPolicy Format the SP asked for (if any) is `ours`. */
export function nameIdPolicyAllows(
  requested: string | null,
  ours: NameIdFormat,
): boolean {
  return (
    !requested ||
    requested === NAMEID_UNSPECIFIED ||
    requested === NAMEID_FORMAT_URIS[ours]
  );
}

// ─── Response ────────────────────────────────────────────────────────────────

/** xs:dateTime in UTC without fractional seconds, as SPs expect. */
function instant(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** IDs are xs:ID (an NCName), so they can't start with a digit. */
const newId = () => `_${randomId(20)}`;

/** Allowed clock skew between Prism and the SP for NotBefore. */
const SKEW_SECONDS = 60;
/** How long an assertion may be presented; the POST happens right away. */
const ASSERTION_TTL_SECONDS = 300;

const PASSWORD_PROTECTED =
  "urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport";
const UNSPECIFIED_CONTEXT =
  "urn:oasis:names:tc:SAML:2.0:ac:classes:unspecified";

export interface Destination {
  idpEntityId: string;
  spEntityId: string;
  acsUrl: string;
  /** The AuthnRequest ID, or null for an unsolicited response. */
  inResponseTo: string | null;
}

export interface AssertionContent {
  nameId: { format: NameIdFormat; value: string };
  /** Attribute name → values; empty lists are left out. */
  attributes: Record<string, string[]>;
  /** When the user authenticated (session start), in seconds. */
  authnInstant: number;
  /** RFC 8176 methods of the session, to pick an AuthnContextClassRef. */
  amr: string[];
}

function statusElement(status: SamlStatus): XmlElement {
  const top =
    status === "Success" || status === "Requester" || status === "Responder"
      ? status
      : status === "InvalidNameIDPolicy"
        ? "Requester"
        : "Responder";
  return el(
    "samlp:Status",
    {},
    el(
      "samlp:StatusCode",
      { Value: STATUS + top },
      top !== status && el("samlp:StatusCode", { Value: STATUS + status }),
    ),
  );
}

function responseElement(
  dest: Destination,
  now: number,
  status: SamlStatus,
  assertion: XmlElement | null,
): XmlElement {
  return el(
    "samlp:Response",
    {
      ID: newId(),
      Version: "2.0",
      IssueInstant: instant(now),
      Destination: dest.acsUrl,
      InResponseTo: dest.inResponseTo ?? undefined,
    },
    el("saml:Issuer", {}, dest.idpEntityId),
    statusElement(status),
    assertion,
  );
}

function assertionElement(
  dest: Destination,
  content: AssertionContent,
  now: number,
): XmlElement {
  const notOnOrAfter = instant(now + ASSERTION_TTL_SECONDS);
  const attributes = Object.entries(content.attributes).filter(
    ([, values]) => values.length > 0,
  );
  return el(
    "saml:Assertion",
    { ID: newId(), Version: "2.0", IssueInstant: instant(now) },
    el("saml:Issuer", {}, dest.idpEntityId),
    el(
      "saml:Subject",
      {},
      el(
        "saml:NameID",
        {
          Format: NAMEID_FORMAT_URIS[content.nameId.format],
          SPNameQualifier:
            content.nameId.format === "persistent"
              ? dest.spEntityId
              : undefined,
        },
        content.nameId.value,
      ),
      el(
        "saml:SubjectConfirmation",
        { Method: "urn:oasis:names:tc:SAML:2.0:cm:bearer" },
        el("saml:SubjectConfirmationData", {
          InResponseTo: dest.inResponseTo ?? undefined,
          NotOnOrAfter: notOnOrAfter,
          Recipient: dest.acsUrl,
        }),
      ),
    ),
    el(
      "saml:Conditions",
      { NotBefore: instant(now - SKEW_SECONDS), NotOnOrAfter: notOnOrAfter },
      el(
        "saml:AudienceRestriction",
        {},
        el("saml:Audience", {}, dest.spEntityId),
      ),
    ),
    el(
      "saml:AuthnStatement",
      { AuthnInstant: instant(content.authnInstant), SessionIndex: newId() },
      el(
        "saml:AuthnContext",
        {},
        el(
          "saml:AuthnContextClassRef",
          {},
          content.amr.includes("pwd")
            ? PASSWORD_PROTECTED
            : UNSPECIFIED_CONTEXT,
        ),
      ),
    ),
    attributes.length > 0 &&
      el(
        "saml:AttributeStatement",
        {},
        ...attributes.map(([name, values]) =>
          el(
            "saml:Attribute",
            {
              Name: name,
              NameFormat: "urn:oasis:names:tc:SAML:2.0:attrname-format:basic",
            },
            ...values.map((v) => el("saml:AttributeValue", {}, v)),
          ),
        ),
      ),
  );
}

const utf8 = new TextEncoder();

/** Base64 of the XML document, the SAMLResponse form field's value. */
function encodeResponse(root: XmlElement): string {
  return bytesToBase64(utf8.encode(serializeDocument(root)));
}

/** A signed successful Response carrying one assertion, base64-encoded. */
export async function buildSuccessResponse(
  dest: Destination,
  content: AssertionContent,
  signer: SamlSigner,
  sign: SignMode,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  let assertion = assertionElement(dest, content, now);
  // The assertion is signed first: a response signature covers the
  // assertion as it will be sent, signature included.
  if (sign !== "response") assertion = await signElement(assertion, signer);
  let response = responseElement(dest, now, "Success", assertion);
  if (sign !== "assertion") response = await signElement(response, signer);
  return encodeResponse(response);
}

/** A Response that reports a failure and carries no assertion. Always
 *  signed, whatever the app's signing mode: SPs act on a NoPassive answer
 *  (and carry on signed out) only when the response is signed. */
export async function buildErrorResponse(
  dest: Destination,
  status: Exclude<SamlStatus, "Success">,
  signer: SamlSigner,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  const response = responseElement(dest, now, status, null);
  return encodeResponse(await signElement(response, signer));
}

// ─── Metadata ────────────────────────────────────────────────────────────────

export function buildIdpMetadata(opts: {
  entityId: string;
  ssoUrl: string;
  certificate: Uint8Array;
}): string {
  return serializeDocument(
    el(
      "md:EntityDescriptor",
      { entityID: opts.entityId },
      el(
        "md:IDPSSODescriptor",
        {
          WantAuthnRequestsSigned: "false",
          protocolSupportEnumeration: NS.samlp,
        },
        el("md:KeyDescriptor", { use: "signing" }, keyInfo(opts.certificate)),
        el("md:NameIDFormat", {}, NAMEID_PERSISTENT),
        el("md:NameIDFormat", {}, NAMEID_EMAIL),
        el("md:SingleSignOnService", {
          Binding: BINDING_REDIRECT,
          Location: opts.ssoUrl,
        }),
        el("md:SingleSignOnService", {
          Binding: BINDING_POST,
          Location: opts.ssoUrl,
        }),
      ),
    ),
  );
}
