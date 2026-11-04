// Other apps' permissions for SAML apps: the SAML 2.0 bearer assertion
// grant (RFC 7522).
//
// SAML gives an app no access token, so an app with other apps' permissions
// (app:<client_id>:<scope>) among its scopes can't call those apps. When
// sign-in releases such permissions, the assertion is recorded with them
// (migration 0092), and the app trades the assertion for an access token at
// the token endpoint, once, while it's valid.
//
// The assertion is the one Prism just issued to the app, unchanged: its
// audience is the app's entity ID and its recipient the ACS URL, not the
// token endpoint as RFC 7522 §3 has it for an assertion from another
// issuer. Prism is both, and the record says which app may trade it.

import { parseAppScope } from "../scopes";
import { ASSERTION_TTL_SECONDS, parseSamlXml } from "./protocol";
import { verifyPostSignature } from "./verify";
import { decodeBase64 } from "./x509";
import { NS } from "./xml";
import type { Element } from "@xmldom/xmldom";

export const SAML2_BEARER_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:saml2-bearer";

/** The `assertion` parameter's size cap, encoded. Assertions with many
 *  teams and groups are still far smaller. */
const MAX_ENCODED_ASSERTION = 256 * 1024;

/** The other apps' permissions among `scopes`. */
export const crossAppScopes = (scopes: string[]) =>
  scopes.filter((s) => parseAppScope(s) !== null);

/** Record an assertion that releases other apps' permissions, so the app
 *  can trade it for an access token. */
export async function recordAssertionGrant(
  db: D1Database,
  grant: {
    appId: string;
    assertionId: string;
    userId: string;
    subject: string;
    scopes: string[];
    authTime: number | null;
    amr: string[];
  },
  now = Math.floor(Date.now() / 1000),
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO saml_assertion_grants
         (app_id, assertion_id, user_id, subject, scopes, auth_time, amr, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      grant.appId,
      grant.assertionId,
      grant.userId,
      grant.subject,
      JSON.stringify(grant.scopes),
      grant.authTime,
      grant.amr.length ? JSON.stringify(grant.amr) : null,
      now + ASSERTION_TTL_SECONDS,
    )
    .run();
}

function elementChildren(parent: Element, ns: string, localName: string) {
  const out: Element[] = [];
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType !== 1) continue;
    const e = n as Element;
    if (e.namespaceURI === ns && e.localName === localName) out.push(e);
  }
  return out;
}

/** UTF-8 text of base64 or base64url (RFC 7522 §2.1), or null. */
function decodeAssertionParam(value: string): string | null {
  if (value.length > MAX_ENCODED_ASSERTION) return null;
  // A "+" sent unencoded in a form body arrives as a space.
  const b64 = value
    .replace(/ /g, "+")
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
      decodeBase64(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")),
    );
  } catch {
    return null;
  }
}

/**
 * The ID of the assertion in the grant's `assertion` parameter when Prism
 * signed it with `certificate`, or null. Either the assertion itself, signed;
 * or the whole Response it came in (what the app's SAMLResponse field held),
 * with the Response or its one assertion signed.
 */
export async function signedAssertionId(
  value: string,
  certificate: Uint8Array,
): Promise<string | null> {
  const xml = decodeAssertionParam(value);
  const root = xml === null ? null : parseSamlXml(xml);
  if (!root) return null;

  let assertion: Element | null = null;
  if (root.namespaceURI === NS.saml && root.localName === "Assertion") {
    if (await verifyPostSignature(root, certificate)) assertion = root;
  } else if (root.namespaceURI === NS.samlp && root.localName === "Response") {
    // Exactly one, a direct child: what's signed is what's read.
    const found = elementChildren(root, NS.saml, "Assertion");
    if (
      found.length === 1 &&
      ((await verifyPostSignature(root, certificate)) ||
        (await verifyPostSignature(found[0], certificate)))
    )
      assertion = found[0];
  }
  return assertion?.getAttribute("ID") || null;
}

/** A saml_assertion_grants row. */
export interface AssertionGrantRow {
  app_id: string;
  assertion_id: string;
  user_id: string;
  subject: string;
  scopes: string;
  auth_time: number | null;
  amr: string | null;
  expires_at: number;
  consumed_at: number | null;
}

/** Use up the grant recorded for this app's assertion; null when there is
 *  none, it expired, or it was used. */
export function redeemAssertionGrant(
  db: D1Database,
  appId: string,
  assertionId: string,
  now = Math.floor(Date.now() / 1000),
): Promise<AssertionGrantRow | null> {
  return db
    .prepare(
      `UPDATE saml_assertion_grants SET consumed_at = ?1
       WHERE app_id = ?2 AND assertion_id = ?3 AND consumed_at IS NULL AND expires_at > ?1
       RETURNING *`,
    )
    .bind(now, appId, assertionId)
    .first<AssertionGrantRow>();
}
