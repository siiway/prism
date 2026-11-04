// SAML service providers: the SP side of an app, what Prism tells SPs about
// itself, and which user attributes an SP receives.

import { getConfigValue } from "../config";
import { validateRedirectUriForRegistration } from "../redirectUri";
import { getGroupsForUserByTeam } from "../teamGroups";
import type { AuthUser, OAuthAppRow } from "../../types";
import type { SamlBlock } from "../../../shared/api";
import type { NameIdFormat, SignMode, SloBinding } from "./protocol";
import { isUsableCertificate } from "./verify";
import { bytesToBase64, certificateFromText } from "./x509";

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

const NAME_ID_FORMATS: readonly NameIdFormat[] = ["persistent", "email"];
const SIGN_MODES: readonly SignMode[] = ["assertion", "response", "both"];
const SLO_BINDINGS: readonly SloBinding[] = ["redirect", "post"];
const MAX_ACS_URLS = 10;
const MAX_ENTITY_ID_LENGTH = 1024;
const MAX_ACS_URL_LENGTH = 2048;

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

/** An ACS (or single logout) URL Prism may send messages to, by the rules
 *  for an OAuth redirect URI: absolute https, or http on a loopback host
 *  for local development; no fragment, no credentials. */
function isValidAcsUrl(value: string): boolean {
  return (
    value.length <= MAX_ACS_URL_LENGTH &&
    validateRedirectUriForRegistration(value) === null
  );
}

/** An entity ID: a URI, in practice a URL or a URN, without whitespace. */
function isValidEntityId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_ENTITY_ID_LENGTH &&
    !/\s/.test(value) &&
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
  );
}

/** The SP settings an app owner saves, checked; stored as given. */
export interface SpSettings {
  entity_id: string;
  acs_urls: string[];
  name_id_format: NameIdFormat;
  sign: SignMode;
  slo_url: string | null;
  slo_binding: SloBinding;
  /** Base64 DER; null when none is given. */
  signing_cert: string | null;
}

/** An API error: its code, and `params` for anything to fill in. */
type FieldError = { error: string; params?: Record<string, unknown> };

/** One of `allowed`, `fallback` when absent. */
function oneOf<T extends string>(
  field: string,
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): { value: T } | FieldError {
  const v = value ?? fallback;
  return allowed.includes(v as T)
    ? { value: v as T }
    : { error: "field_one_of", params: { field, values: allowed.join(", ") } };
}

/** An app owner's SP settings from a request body, or why they can't be
 *  saved. */
export async function parseSpSettings(
  body: Record<string, unknown>,
): Promise<{ value: SpSettings } | FieldError> {
  const entityId =
    typeof body.entity_id === "string" ? body.entity_id.trim() : "";
  if (!entityId)
    return { error: "field_required", params: { field: "entity_id" } };
  if (!isValidEntityId(entityId))
    return { error: "field_invalid", params: { field: "entity_id" } };

  const acsUrls = Array.isArray(body.acs_urls)
    ? [
        ...new Set(
          body.acs_urls
            .filter((u): u is string => typeof u === "string")
            .map((u) => u.trim())
            .filter(Boolean),
        ),
      ]
    : [];
  if (acsUrls.length === 0)
    return { error: "field_required", params: { field: "acs_urls" } };
  if (acsUrls.length > MAX_ACS_URLS)
    return {
      error: "field_max_items",
      params: { field: "acs_urls", max: MAX_ACS_URLS },
    };
  const badAcs = acsUrls.find((u) => !isValidAcsUrl(u));
  if (badAcs) return { error: "saml_acs_url_invalid", params: { url: badAcs } };

  const nameIdFormat = oneOf(
    "name_id_format",
    body.name_id_format,
    NAME_ID_FORMATS,
    "persistent",
  );
  if ("error" in nameIdFormat) return nameIdFormat;
  const sign = oneOf("sign", body.sign, SIGN_MODES, "assertion");
  if ("error" in sign) return sign;

  // Single logout is optional: an empty URL turns it off.
  const sloUrl = typeof body.slo_url === "string" ? body.slo_url.trim() : "";
  if (sloUrl && !isValidAcsUrl(sloUrl))
    return { error: "field_invalid", params: { field: "slo_url" } };
  const sloBinding = oneOf(
    "slo_binding",
    body.slo_binding,
    SLO_BINDINGS,
    "redirect",
  );
  if ("error" in sloBinding) return sloBinding;

  // The SP's signing certificate is optional too: with it, its logout
  // messages must be signed. PEM or the bare base64 from its metadata. It
  // only checks logout messages, so it goes with single logout.
  const certText =
    sloUrl && typeof body.signing_cert === "string"
      ? body.signing_cert.trim()
      : "";
  let signingCert: string | null = null;
  if (certText) {
    const der = certificateFromText(certText);
    if (!der || !(await isUsableCertificate(der)))
      return { error: "saml_certificate_invalid" };
    signingCert = bytesToBase64(der);
  }

  return {
    value: {
      entity_id: entityId,
      acs_urls: acsUrls,
      name_id_format: nameIdFormat.value,
      sign: sign.value,
      slo_url: sloUrl || null,
      slo_binding: sloBinding.value,
      signing_cert: signingCert,
    },
  };
}

/** An app's SP settings; null while SAML is off for it. */
export function getServiceProvider(
  db: D1Database,
  appId: string,
): Promise<SamlSpRow | null> {
  return db
    .prepare("SELECT * FROM saml_service_providers WHERE app_id = ?")
    .bind(appId)
    .first<SamlSpRow>();
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
 * `uid` is always sent, so an SP that uses email as the NameID still has a
 * stable key: `subjectId`, the ID of the user's SAML profile for this app
 * (lib/saml/profiles.ts), never the Prism user ID. Email goes out only once
 * verified: SAML has no email_verified flag, and SPs commonly link accounts
 * by email.
 */
export async function samlAttributes(
  db: D1Database,
  user: AuthUser,
  scopes: string[],
  subjectId: string,
): Promise<Record<string, string[]>> {
  const attrs: Record<string, string[]> = { uid: [subjectId] };
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
