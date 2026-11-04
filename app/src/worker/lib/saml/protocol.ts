// SAML 2.0 Web Browser SSO and Single Logout, identity-provider side: decode
// AuthnRequests and logout messages (HTTP-Redirect and HTTP-POST bindings),
// build signed Responses for the HTTP-POST binding, build signed logout
// messages for either binding, and describe the IdP in metadata.
//
// Signatures on AuthnRequests are not verified. A request only names where
// the response goes, and Prism sends it only to an ACS URL registered for
// that service provider, which is what keeps assertions from reaching anyone
// else. Logout messages are verified when the SP's signing certificate is on
// file (see verify.ts).

import {
  DOMParser,
  onWarningStopParsing,
  type Document,
  type Element,
} from "@xmldom/xmldom";
import type {
  SamlLogoutStep,
  SamlNameIdFormat,
  SamlSignMode,
  SamlSloBinding,
} from "../../../shared/api";
import { readStreamWithLimit } from "../bodyLimit";
import { randomId } from "../crypto";
import { keyInfo, signElement, type SamlSigner } from "./sign";
import { bytesToBase64, decodeBase64 } from "./x509";
import { NS, RSA_SHA256, el, serializeDocument, type XmlElement } from "./xml";

export const NAMEID_PERSISTENT =
  "urn:oasis:names:tc:SAML:2.0:nameid-format:persistent";
export const NAMEID_EMAIL =
  "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress";
const NAMEID_UNSPECIFIED =
  "urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified";

const BINDING_REDIRECT = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect";
export const BINDING_POST = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST";

const STATUS = "urn:oasis:names:tc:SAML:2.0:status:";
export type SamlStatus =
  | "Success"
  | "Requester"
  | "Responder"
  | "RequestDenied"
  | "NoPassive"
  | "InvalidNameIDPolicy"
  | "PartialLogout"
  | "UnknownPrincipal";

export type NameIdFormat = SamlNameIdFormat;
export type SignMode = SamlSignMode;

const NAMEID_FORMAT_URIS: Record<NameIdFormat, string> = {
  persistent: NAMEID_PERSISTENT,
  email: NAMEID_EMAIL,
};

/** A Subject's NameID. A persistent one is only meaningful to the SP it
 *  was issued for, which SPNameQualifier names (SAML Core §8.3.7). */
function nameIdElement(
  nameId: { format: NameIdFormat; value: string },
  spEntityId: string,
): XmlElement {
  return el(
    "saml:NameID",
    {
      Format: NAMEID_FORMAT_URIS[nameId.format],
      SPNameQualifier: nameId.format === "persistent" ? spEntityId : undefined,
    },
    nameId.value,
  );
}

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
  try {
    return decodeBase64(value);
  } catch {
    throw new SamlError("saml_request_invalid");
  }
}

async function inflateRaw(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const read = await readStreamWithLimit(
    new Blob([bytes])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw")),
    MAX_XML,
  ).catch(() => null);
  if (!read?.bytes) throw new SamlError("saml_request_invalid");
  return read.bytes;
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

/** The root element of a SAML document Prism received; null if it isn't
 *  well-formed XML. */
export function parseSamlXml(xml: string): Element | null {
  // No DTDs at all: SAML never needs one, and refusing them rules out
  // entity-expansion tricks whatever the parser would do with them.
  if (/<!DOCTYPE/i.test(xml)) return null;
  let doc: Document;
  try {
    doc = new DOMParser({
      onError: onWarningStopParsing,
      locator: false,
    }).parseFromString(xml, "text/xml");
  } catch {
    return null;
  }
  return doc.documentElement ?? null;
}

/** The root of a SAML protocol message, which must be samlp:<localName>,
 *  with its ID and Issuer checked. */
function parseMessage(
  xml: string,
  localName: string,
): { root: Element; id: string; issuer: string } {
  const root = parseSamlXml(xml);
  if (root === null) throw new SamlError("saml_request_invalid");
  if (root.namespaceURI !== NS.samlp || root.localName !== localName)
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
  return { root, id, issuer };
}

export function parseAuthnRequest(xml: string): AuthnRequest {
  const { root, id, issuer } = parseMessage(xml, "AuthnRequest");
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
export const newSamlId = () => `_${randomId(20)}`;

/** Allowed clock skew between Prism and the SP for NotBefore. */
const SKEW_SECONDS = 60;
/** How long an assertion may be presented; the POST happens right away. */
export const ASSERTION_TTL_SECONDS = 300;

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
  /** The assertion's ID; a new one when absent. */
  assertionId?: string;
  nameId: { format: NameIdFormat; value: string };
  /** Attribute name → values; empty lists are left out. */
  attributes: Record<string, string[]>;
  /** When the user authenticated (session start), in seconds. */
  authnInstant: number;
  /** RFC 8176 methods of the session, to pick an AuthnContextClassRef. */
  amr: string[];
  /** Names this sign-in in the SP's session, for single logout. */
  sessionIndex: string;
}

/** The top-level code a second-level status goes under. */
function topStatus(status: SamlStatus): SamlStatus {
  switch (status) {
    case "Success":
    case "Requester":
    case "Responder":
      return status;
    // The logout went through, just not everywhere.
    case "PartialLogout":
      return "Success";
    case "InvalidNameIDPolicy":
    case "UnknownPrincipal":
      return "Requester";
    default:
      return "Responder";
  }
}

function statusElement(status: SamlStatus): XmlElement {
  const top = topStatus(status);
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
      ID: newSamlId(),
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
    {
      ID: content.assertionId ?? newSamlId(),
      Version: "2.0",
      IssueInstant: instant(now),
    },
    el("saml:Issuer", {}, dest.idpEntityId),
    el(
      "saml:Subject",
      {},
      nameIdElement(content.nameId, dest.spEntityId),
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
      {
        AuthnInstant: instant(content.authnInstant),
        SessionIndex: content.sessionIndex,
      },
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

// ─── Single Logout ───────────────────────────────────────────────────────────

/** Seconds since the epoch of an xs:dateTime attribute; null if absent or
 *  unreadable. */
function timeAttr(e: Element, name: string): number | null {
  const ms = Date.parse(e.getAttribute(name) ?? "");
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

export interface LogoutRequest {
  id: string;
  issuer: string;
  /** Who to sign out: the NameID the SP got in its assertion. */
  nameId: string;
  destination: string | null;
  issueInstant: number | null;
  notOnOrAfter: number | null;
  /** The message's root element, which a signature has to cover. */
  root: Element;
}

export function parseLogoutRequest(xml: string): LogoutRequest {
  const { root, id, issuer } = parseMessage(xml, "LogoutRequest");
  // An EncryptedID can't be read without an SP-side key Prism never has.
  const nameId = childElement(root, NS.saml, "NameID")?.textContent?.trim();
  if (!nameId) throw new SamlError("saml_request_invalid");
  return {
    id,
    issuer,
    nameId,
    destination: root.getAttribute("Destination") || null,
    issueInstant: timeAttr(root, "IssueInstant"),
    notOnOrAfter: timeAttr(root, "NotOnOrAfter"),
    root,
  };
}

/** How old a signed LogoutRequest may be, so a copy can't be replayed later
 *  to sign someone out without asking. */
const LOGOUT_REQUEST_MAX_AGE_SECONDS = 300;

/** Whether a LogoutRequest was issued just now and hasn't expired. */
export function logoutRequestIsFresh(
  request: LogoutRequest,
  now = Math.floor(Date.now() / 1000),
): boolean {
  const issued = request.issueInstant;
  if (issued === null) return false;
  if (issued > now + SKEW_SECONDS) return false;
  if (issued < now - LOGOUT_REQUEST_MAX_AGE_SECONDS - SKEW_SECONDS)
    return false;
  return (
    request.notOnOrAfter === null || now < request.notOnOrAfter + SKEW_SECONDS
  );
}

export interface LogoutResponse {
  issuer: string;
  inResponseTo: string | null;
  destination: string | null;
  success: boolean;
  /** The message's root element, which a signature has to cover. */
  root: Element;
}

export function parseLogoutResponse(xml: string): LogoutResponse {
  const { root, issuer } = parseMessage(xml, "LogoutResponse");
  const status = childElement(root, NS.samlp, "Status");
  const code = status && childElement(status, NS.samlp, "StatusCode");
  return {
    issuer,
    inResponseTo: root.getAttribute("InResponseTo") || null,
    destination: root.getAttribute("Destination") || null,
    success: code?.getAttribute("Value") === STATUS + "Success",
    root,
  };
}

/** A LogoutRequest from Prism to an SP, and its ID. */
export function logoutRequestElement(opts: {
  idpEntityId: string;
  spEntityId: string;
  destination: string;
  nameId: { format: NameIdFormat; value: string };
  sessionIndex: string;
  now?: number;
}): { id: string; element: XmlElement } {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const id = newSamlId();
  const element = el(
    "samlp:LogoutRequest",
    {
      ID: id,
      Version: "2.0",
      IssueInstant: instant(now),
      Destination: opts.destination,
      NotOnOrAfter: instant(now + ASSERTION_TTL_SECONDS),
    },
    el("saml:Issuer", {}, opts.idpEntityId),
    nameIdElement(opts.nameId, opts.spEntityId),
    el("samlp:SessionIndex", {}, opts.sessionIndex),
  );
  return { id, element };
}

/** A LogoutResponse from Prism to the SP that asked for the logout. */
export function logoutResponseElement(opts: {
  idpEntityId: string;
  destination: string;
  inResponseTo: string;
  status: SamlStatus;
  now?: number;
}): XmlElement {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  return el(
    "samlp:LogoutResponse",
    {
      ID: newSamlId(),
      Version: "2.0",
      IssueInstant: instant(now),
      Destination: opts.destination,
      InResponseTo: opts.inResponseTo,
    },
    el("saml:Issuer", {}, opts.idpEntityId),
    statusElement(opts.status),
  );
}

export type SloBinding = SamlSloBinding;

/** How the browser delivers a message: follow a URL (HTTP-Redirect) or
 *  submit a form (HTTP-POST). */
export type OutgoingMessage = Exclude<SamlLogoutStep, { kind: "confirm" }>;

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const out = await new Response(
    new Blob([bytes as Uint8Array<ArrayBuffer>])
      .stream()
      .pipeThrough(new CompressionStream("deflate-raw")),
  ).arrayBuffer();
  return new Uint8Array(out);
}

/**
 * A logout message, signed, ready for the browser to carry to `url`. With
 * the HTTP-POST binding the XML carries an enveloped signature; with
 * HTTP-Redirect the query string is signed (SAML Bindings §3.4.4.1), since
 * an XML signature wouldn't survive the deflate.
 */
export async function encodeLogoutMessage(
  element: XmlElement,
  opts: {
    field: "SAMLRequest" | "SAMLResponse";
    binding: SloBinding;
    url: string;
    relayState: string | null;
    signer: SamlSigner;
  },
): Promise<OutgoingMessage> {
  if (opts.binding === "post") {
    const signed = await signElement(element, opts.signer);
    const fields: Record<string, string> = {
      [opts.field]: encodeResponse(signed),
    };
    if (opts.relayState) fields.RelayState = opts.relayState;
    return { kind: "post", url: opts.url, fields };
  }
  const deflated = await deflateRaw(utf8.encode(serializeDocument(element)));
  let query = `${opts.field}=${encodeURIComponent(bytesToBase64(deflated))}`;
  if (opts.relayState)
    query += `&RelayState=${encodeURIComponent(opts.relayState)}`;
  query += `&SigAlg=${encodeURIComponent(RSA_SHA256)}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      opts.signer.privateKey,
      utf8.encode(query),
    ),
  );
  query += `&Signature=${encodeURIComponent(bytesToBase64(signature))}`;
  const sep = opts.url.includes("?") ? "&" : "?";
  return { kind: "redirect", url: `${opts.url}${sep}${query}` };
}

// ─── Metadata ────────────────────────────────────────────────────────────────

export function buildIdpMetadata(opts: {
  entityId: string;
  ssoUrl: string;
  sloUrl: string;
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
        el("md:SingleLogoutService", {
          Binding: BINDING_REDIRECT,
          Location: opts.sloUrl,
        }),
        el("md:SingleLogoutService", {
          Binding: BINDING_POST,
          Location: opts.sloUrl,
        }),
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
