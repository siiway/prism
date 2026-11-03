// SAML service providers: the SP side of an app, what Prism tells SPs about
// itself, and which user attributes an SP receives.

import { getGroupsForUserByTeam } from "../teamGroups";
import type { AuthUser, OAuthAppRow } from "../../types";
import type { NameIdFormat, SignMode } from "./protocol";

export interface SamlSpRow {
  app_id: string;
  entity_id: string;
  /** JSON string[]; the first entry is the default ACS URL. */
  acs_urls: string;
  name_id_format: NameIdFormat;
  sign: SignMode;
  created_at: number;
  updated_at: number;
}

export const NAME_ID_FORMATS: readonly NameIdFormat[] = ["persistent", "email"];
export const SIGN_MODES: readonly SignMode[] = [
  "assertion",
  "response",
  "both",
];
export const MAX_ACS_URLS = 10;
export const MAX_ENTITY_ID_LENGTH = 1024;
export const MAX_ACS_URL_LENGTH = 2048;

export function parseAcsUrls(row: Pick<SamlSpRow, "acs_urls">): string[] {
  try {
    const value = JSON.parse(row.acs_urls) as unknown;
    return Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

/** Prism's identity-provider endpoints. The metadata URL doubles as the
 *  IdP entity ID, as is conventional. */
export function idpEndpoints(appUrl: string) {
  const base = appUrl.replace(/\/+$/, "");
  return {
    entityId: `${base}/saml/metadata`,
    metadataUrl: `${base}/saml/metadata`,
    ssoUrl: `${base}/saml/sso`,
  };
}

/** An ACS URL Prism may post assertions to: absolute https, or http on a
 *  loopback host for local development; no fragment, no credentials. */
export function isValidAcsUrl(value: string): boolean {
  if (value.length > MAX_ACS_URL_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return (
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  );
}

/** An entity ID: a URI, in practice a URL or a URN, without whitespace. */
export function isValidEntityId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_ENTITY_ID_LENGTH &&
    !/\s/.test(value) &&
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
  );
}

/** Scopes whose attributes SAML can carry. An SP gets those among the
 *  app's allowed scopes: SAML has no way to ask for less per request. */
const SAML_SCOPES = ["profile", "email", "teams:read"];

export function releasedScopes(app: Pick<OAuthAppRow, "allowed_scopes">) {
  let allowed: string[] = [];
  try {
    allowed = JSON.parse(app.allowed_scopes) as string[];
  } catch {
    allowed = [];
  }
  return SAML_SCOPES.filter((s) => allowed.includes(s));
}

/**
 * The assertion's attributes for `scopes`, as attribute name → values.
 * `uid` (the Prism user ID) is always sent, so an SP that uses email as the
 * NameID still has a stable key. Email goes out only once verified: SAML has
 * no email_verified flag, and SPs commonly link accounts by email.
 */
export async function samlAttributes(
  db: D1Database,
  user: AuthUser,
  scopes: string[],
): Promise<Record<string, string[]>> {
  const attrs: Record<string, string[]> = { uid: [user.id] };
  if (scopes.includes("profile")) {
    attrs.username = [user.username];
    attrs.name = [user.display_name || user.username];
  }
  if (scopes.includes("email") && user.email && user.email_verified)
    attrs.email = [user.email];
  if (scopes.includes("teams:read")) {
    const { results } = await db
      .prepare("SELECT team_id FROM team_members WHERE user_id = ?")
      .bind(user.id)
      .all<{ team_id: string }>();
    const teamIds = results.map((r) => r.team_id);
    const groups = await getGroupsForUserByTeam(db, user.id, teamIds);
    attrs.teams = teamIds;
    attrs.groups = teamIds.flatMap((id) =>
      (groups.get(id) ?? []).map((g) => `${id}:${g.slug}`),
    );
  }
  return attrs;
}
