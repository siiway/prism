// SAML service providers: the SP side of an app, what Prism tells SPs about
// itself, and which user attributes an SP receives.

import { getConfigValue } from "../config";
import { getGroupsForUserByTeam } from "../teamGroups";
import type { AuthUser, OAuthAppRow } from "../../types";
import type { NameIdFormat, SignMode, SloBinding } from "./protocol";

export interface SamlSpRow {
  app_id: string;
  entity_id: string;
  /** JSON string[]; the first entry is the default ACS URL. */
  acs_urls: string;
  name_id_format: NameIdFormat;
  sign: SignMode;
  /** SingleLogoutService URL; null when the SP has no single logout. */
  slo_url: string | null;
  slo_binding: SloBinding;
  /** Base64 DER of the SP's signing certificate; null when none. */
  signing_cert: string | null;
  created_at: number;
  updated_at: number;
}

export const NAME_ID_FORMATS: readonly NameIdFormat[] = ["persistent", "email"];
export const SIGN_MODES: readonly SignMode[] = [
  "assertion",
  "response",
  "both",
];
export const SLO_BINDINGS: readonly SloBinding[] = ["redirect", "post"];
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
    sloUrl: `${base}/saml/slo`,
  };
}

/** An ACS (or single logout) URL Prism may send messages to: absolute
 *  https, or http on a loopback host for local development; no fragment,
 *  no credentials. */
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

export type SamlBlock =
  "saml_disabled" | "saml_disabled_user" | "saml_disabled_app";

/** An admin override as stored: 1 allow, 0 stop, null = the level above. */
export function samlOverrideValue(
  v: number | null | undefined,
): boolean | null {
  return v === 1 ? true : v === 0 ? false : null;
}

/** What an app owner (a user, or a team's user row) gets: an admin's
 *  override for them, and the site setting it otherwise follows. */
export async function samlOwnerSetting(
  db: D1Database,
  ownerId: string,
): Promise<{ override: boolean | null; inherited: boolean }> {
  const [siteOn, owner] = await Promise.all([
    getConfigValue(db, "saml_enabled"),
    db
      .prepare("SELECT saml_override FROM users WHERE id = ?")
      .bind(ownerId)
      .first<{ saml_override: number | null }>(),
  ]);
  return {
    override: samlOverrideValue(owner?.saml_override),
    inherited: siteOn !== false,
  };
}

/**
 * Why an app can't use SAML right now, as an API error code, or null when
 * it can. Site admins decide with overrides: the app's beats its owner's,
 * which beats the saml_enabled site setting.
 */
export async function samlBlock(
  db: D1Database,
  app: { owner_id: string; saml_override?: number | null },
): Promise<SamlBlock | null> {
  if (app.saml_override === 1) return null;
  if (app.saml_override === 0) return "saml_disabled_app";
  const owner = await samlOwnerSetting(db, app.owner_id);
  if (owner.override === false) return "saml_disabled_user";
  if (owner.override === null && !owner.inherited) return "saml_disabled";
  return null;
}
