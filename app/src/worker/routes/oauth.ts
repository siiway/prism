// OAuth 2.0 Authorization Server (Authorization Code + PKCE, OpenID Connect)

import { Hono } from "hono";
import type { Context } from "hono";
import { getConfig, getConfigValue, getRsaKeyPair } from "../lib/config";
import { hashSecret, hashLookupCandidate } from "../lib/secretCrypto";
import { getMLDSAKey } from "../lib/mldsa";
import {
  signAccessToken,
  verifyAccessToken,
  verifyIdTokenRS256,
  extractAud,
} from "../lib/jwt";
import { randomBase64url, randomId, verifyPkce } from "../lib/crypto";
import { verifyAnyTotp } from "../lib/totp";
import { requireAuth, optionalAuth } from "../middleware/auth";
import {
  computeIsVerified,
  buildVerifiedDomainsMap,
  buildVerifiedTeamDomainsMap,
  computeVerified,
} from "../lib/domainVerify";
import { proxyImageUrl } from "../lib/proxyImage";
import { readPage, likePattern } from "../lib/pagination";
import {
  parseRedirectUris,
  redirectUriMatchesRegistered,
} from "../lib/redirectUri";
import {
  parseAppScope,
  canClientIntrospectToken,
  parseUnboundTeamScope,
  parseBoundTeamScope,
  bindTeamScopes,
  UNBOUND_TEAM_SCOPES,
} from "../lib/scopes";
import type { TeamPermission } from "../../shared/scopes";
import { deliverAppEvent } from "../lib/app-events";
import {
  checkAppAuthorizationAllowed,
  getRestrictionState,
} from "../lib/userCapabilities";
import { getGroupsForUserByTeam } from "../lib/teamGroups";
import { recordAudit, auditRequestMeta, type AuditInput } from "../lib/audit";
import { getEffectiveMember, listEffectiveTeamMemberships } from "../lib/teams";
import { checkAccessWhitelist } from "../lib/appAccess";
import {
  deliverUserEmailNotifications,
  notificationActorMetaFromHeaders,
} from "../lib/notifications";
import type {
  OAuthAppRow,
  OAuthCodeRow,
  OAuthDeviceCodeRow,
  OAuthTokenRow,
  UserRow,
  Variables,
} from "../types";
import {
  collectResourceParams,
  validateResources,
  serializeResources,
  parseResources,
} from "../lib/resource";
import { verifyDpopProof } from "../lib/dpop";
import { deliverBackChannelLogout } from "../lib/backchannelLogout";
import {
  LOGOUT_TTL_SECONDS,
  startIdpLogout,
  startUnverifiedLogout,
} from "../lib/saml/logout";
import { clearSessionCookie, setSamlLogoutCookie } from "../lib/cookies";
import meRoutes from "./oauth-me";
import {
  DEVICE_GRANT_TYPE,
  TOKEN_EXCHANGE_GRANT_TYPE,
  TOKEN_TYPE_ACCESS_TOKEN,
  authenticateClient,
  buildConsentAppSummary,
  readOAuthBody,
} from "../lib/oauthClients";
import { REQUESTABLE_SCOPES } from "../lib/scopes";
import { deriveAcr } from "../lib/stepUp";
import stepUpRoutes from "./oauth-stepup";
import registrationRoutes from "./oauth-registration";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

const SITE_SCOPES = new Set([
  "site:user:read",
  "site:user:write",
  "site:user:delete",
  "site:team:read",
  "site:team:write",
  "site:team:delete",
  "site:config:read",
  "site:config:write",
  "site:token:revoke",
]);

const SITE_SCOPE_CONFIRM_PHRASE = "grant site access";

function hasSiteScopes(scopes: string[]): boolean {
  return scopes.some((s) => SITE_SCOPES.has(s));
}

function hasUnboundTeamScopes(scopes: string[]): boolean {
  return scopes.some((s) => UNBOUND_TEAM_SCOPES.has(s));
}

function unboundTeamPermissions(scopes: string[]): TeamPermission[] {
  return scopes
    .map((s) => parseUnboundTeamScope(s))
    .filter((p): p is TeamPermission => p !== null);
}

/**
 * RFC 6749 §5.1: token endpoint responses (success and error) carry
 * credentials, so they MUST NOT be cached by intermediaries.
 */
function noStore(c: Context<AppEnv>): void {
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
}

/**
 * RFC 6749 §5.2 / RFC 7617: when a client authenticated (or attempted to)
 * with the `Authorization` header, an `invalid_client` response MUST return
 * 401 with a matching `WWW-Authenticate` challenge.
 */
function challengeBasic(c: Context<AppEnv>): void {
  c.header(
    "WWW-Authenticate",
    `Basic realm="${c.env.APP_URL}", charset="UTF-8"`,
  );
}

/**
 * RFC 6750 §3: a failed Bearer-protected request MUST include a
 * `WWW-Authenticate: Bearer` challenge, carrying the error code (and optional
 * description) when a token was supplied but rejected. When no credentials
 * were presented at all, the challenge is sent without an error code.
 */
function challengeBearer(
  c: Context<AppEnv>,
  error?: "invalid_token" | "insufficient_scope" | "invalid_request",
  description?: string,
): void {
  let value = `Bearer realm="${c.env.APP_URL}"`;
  if (error) value += `, error="${error}"`;
  if (description) value += `, error_description="${description}"`;
  // RFC 9728 §5.1: point the client at the protected-resource metadata.
  value += `, resource_metadata="${c.env.APP_URL}/.well-known/oauth-protected-resource"`;
  c.header("WWW-Authenticate", value);
}

/**
 * RFC 9449 §7.2: a resource that expects a DPoP-bound token challenges with the
 * `DPoP` scheme and the algorithms it accepts. Used when a bound token is
 * presented without a valid proof.
 */
function challengeDpop(
  c: Context<AppEnv>,
  error?: "invalid_token" | "invalid_dpop_proof",
  description?: string,
): void {
  let value = `DPoP algs="RS256 ES256 EdDSA"`;
  if (error) value += `, error="${error}"`;
  if (description) value += `, error_description="${description}"`;
  value += `, resource_metadata="${c.env.APP_URL}/.well-known/oauth-protected-resource"`;
  c.header("WWW-Authenticate", value);
}

// ─── Pushed Authorization Requests (RFC 9126) ────────────────────────────────

/** Authorization request parameters a client pushed to /par, held server-side
 *  under a one-time request_uri. The consent screen and the approval endpoint
 *  read these back rather than trusting query parameters, so a pushed request
 *  cannot be tampered with between /par and /authorize. */
interface PushedRequest {
  client_id: string;
  redirect_uri: string;
  scope: string;
  optional_scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  nonce?: string;
  response_type: string;
  resource?: string[];
  prompt?: string;
  max_age?: number;
  acr_values?: string;
}

const PAR_URN_PREFIX = "urn:ietf:params:oauth:request_uri:";
// RFC 9126 §2.2: request_uri values are short-lived. 90s comfortably covers a
// redirect + consent render without leaving a stale entry usable for long.
const PAR_TTL_SECONDS = 90;

async function storePushedRequest(
  env: Env,
  payload: PushedRequest,
): Promise<{ requestUri: string; expiresIn: number }> {
  const id = randomBase64url(32);
  await env.KV_CACHE.put(`par:${id}`, JSON.stringify(payload), {
    expirationTtl: PAR_TTL_SECONDS,
  });
  return { requestUri: `${PAR_URN_PREFIX}${id}`, expiresIn: PAR_TTL_SECONDS };
}

async function loadPushedRequest(
  env: Env,
  requestUri: string,
): Promise<PushedRequest | null> {
  if (!requestUri.startsWith(PAR_URN_PREFIX)) return null;
  const id = requestUri.slice(PAR_URN_PREFIX.length);
  if (!id) return null;
  const raw = await env.KV_CACHE.get(`par:${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PushedRequest;
  } catch {
    return null;
  }
}

/** One-time use: consume a pushed request so its request_uri can't be replayed
 *  (RFC 9126 §2.2). Best-effort — the KV TTL is the backstop. */
function consumePushedRequest(env: Env, requestUri: string): void {
  if (!requestUri.startsWith(PAR_URN_PREFIX)) return;
  const id = requestUri.slice(PAR_URN_PREFIX.length);
  if (id) void env.KV_CACHE.delete(`par:${id}`).catch(() => {});
}

// ─── Device Authorization Grant (RFC 8628) ───────────────────────────────────

// RFC 8628 §6.1 recommends a base-20, vowel-free alphabet: no accidental words,
// no visually ambiguous characters. 8 characters gives ~40 bits of entropy.
const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
const DEVICE_CODE_TTL_SECONDS = 600;
const DEVICE_POLL_INTERVAL_SECONDS = 5;

function generateUserCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let code = "";
  for (const b of bytes)
    code += USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length];
  // Display form groups the halves with a hyphen (WDJB-MJHT); the hyphen is
  // cosmetic and stripped on lookup.
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Normalize a user-entered code for lookup: uppercase, keep only alphabet
 *  characters (so hyphens, spaces, and casing the user typed don't matter). */
function normalizeUserCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// ─── Scope helpers ───────────────────────────────────────────────────────────

/**
 * Resolves requested scopes against what the app is allowed to request.
 * Regular platform scopes are checked against REQUESTABLE_SCOPES.
 * App-delegation scopes (app:<client_id>:<inner_scope>) are accepted when:
 *   - the inner scope is non-empty (it may be a platform scope OR an
 *     app-defined identifier registered in app_scope_definitions, e.g.
 *     `read_posts`)
 *   - the full scope string is listed in the app's allowed_scopes
 *   - the referenced target app exists and is active (DB check)
 *   - the target app's access rules permit the requesting client
 * Returns [validScopes, resolvedAppScopes] where resolvedAppScopes carries
 * the target app name/icon for the consent UI.
 */
/** Why a requested scope was filtered out of the consent screen. Surfaced
 *  back to the user so they can see what an app asked for vs what was granted. */
export type RejectedScopeReason =
  /** Not registered in the app's `allowed_scopes` whitelist. */
  | "not_allowed"
  /** Unknown / malformed scope (not a platform scope, team scope, or `app:*` form). */
  | "unknown"
  /** Cross-app `app:*` scope, but the target app's owner has explicitly denied
   *  this requesting app via `app_deny` or omitted it from an `app_allow` list. */
  | "app_denied"
  /** Cross-app `app:*` scope, but the target app no longer exists / is inactive. */
  | "target_missing";

async function resolveRequestedScopes(
  db: D1Database,
  appUrl: string,
  requestedScopes: string[],
  allowedScopes: string[],
  requestingClientId: string,
): Promise<{
  scopes: string[];
  appScopes: Array<{
    scope: string;
    client_id: string;
    inner_scope: string;
    app_name: string;
    app_icon_url: string | null;
    scope_title: string | null;
    scope_desc: string | null;
  }>;
  rejected: Array<{ scope: string; reason: RejectedScopeReason }>;
}> {
  const regular: string[] = [];
  const appScopeRequests: string[] = [];
  const rejected: Array<{ scope: string; reason: RejectedScopeReason }> = [];

  for (const s of requestedScopes) {
    const parsed = parseAppScope(s);
    if (parsed) {
      // Cross-app scope: inner part may be a platform scope OR an app-defined
      // identifier (registered via app_scope_definitions). parseAppScope
      // already enforces non-empty clientId and non-empty innerScope.
      if (!allowedScopes.includes(s)) {
        rejected.push({ scope: s, reason: "not_allowed" });
      } else {
        appScopeRequests.push(s);
      }
      continue;
    }
    if (REQUESTABLE_SCOPES.has(s) || UNBOUND_TEAM_SCOPES.has(s)) {
      if (!allowedScopes.includes(s)) {
        rejected.push({ scope: s, reason: "not_allowed" });
      } else {
        regular.push(s);
      }
    } else {
      rejected.push({ scope: s, reason: "unknown" });
    }
  }

  if (appScopeRequests.length === 0) {
    return { scopes: regular, appScopes: [], rejected };
  }

  // Batch-lookup unique target client_ids
  const targetClientIds = [
    ...new Set(appScopeRequests.map((s) => parseAppScope(s)!.clientId)),
  ];
  const targetApps = await Promise.all(
    targetClientIds.map((cid) =>
      db
        .prepare(
          "SELECT id, client_id, name, icon_url FROM oauth_apps WHERE client_id = ? AND is_active = 1",
        )
        .bind(cid)
        .first<{
          id: string;
          client_id: string;
          name: string;
          icon_url: string | null;
        }>(),
    ),
  );
  const appsMap = new Map(
    targetApps
      .filter(Boolean)
      .map((a) => [a!.client_id, a!] as [string, typeof a & {}]),
  );

  // Check app-level access rules for each target app and requesting app's client_id
  // We need the requesting app's client_id — it's derived from the app row itself (passed in as appAllowedScopes parent)
  // but we don't have it here. We'll filter in the caller or pass it in.
  // For now, resolve per-target-app rules inline.

  const appScopes: Array<{
    scope: string;
    client_id: string;
    inner_scope: string;
    app_name: string;
    app_icon_url: string | null;
    scope_title: string | null;
    scope_desc: string | null;
  }> = [];

  // Batch-lookup scope definitions and access rules per target app
  const targetAppIds = [...appsMap.values()].map((a) => a.id);
  const [scopeDefsResult, accessRulesResult] = await Promise.all([
    targetAppIds.length
      ? db
          .prepare(
            `SELECT app_id, scope, title, description FROM app_scope_definitions WHERE app_id IN (${targetAppIds.map(() => "?").join(",")})`,
          )
          .bind(...targetAppIds)
          .all<{
            app_id: string;
            scope: string;
            title: string;
            description: string;
          }>()
      : Promise.resolve({
          results: [] as {
            app_id: string;
            scope: string;
            title: string;
            description: string;
          }[],
        }),
    targetAppIds.length
      ? db
          .prepare(
            `SELECT app_id, rule_type, target_id FROM app_scope_access_rules WHERE app_id IN (${targetAppIds.map(() => "?").join(",")}) AND rule_type IN ('app_allow','app_deny')`,
          )
          .bind(...targetAppIds)
          .all<{ app_id: string; rule_type: string; target_id: string }>()
      : Promise.resolve({
          results: [] as {
            app_id: string;
            rule_type: string;
            target_id: string;
          }[],
        }),
  ]);

  // Build lookup maps
  const scopeDefsMap = new Map<
    string,
    Map<string, { title: string; description: string }>
  >();
  for (const d of scopeDefsResult.results) {
    if (!scopeDefsMap.has(d.app_id)) scopeDefsMap.set(d.app_id, new Map());
    scopeDefsMap
      .get(d.app_id)!
      .set(d.scope, { title: d.title, description: d.description });
  }

  const accessRulesMap = new Map<
    string,
    { allowList: string[]; denyList: string[] }
  >();
  for (const r of accessRulesResult.results) {
    if (!accessRulesMap.has(r.app_id))
      accessRulesMap.set(r.app_id, { allowList: [], denyList: [] });
    const entry = accessRulesMap.get(r.app_id)!;
    if (r.rule_type === "app_allow") entry.allowList.push(r.target_id);
    else if (r.rule_type === "app_deny") entry.denyList.push(r.target_id);
  }

  for (const s of appScopeRequests) {
    const parsed = parseAppScope(s)!;
    const target = appsMap.get(parsed.clientId);
    if (!target) {
      rejected.push({ scope: s, reason: "target_missing" });
      continue;
    }

    // Check app-level access rules (requesting app's client_id vs target app's rules)
    const rules = accessRulesMap.get(target.id);
    if (rules) {
      if (rules.denyList.includes(requestingClientId)) {
        rejected.push({ scope: s, reason: "app_denied" });
        continue;
      }
      if (
        rules.allowList.length > 0 &&
        !rules.allowList.includes(requestingClientId)
      ) {
        rejected.push({ scope: s, reason: "app_denied" });
        continue;
      }
    }

    const def = scopeDefsMap.get(target.id)?.get(parsed.innerScope);
    appScopes.push({
      scope: s,
      client_id: parsed.clientId,
      inner_scope: parsed.innerScope,
      app_name: target.name,
      app_icon_url: await proxyImageUrl(appUrl, db, target.icon_url),
      scope_title: def?.title ?? null,
      scope_desc: def?.description ?? null,
    });
  }

  return {
    scopes: [...regular, ...appScopes.map((a) => a.scope)],
    appScopes,
    rejected,
  };
}

// ─── Authorization endpoint ───────────────────────────────────────────────────

// GET /api/oauth/consents — list apps the user has granted access to
app.get("/consents", requireAuth, async (c) => {
  const user = c.get("user");
  const now = Math.floor(Date.now() / 1000);
  const { page, limit, offset } = readPage(
    c.req.query("page"),
    c.req.query("limit"),
    20,
  );
  const query = c.req.query("q")?.trim() ?? "";

  const where = query
    ? "oc.user_id = ? AND LOWER(oa.name) LIKE LOWER(?) ESCAPE '\\'"
    : "oc.user_id = ?";
  const args: unknown[] = query ? [user.id, likePattern(query)] : [user.id];

  const [consentRows, countRow, tokenRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT oc.client_id, oc.scopes, oc.granted_at, oc.auto_authorize,
              oa.name, oa.description, oa.icon_url, oa.website_url,
              oa.owner_id, oa.team_id, oa.redirect_uris
       FROM oauth_consents oc
       JOIN oauth_apps oa ON oa.client_id = oc.client_id
       WHERE ${where}
       ORDER BY oc.granted_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(...args, limit, offset)
      .all<{
        client_id: string;
        scopes: string;
        granted_at: number;
        auto_authorize: number;
        name: string;
        description: string;
        icon_url: string | null;
        website_url: string | null;
        owner_id: string;
        team_id: string | null;
        redirect_uris: string;
      }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM oauth_consents oc
       JOIN oauth_apps oa ON oa.client_id = oc.client_id
       WHERE ${where}`,
    )
      .bind(...args)
      .first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT id, client_id, scopes, created_at, expires_at, refresh_expires_at
       FROM oauth_tokens
       WHERE user_id = ? AND (expires_at > ? OR refresh_expires_at > ?)
       ORDER BY created_at DESC`,
    )
      // A remembered sign-in outlives its access token: the refresh token
      // keeps the app signed in, so it stays listed (and revocable) until
      // that runs out too.
      .bind(user.id, now, now)
      .all<{
        id: string;
        client_id: string;
        scopes: string;
        created_at: number;
        expires_at: number;
        refresh_expires_at: number | null;
      }>(),
  ]);

  // Personal domains are keyed by owner_id; team domains by team_id. For
  // team-owned apps we need both — owner_id points at the synthetic
  // team-user which never owns personal domains, so falling back to that
  // alone would mark every team app as unverified.
  const ownerIds = [...new Set(consentRows.results.map((r) => r.owner_id))];
  const teamIds = [
    ...new Set(
      consentRows.results.map((r) => r.team_id).filter((v): v is string => !!v),
    ),
  ];
  const [domainsMap, teamDomainsMap] = await Promise.all([
    buildVerifiedDomainsMap(c.env.DB, ownerIds),
    buildVerifiedTeamDomainsMap(c.env.DB, teamIds),
  ]);

  // Group tokens by client_id
  const tokensByApp = new Map<string, typeof tokenRows.results>();
  for (const t of tokenRows.results) {
    const list = tokensByApp.get(t.client_id) ?? [];
    list.push(t);
    tokensByApp.set(t.client_id, list);
  }

  return c.json({
    consents: await Promise.all(
      consentRows.results.map(async (r) => ({
        client_id: r.client_id,
        scopes: JSON.parse(r.scopes) as string[],
        granted_at: r.granted_at,
        auto_authorize: r.auto_authorize === 1,
        app: {
          name: r.name,
          description: r.description,
          icon_url: await proxyImageUrl(c.env.APP_URL, c.env.DB, r.icon_url),
          unproxied_icon_url: r.icon_url,
          website_url: r.website_url,
          is_verified: computeVerified(
            new Set([
              ...(domainsMap.get(r.owner_id) ?? []),
              ...(r.team_id
                ? (teamDomainsMap.get(r.team_id) ?? new Set<string>())
                : []),
            ]),
            r.website_url,
            r.redirect_uris,
          ),
        },
        tokens: (tokensByApp.get(r.client_id) ?? []).map((t) => ({
          id: t.id,
          scopes: JSON.parse(t.scopes) as string[],
          created_at: t.created_at,
          expires_at: t.expires_at,
          // When the app loses access unless you approve it again.
          ends_at: t.refresh_expires_at ?? t.expires_at,
          is_persistent: t.refresh_expires_at !== null,
        })),
      })),
    ),
    total: countRow?.n ?? 0,
    page,
    limit,
  });
});

// DELETE /api/oauth/me/tokens/:id — revoke a single token by jti
app.delete("/me/tokens/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const tokenId = c.req.param("id");
  await c.env.DB.prepare(
    "DELETE FROM oauth_tokens WHERE id = ? AND user_id = ?",
  )
    .bind(tokenId, user.id)
    .run();
  return c.json({ ok: true });
});

// DELETE /api/oauth/consents/:client_id — revoke consent and associated tokens
app.delete("/consents/:client_id", requireAuth, async (c) => {
  const user = c.get("user");
  const clientId = c.req.param("client_id");

  // Look up app id and name before deleting so we can notify
  const appRow = await c.env.DB.prepare(
    "SELECT id, name FROM oauth_apps WHERE client_id = ?",
  )
    .bind(clientId)
    .first<{ id: string; name: string }>();

  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM oauth_consents WHERE user_id = ? AND client_id = ?",
    ).bind(user.id, clientId),
    c.env.DB.prepare(
      "DELETE FROM oauth_tokens WHERE user_id = ? AND client_id = ?",
    ).bind(user.id, clientId),
  ]);

  if (appRow) {
    c.executionCtx.waitUntil(
      Promise.all([
        deliverAppEvent(c.env, appRow.id, "user.token_revoked", {
          user_id: user.id,
        }).catch(() => {}),
        deliverUserEmailNotifications(
          c.env,
          user.id,
          "oauth.consent_revoked",
          {
            app_name: appRow.name,
            ...notificationActorMetaFromHeaders(c.req.raw.headers),
          },
          c.env.APP_URL,
        ).catch(() => {}),
      ]),
    );
    const meta = auditRequestMeta(c);
    c.executionCtx.waitUntil(
      recordAudit(c.env, c.executionCtx, {
        scope: "user",
        scopeId: user.id,
        action: "oauth.revoke",
        actorId: user.id,
        actorName: user.username,
        resourceType: "app",
        resourceId: appRow.id,
        resourceName: appRow.name,
        ip: meta.ip,
        userAgent: meta.userAgent,
        geo: meta.geo,
        metadata: { client_id: clientId },
      }),
    );
  }

  return c.json({ ok: true });
});

// PATCH /api/oauth/consents/:clientId — update consent settings, e.g. disable auto_authorize
app.patch("/consents/:clientId", requireAuth, async (c) => {
  const user = c.get("user");
  const clientId = c.req.param("clientId");
  const body = await c.req.json<{ auto_authorize?: boolean }>();

  if (body.auto_authorize !== undefined) {
    if (body.auto_authorize) {
      return c.json(
        {
          error: "auto_authorize_only_during_consent",
        },
        400,
      );
    }
    await c.env.DB.prepare(
      "UPDATE oauth_consents SET auto_authorize = 0 WHERE user_id = ? AND client_id = ?",
    )
      .bind(user.id, clientId)
      .run();
  }

  return c.json({ ok: true });
});

// GET /api/oauth/authorize — redirect browser to SPA consent page
app.get("/authorize", (c) => {
  const qs = new URL(c.req.url).search;
  return c.redirect(`/oauth/authorize${qs}`, 302);
});

// GET /api/oauth/app-info — consent screen data (called by the SPA)
app.get("/app-info", optionalAuth, async (c) => {
  let {
    client_id,
    redirect_uri,
    scope,
    optional_scope,
    state,
    response_type,
    code_challenge,
    code_challenge_method,
    nonce,
  } = c.req.query();
  // OIDC Core: prompt (none|login|consent), max_age (seconds), and the RFC 9470
  // acr_values (space-separated requested authentication context).
  let prompt = c.req.query("prompt");
  let maxAgeRaw = c.req.query("max_age");
  let acrValues = c.req.query("acr_values");

  // RFC 9126: when the request was pushed, resolve the stored parameters and
  // render the consent screen from those rather than the query string. The
  // pushed request is left in place (not consumed) so a reload still works;
  // it is consumed only when the authorization is finally approved or denied.
  const requestUri = c.req.query("request_uri");
  if (requestUri) {
    const pushed = await loadPushedRequest(c.env, requestUri);
    if (!pushed)
      return c.json(
        {
          error: "invalid_request",
          error_description: "request_uri is invalid or expired",
        },
        400,
      );
    client_id = pushed.client_id;
    redirect_uri = pushed.redirect_uri;
    scope = pushed.scope;
    optional_scope = pushed.optional_scope ?? optional_scope;
    state = pushed.state ?? state;
    response_type = pushed.response_type;
    code_challenge = pushed.code_challenge ?? "";
    code_challenge_method = pushed.code_challenge_method ?? "";
    nonce = pushed.nonce ?? "";
    prompt = pushed.prompt ?? prompt;
    maxAgeRaw = pushed.max_age != null ? String(pushed.max_age) : maxAgeRaw;
    acrValues = pushed.acr_values ?? acrValues;
  }

  if (!client_id || !redirect_uri || response_type !== "code") {
    return c.json({ error: "invalid_request" }, 400);
  }

  const oauthApp = await c.env.DB.prepare(
    "SELECT * FROM oauth_apps WHERE client_id = ? AND is_active = 1",
  )
    .bind(client_id)
    .first<OAuthAppRow>();
  if (!oauthApp) return c.json({ error: "invalid_client" }, 400);

  const redirectUris = parseRedirectUris(oauthApp.redirect_uris);
  if (!redirectUriMatchesRegistered(redirect_uri, redirectUris))
    return c.json({ error: "invalid_redirect_uri" }, 400);

  // Access whitelist check: if enabled, verify the user against the rules.
  const currentUser = c.get("user");
  if (currentUser && oauthApp.access_whitelist_enabled) {
    const denied = await checkAccessWhitelist(
      c.env.DB,
      oauthApp,
      currentUser.id,
    );
    if (denied) {
      return c.json(
        {
          error: "unauthorized_whitelist",
          app_name: oauthApp.name,
        },
        403,
      );
    }
  }

  const requestedScopes = (scope ?? "").split(" ").filter(Boolean);
  const allowedScopes = JSON.parse(oauthApp.allowed_scopes) as string[];
  const [{ scopes, appScopes, rejected }, isVerified] = await Promise.all([
    resolveRequestedScopes(
      c.env.DB,
      c.env.APP_URL,
      requestedScopes,
      allowedScopes,
      oauthApp.client_id,
    ),
    computeIsVerified(
      c.env.DB,
      oauthApp.owner_id,
      oauthApp.website_url,
      oauthApp.redirect_uris,
      oauthApp.team_id,
    ),
  ]);

  // If the app requests team-scoped permissions, load the teams where the
  // authenticated user is owner or admin so the consent UI can show a picker.
  const needsTeamGrant = hasUnboundTeamScopes(scopes);
  let userAdminTeams: Array<{
    id: string;
    name: string;
    avatar_url: string | null;
    role: string;
  }> = [];
  if (needsTeamGrant && c.get("user")) {
    // Effective membership: include sub-teams the user can manage by way of
    // inheritance from an ancestor team. This keeps the consent picker
    // consistent with the session API's "what can I manage?" surface.
    const memberships = await listEffectiveTeamMemberships(
      c.env.DB,
      c.get("user")!.id,
    );
    const admin = memberships.filter((m) =>
      ["owner", "co-owner", "admin"].includes(m.role),
    );
    admin.sort((a, b) => {
      const rank = (r: string) =>
        r === "owner" ? 0 : r === "co-owner" ? 1 : 2;
      const ra = rank(a.role);
      const rb = rank(b.role);
      if (ra !== rb) return ra - rb;
      return a.team.name.localeCompare(b.team.name);
    });
    userAdminTeams = await Promise.all(
      admin.map(async (m) => ({
        id: m.team.id,
        name: m.team.name,
        avatar_url: await proxyImageUrl(
          c.env.APP_URL,
          c.env.DB,
          m.team.avatar_url,
        ),
        role: m.role,
      })),
    );
  }

  // Merge per-request optional_scope param with the app's stored optional_scopes.
  // Only scopes actually present in the resolved request are kept.
  const appOptionalScopes = JSON.parse(
    oauthApp.optional_scopes ?? "[]",
  ) as string[];
  const requestOptionalScopes = (optional_scope ?? "")
    .split(" ")
    .filter(Boolean);
  const optionalScopeSet = new Set([
    ...appOptionalScopes,
    ...requestOptionalScopes,
  ]);
  const optionalScopes = scopes.filter((s) => optionalScopeSet.has(s));

  // Site-level scopes require admin role + 2FA enrolled.
  let sitesScopesGrantable = false;
  if (hasSiteScopes(scopes) && currentUser?.role === "admin") {
    const [totpRow, passkeyRow] = await Promise.all([
      c.env.DB.prepare(
        "SELECT id FROM totp_authenticators WHERE user_id = ? AND enabled = 1 LIMIT 1",
      )
        .bind(currentUser.id)
        .first<{ id: string }>(),
      c.env.DB.prepare(
        "SELECT credential_id FROM passkeys WHERE user_id = ? LIMIT 1",
      )
        .bind(currentUser.id)
        .first<{ credential_id: string }>(),
    ]);
    sitesScopesGrantable = !!(totpRow ?? passkeyRow);
  }

  // If the user already authorized this app, surface the prior consent's
  // scopes and the count of still-valid tokens. The SPA uses this to offer
  // a "Log back in" affordance — replacing prior tokens with a fresh one —
  // when the requested permissions exactly match the previous grant.
  let existingConsentScopes: string[] | null = null;
  let existingConsentAutoAuthorize = false;
  let existingTokenCount = 0;
  if (currentUser) {
    const nowSec = Math.floor(Date.now() / 1000);
    const [consentRow, tokenCountRow] = await Promise.all([
      c.env.DB.prepare(
        "SELECT scopes, auto_authorize FROM oauth_consents WHERE user_id = ? AND client_id = ?",
      )
        .bind(currentUser.id, oauthApp.client_id)
        .first<{ scopes: string; auto_authorize: number }>(),
      c.env.DB.prepare(
        "SELECT COUNT(*) AS n FROM oauth_tokens WHERE user_id = ? AND client_id = ? AND expires_at > ?",
      )
        .bind(currentUser.id, oauthApp.client_id, nowSec)
        .first<{ n: number }>(),
    ]);
    if (consentRow) {
      existingConsentAutoAuthorize = consentRow.auto_authorize === 1;
      try {
        const parsed = JSON.parse(consentRow.scopes);
        if (Array.isArray(parsed)) {
          existingConsentScopes = parsed.filter(
            (s): s is string => typeof s === "string",
          );
        }
      } catch {
        existingConsentScopes = null;
      }
    }
    existingTokenCount = tokenCountRow?.n ?? 0;
  }

  // OIDC Core prompt / max_age evaluation. The SPA acts on these: send the
  // user to re-authenticate, auto-approve without UI, force the consent screen,
  // or bounce an error back to the client for prompt=none.
  const maxAge =
    maxAgeRaw != null && /^\d+$/.test(maxAgeRaw) ? Number(maxAgeRaw) : null;
  let sessionAuthTime: number | null = null;
  let sessionAcr: string | null = null;
  if (currentUser) {
    const s = await c.env.DB.prepare(
      "SELECT created_at, amr FROM sessions WHERE id = ?",
    )
      .bind(c.get("sessionId"))
      .first<{ created_at: number; amr: string | null }>();
    sessionAuthTime = s?.created_at ?? null;
    if (s?.amr) sessionAcr = deriveAcr(JSON.parse(s.amr) as string[]);
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const staleByMaxAge =
    maxAge != null &&
    sessionAuthTime != null &&
    nowSec - sessionAuthTime > maxAge;
  // RFC 9470: if the client asked for an acr the current session doesn't meet,
  // re-authenticate so a stronger factor can raise it.
  const requestedAcrs = (acrValues ?? "").split(" ").filter(Boolean);
  const acrUnsatisfied =
    requestedAcrs.length > 0 &&
    (sessionAcr === null || !requestedAcrs.includes(sessionAcr));
  const reauthRequired = prompt === "login" || staleByMaxAge || acrUnsatisfied;
  // Exact match between requested effective scopes and existing remembered consent
  const exactConsentMatch =
    existingConsentScopes != null &&
    existingConsentScopes.length === scopes.length &&
    new Set(existingConsentScopes).size === scopes.length &&
    existingConsentScopes.every((s) => scopes.includes(s));

  // Remembered auto-authorization eligibility (requires auto_authorize flag and exact scope match)
  const autoAuthorizeEligible =
    !oauthApp.is_first_party &&
    !hasSiteScopes(scopes) &&
    !needsTeamGrant &&
    rejected.length === 0 &&
    prompt !== "consent" &&
    !reauthRequired &&
    existingConsentAutoAuthorize &&
    exactConsentMatch;

  let promptNoneError: string | null = null;
  if (prompt === "none") {
    if (!currentUser || reauthRequired) promptNoneError = "login_required";
    else if (
      !oauthApp.is_first_party &&
      (!existingConsentAutoAuthorize || !exactConsentMatch)
    )
      promptNoneError = "consent_required";
  }

  return c.json({
    app: await buildConsentAppSummary(c.env, oauthApp, isVerified),
    scopes,
    optional_scopes: optionalScopes,
    app_scopes: appScopes,
    rejected_scopes: rejected,
    redirect_uri,
    state,
    code_challenge,
    code_challenge_method,
    nonce,
    prompt: prompt ?? null,
    max_age: maxAge,
    reauth_required: reauthRequired,
    prompt_none_error: promptNoneError,
    prior_consent_covers: existingConsentAutoAuthorize && exactConsentMatch,
    auto_authorize_eligible: autoAuthorizeEligible,
    user: c.get("user") ?? null,
    requires_site_grant: hasSiteScopes(scopes),
    site_scope_confirm_phrase: hasSiteScopes(scopes)
      ? SITE_SCOPE_CONFIRM_PHRASE
      : null,
    site_scopes_grantable: sitesScopesGrantable,
    requires_team_grant: needsTeamGrant,
    team_grant_permissions: needsTeamGrant
      ? unboundTeamPermissions(scopes)
      : [],
    user_admin_teams: userAdminTeams,
    existing_consent_scopes: existingConsentScopes,
    existing_token_count: existingTokenCount,
  });
});

// POST /api/oauth/authorize — user approves or denies
app.post("/authorize", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    client_id: string;
    redirect_uri: string;
    scope: string;
    state?: string;
    code_challenge?: string;
    code_challenge_method?: string;
    nonce?: string;
    action: "approve" | "deny";
    authorization_mode?: "once" | "always";
    totp_code?: string;
    passkey_verify_token?: string;
    confirm_text?: string;
    team_id?: string;
    revoke_existing_tokens?: boolean;
    request_uri?: string;
    resource?: string | string[];
    prompt?: string;
    max_age?: number;
  }>();

  // Populated from the pushed request when one is used (RFC 9126); otherwise the
  // corresponding body fields apply.
  let pushedMaxAge: number | undefined;

  // RFC 9126: a pushed authorization request supplies the security-critical
  // parameters (redirect_uri, PKCE, nonce, resource) server-side. When the
  // client used one, expand it and treat those values as authoritative — the
  // fields the browser echoes back are ignored, so a pushed request cannot be
  // tampered with between /par and here. RFC 8707 resource indicators are read
  // from the pushed request, or (for a plain request) from the body.
  let requestResources: string[];
  if (body.request_uri) {
    const pushed = await loadPushedRequest(c.env, body.request_uri);
    if (!pushed)
      return c.json(
        {
          error: "invalid_request",
          error_description: "request_uri is invalid or expired",
        },
        400,
      );
    body.client_id = pushed.client_id;
    body.redirect_uri = pushed.redirect_uri;
    body.scope = pushed.scope;
    body.code_challenge = pushed.code_challenge;
    body.code_challenge_method = pushed.code_challenge_method;
    body.nonce = pushed.nonce;
    body.state = pushed.state ?? body.state;
    requestResources = pushed.resource ?? [];
    pushedMaxAge = pushed.max_age;
  } else {
    const rv = validateResources(collectResourceParams(null, body.resource));
    if (rv === null)
      return c.json(
        {
          error: "invalid_target",
          error_description: "invalid resource indicator",
        },
        400,
      );
    requestResources = rv;
  }

  // Look up the app and validate the redirect_uri BEFORE branching on
  // action — otherwise the deny path becomes an open-redirect primitive
  // (any authenticated user can be sent anywhere by hitting Deny).
  const oauthApp = await c.env.DB.prepare(
    "SELECT * FROM oauth_apps WHERE client_id = ? AND is_active = 1",
  )
    .bind(body.client_id)
    .first<OAuthAppRow>();
  if (!oauthApp) return c.json({ error: "invalid_client" }, 400);

  // Restricted accounts sign in only to their own team's applications, and
  // not at all until they have finished joining — a pending account would
  // otherwise hand the app a token with no membership or group claims, which
  // reads as "not a member" and invites a local record the app then has to
  // reconcile.
  const restriction = await getRestrictionState(c.env.DB, user.id);
  if (restriction) {
    const appErr = await checkAppAuthorizationAllowed(
      c.env.DB,
      restriction,
      oauthApp,
    );
    if (appErr) return c.json({ error: appErr }, 403);
  }

  const redirectUris = parseRedirectUris(oauthApp.redirect_uris);
  if (!redirectUriMatchesRegistered(body.redirect_uri, redirectUris))
    return c.json({ error: "invalid_redirect_uri" }, 400);

  const whitelistDenied = await checkAccessWhitelist(
    c.env.DB,
    oauthApp,
    user.id,
  );
  if (whitelistDenied) {
    return c.json(
      { error: "unauthorized_whitelist", app_name: oauthApp.name },
      403,
    );
  }

  if (body.action === "deny") {
    const url = new URL(body.redirect_uri);
    url.searchParams.set("error", "access_denied");
    if (body.state) url.searchParams.set("state", body.state);
    // RFC 9207: identify the issuer on the (error) authorization response too.
    url.searchParams.set("iss", c.env.APP_URL);
    if (body.request_uri) consumePushedRequest(c.env, body.request_uri);
    return c.json({ redirect: url.toString() });
  }

  // OAuth 2.0 Security BCP §2.1.1: public clients MUST use PKCE.
  // Refuse to issue an authorization code without code_challenge so a code
  // intercepted at the redirect URI cannot be redeemed.
  if (oauthApp.is_public === 1 && !body.code_challenge) {
    return c.json(
      {
        error: "invalid_request",
        error_description: "code_challenge is required for public clients",
      },
      400,
    );
  }

  const allowedScopes = JSON.parse(oauthApp.allowed_scopes) as string[];
  const { scopes } = await resolveRequestedScopes(
    c.env.DB,
    c.env.APP_URL,
    (body.scope ?? "").split(" ").filter(Boolean),
    allowedScopes,
    oauthApp.client_id,
  );

  // Site-scope gate: admin only, requires 2FA (TOTP or passkey) and confirmation phrase
  if (hasSiteScopes(scopes)) {
    if (user.role !== "admin") {
      return c.json(
        {
          error: "site_scope_admin_required",
        },
        403,
      );
    }

    let twoFaOk = false;
    if (body.passkey_verify_token) {
      const kvKey = `passkey_site_verify:${user.id}:${body.passkey_verify_token}`;
      const stored = await c.env.KV_CACHE.get(kvKey);
      if (stored) {
        await c.env.KV_CACHE.delete(kvKey);
        twoFaOk = true;
      }
    } else if (body.totp_code) {
      twoFaOk = await verifyAnyTotp(c.env, user.id, body.totp_code);
    }

    if (!twoFaOk) {
      return c.json(
        {
          error: "site_scope_totp_invalid",
        },
        400,
      );
    }
    if (body.confirm_text?.trim().toLowerCase() !== SITE_SCOPE_CONFIRM_PHRASE) {
      return c.json(
        {
          error: "site_scope_confirm_required",
        },
        400,
      );
    }
  }

  // Team-scope gate: bind unbound team:* → team:<teamId>:* and validate membership
  let boundScopes = scopes;
  if (hasUnboundTeamScopes(scopes)) {
    if (!body.team_id) {
      return c.json(
        {
          error: "team_id_required",
        },
        400,
      );
    }
    // Verify the user is owner/admin/co-owner of the selected team. We use
    // the *effective* role so an admin inherited from an ancestor team can
    // grant single-team scopes on a sub-team, matching the session API.
    const effective = await getEffectiveMember(c.env.DB, body.team_id, user.id);

    if (
      !effective ||
      !["owner", "co-owner", "admin"].includes(effective.role)
    ) {
      return c.json(
        {
          error: "team_scope_forbidden",
        },
        403,
      );
    }

    // team:delete requires owner or co-owner (direct OR inherited).
    const requestsDelete = scopes.includes("team:delete");
    if (requestsDelete && !["owner", "co-owner"].includes(effective.role)) {
      return c.json(
        {
          error: "team_scope_owner_required",
        },
        403,
      );
    }

    boundScopes = bindTeamScopes(scopes, body.team_id);

    // Audit log
    const grantedPerms = unboundTeamPermissions(scopes);
    const grantNow = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare(
      `INSERT INTO team_scope_grants (id, grantor_user_id, team_id, client_id, permissions, granted_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        randomId(),
        user.id,
        body.team_id,
        body.client_id,
        JSON.stringify(grantedPerms),
        grantNow,
      )
      .run();
  }

  const siteScopes = boundScopes.filter((s) => SITE_SCOPES.has(s));

  // Look up prior consent before inserting/updating
  const priorConsentRow = await c.env.DB.prepare(
    "SELECT scopes, auto_authorize FROM oauth_consents WHERE user_id = ? AND client_id = ?",
  )
    .bind(user.id, body.client_id)
    .first<{ scopes: string; auto_authorize: number }>();

  let priorScopes: string[] = [];
  if (priorConsentRow) {
    try {
      const parsed = JSON.parse(priorConsentRow.scopes);
      if (Array.isArray(parsed)) {
        priorScopes = parsed.filter((s): s is string => typeof s === "string");
      }
    } catch {
      priorScopes = [];
    }
  }

  const isExactConsentMatch =
    priorConsentRow != null &&
    priorScopes.length === boundScopes.length &&
    new Set(priorScopes).size === priorScopes.length &&
    priorScopes.every((s) => boundScopes.includes(s));

  // Determine whether this approval is server-side auto-authorized:
  // - First-party apps skip consent UI automatically
  // - Remembered auto-authorization: prior consent had auto_authorize = 1,
  //   exact scope match, no site scopes, no unbound team grant, and prompt != consent
  const isAutoAuthorized =
    oauthApp.is_first_party ||
    (priorConsentRow?.auto_authorize === 1 &&
      isExactConsentMatch &&
      siteScopes.length === 0 &&
      !body.team_id &&
      body.prompt !== "consent");

  // "Log back in" — when the user explicitly opts in and the scopes being
  // granted match an existing consent exactly, drop the old tokens so a single
  // fresh token replaces them. The actual DELETE runs after the new auth code
  // is committed so a mid-flight failure can't strand the user with no token.
  // Mismatched scopes are a security signal (the grant is changing), so we
  // silently fall through to the normal flow without touching old tokens.
  let shouldRevokeOldTokens = false;
  if (body.revoke_existing_tokens && body.action === "approve") {
    shouldRevokeOldTokens = isExactConsentMatch;
  }

  // Store consent
  const now = Math.floor(Date.now() / 1000);

  // Capture the authenticating session's context so the ID token minted at the
  // token endpoint can emit auth_time / amr / acr (OIDC Core §2). max_age, when
  // the request asked for it, forces a re-authentication that is fresh enough.
  const sessionRow = await c.env.DB.prepare(
    "SELECT created_at, amr FROM sessions WHERE id = ?",
  )
    .bind(c.get("sessionId"))
    .first<{ created_at: number; amr: string | null }>();
  const authTime = sessionRow?.created_at ?? null;
  const sessionAmr = sessionRow?.amr ?? null;
  const maxAge = body.request_uri ? pushedMaxAge : body.max_age;
  if (
    typeof maxAge === "number" &&
    maxAge >= 0 &&
    authTime != null &&
    now - authTime > maxAge
  ) {
    return c.json(
      {
        error: "login_required",
        error_description: "re-authentication required (max_age exceeded)",
      },
      400,
    );
  }

  const autoAuthorizeFlag =
    body.authorization_mode === "always" &&
    !oauthApp.is_first_party &&
    siteScopes.length === 0 &&
    !body.team_id
      ? 1
      : body.authorization_mode === "once"
        ? 0
        : undefined;

  if (autoAuthorizeFlag !== undefined) {
    await c.env.DB.prepare(
      `INSERT INTO oauth_consents (id, user_id, client_id, scopes, granted_at, auto_authorize)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, client_id) DO UPDATE SET scopes = excluded.scopes, granted_at = excluded.granted_at, auto_authorize = excluded.auto_authorize`,
    )
      .bind(
        randomId(),
        user.id,
        body.client_id,
        JSON.stringify(boundScopes),
        now,
        autoAuthorizeFlag,
      )
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO oauth_consents (id, user_id, client_id, scopes, granted_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, client_id) DO UPDATE SET scopes = excluded.scopes, granted_at = excluded.granted_at`,
    )
      .bind(
        randomId(),
        user.id,
        body.client_id,
        JSON.stringify(boundScopes),
        now,
      )
      .run();
  }

  if (siteScopes.length > 0) {
    await c.env.DB.prepare(
      `INSERT INTO site_scope_grants (id, admin_user_id, grantee_user_id, client_id, scopes, granted_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        randomId(),
        user.id,
        user.id,
        body.client_id,
        JSON.stringify(siteScopes),
        now,
      )
      .run();
  }

  // Send notification:
  // - Always for manual authorization
  // - For auto-authorization (skipping consent UI), only if the user opted in via notify_on_auto_authorization
  // Note: isAutoAuthorized is derived on the server from DB consent records and request state,
  // preventing client-side spoofing.
  let shouldNotify = !isAutoAuthorized;
  if (isAutoAuthorized && !oauthApp.is_first_party) {
    const u = await c.env.DB.prepare(
      "SELECT notify_on_auto_authorization FROM users WHERE id = ?",
    )
      .bind(user.id)
      .first<{ notify_on_auto_authorization: number }>();
    if (u?.notify_on_auto_authorization === 1) {
      shouldNotify = true;
    }
  }

  if (shouldNotify) {
    c.executionCtx.waitUntil(
      deliverUserEmailNotifications(
        c.env,
        user.id,
        "oauth.consent_granted",
        {
          app_name: oauthApp.name,
          scopes: boundScopes,
          ...notificationActorMetaFromHeaders(c.req.raw.headers),
        },
        c.env.APP_URL,
      ).catch(() => {}),
    );
  }

  // Issue authorization code (10 minute TTL). Stored as keyed-HMAC hash
  // so a D1 leak doesn't surrender redeemable codes.
  const code = randomBase64url(32);
  const storedCode = await hashSecret(c.env, code);
  await c.env.DB.prepare(
    `INSERT INTO oauth_codes (code, client_id, user_id, redirect_uri, scopes, code_challenge, code_challenge_method, nonce, resource, auth_time, amr, session_id, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      storedCode,
      body.client_id,
      user.id,
      body.redirect_uri,
      JSON.stringify(boundScopes),
      body.code_challenge ?? null,
      body.code_challenge_method ?? null,
      body.nonce ?? null,
      serializeResources(requestResources),
      authTime,
      sessionAmr,
      c.get("sessionId") ?? null,
      now + 600,
      now,
    )
    .run();

  // Learn-first-used: an app registered with an empty redirect URI list gets
  // the first safe redirect URI pinned as an `equals` entry, locking it to
  // that value going forward. The guarded WHERE avoids clobbering a value a
  // concurrent authorization may have already learned.
  if (parseRedirectUris(oauthApp.redirect_uris).length === 0) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare(
        "UPDATE oauth_apps SET redirect_uris = ?, updated_at = ? WHERE id = ? AND (redirect_uris IS NULL OR redirect_uris = '[]' OR redirect_uris = '')",
      )
        .bind(
          JSON.stringify([{ type: "equals", value: body.redirect_uri }]),
          now,
          oauthApp.id,
        )
        .run()
        .then(() => {})
        .catch(() => {}),
    );
  }

  // Now that the new auth code is safely committed, drop the prior tokens if
  // the user opted into "log back in" with matching scopes.
  if (shouldRevokeOldTokens) {
    await c.env.DB.prepare(
      "DELETE FROM oauth_tokens WHERE user_id = ? AND client_id = ?",
    )
      .bind(user.id, body.client_id)
      .run();
  }

  const url = new URL(body.redirect_uri);
  url.searchParams.set("code", code);
  if (body.state) url.searchParams.set("state", body.state);
  // RFC 9207: let the client confirm which issuer produced this response,
  // defeating mix-up attacks where a second AS is swapped in.
  url.searchParams.set("iss", c.env.APP_URL);
  if (body.request_uri) consumePushedRequest(c.env, body.request_uri);

  // Notify the app that a user just granted access
  c.executionCtx.waitUntil(
    deliverAppEvent(c.env, oauthApp.id, "user.token_granted", {
      user_id: user.id,
      scopes: boundScopes,
      granted_at: now,
    }).catch(() => {}),
  );

  // Transparent Control: the authorizing user sees the authorization in their
  // own log; the app's owner (user or team) sees it as an app-authorization.
  {
    const meta = auditRequestMeta(c);
    const events: AuditInput[] = [
      {
        scope: "user",
        scopeId: user.id,
        action: "oauth.authorize",
        actorId: user.id,
        actorName: user.username,
        resourceType: "app",
        resourceId: oauthApp.id,
        resourceName: oauthApp.name,
        ip: meta.ip,
        userAgent: meta.userAgent,
        geo: meta.geo,
        metadata: { scopes: boundScopes, client_id: oauthApp.client_id },
      },
    ];
    const appAuth = {
      action: "app.authorized",
      actorId: user.id,
      actorName: user.username,
      resourceType: "app",
      resourceId: oauthApp.id,
      resourceName: oauthApp.name,
      ip: meta.ip,
      userAgent: meta.userAgent,
      geo: meta.geo,
      metadata: { scopes: boundScopes, user_id: user.id },
    };
    if (oauthApp.team_id)
      events.push({ ...appAuth, scope: "team", scopeId: oauthApp.team_id });
    else events.push({ ...appAuth, scope: "user", scopeId: oauthApp.owner_id });
    c.executionCtx.waitUntil(recordAudit(c.env, c.executionCtx, events));
  }

  return c.json({ redirect: url.toString() });
});

app.route("/", stepUpRoutes);

// ─── Token endpoint ──────────────────────────────────────────────────────────

app.post("/token", async (c) => {
  // RFC 6749 §5.1: token responses MUST NOT be cached (applies to every
  // return path below, success or error).
  noStore(c);

  const { params, form, json } = await readOAuthBody(c);

  const { grant_type, code, redirect_uri, code_verifier, refresh_token } =
    params;

  // Authenticate the client (private_key_jwt, client_secret_*, or public).
  const auth = await authenticateClient(c, params);
  if (!auth.ok) {
    if (auth.badRequest) return c.json({ error: "invalid_request" }, 400);
    // RFC 6749 §5.2: 401 + WWW-Authenticate when the client used the header.
    if (auth.usedBasic) challengeBasic(c);
    return c.json({ error: "invalid_client" }, 401);
  }
  const oauthApp = auth.app;
  const clientId = oauthApp.client_id;

  const config = await getConfig(c.env.DB);

  // RFC 9449: a DPoP proof on the token request binds the issued token to the
  // proof key's thumbprint. Verified once here (htm=POST, htu=this endpoint);
  // each grant below stamps the resulting jkt onto the token it mints.
  let dpopJkt: string | null = null;
  const dpopHeader = c.req.header("DPoP");
  if (dpopHeader) {
    const res = await verifyDpopProof(c.env, dpopHeader, {
      htm: "POST",
      htu: c.req.url,
    });
    if ("error" in res)
      return c.json(
        {
          error: "invalid_dpop_proof",
          error_description: "invalid DPoP proof",
        },
        400,
      );
    dpopJkt = res.jkt;
  }

  // RFC 6749 §5.2: grant_type is REQUIRED; its absence is invalid_request,
  // distinct from a present-but-unknown value (unsupported_grant_type below).
  if (!grant_type) {
    return c.json(
      { error: "invalid_request", error_description: "grant_type is required" },
      400,
    );
  }

  // ── Authorization Code grant ─────────────────────────────────────────────
  if (grant_type === "authorization_code") {
    const now = Math.floor(Date.now() / 1000);
    const codeLookup = await hashLookupCandidate(c.env, code);
    if (!codeLookup) return c.json({ error: "invalid_grant" }, 400);
    const codeRow = await c.env.DB.prepare(
      "SELECT * FROM oauth_codes WHERE code = ? OR code = ?",
    )
      .bind(code, codeLookup)
      .first<OAuthCodeRow>();

    if (!codeRow || codeRow.client_id !== clientId)
      return c.json({ error: "invalid_grant" }, 400);
    if (codeRow.expires_at < now)
      return c.json(
        { error: "invalid_grant", error_description: "Code expired" },
        400,
      );
    if (codeRow.redirect_uri !== redirect_uri)
      return c.json({ error: "invalid_grant" }, 400);

    // Public clients (no client secret) MUST use PKCE — without it, an
    // attacker who intercepts the authorization code (e.g. via a custom-scheme
    // handler hijack on mobile, or browser referer leaks) can redeem it.
    // OAuth 2.0 Security BCP §2.1.1.
    if (oauthApp.is_public && !codeRow.code_challenge) {
      return c.json(
        {
          error: "invalid_grant",
          error_description: "PKCE is required for public clients",
        },
        400,
      );
    }

    // Verify PKCE
    if (codeRow.code_challenge) {
      if (!code_verifier)
        return c.json(
          {
            error: "invalid_grant",
            error_description: "code_verifier required",
          },
          400,
        );
      const pkceOk = await verifyPkce(
        code_verifier,
        codeRow.code_challenge,
        codeRow.code_challenge_method ?? "S256",
      );
      if (!pkceOk)
        return c.json(
          {
            error: "invalid_grant",
            error_description: "PKCE verification failed",
          },
          400,
        );
    }

    // Consume code — match the row we just selected (codeRow.code is
    // already in stored form, so a single direct compare is enough).
    //
    // The delete is what makes the code single-use, so its result decides
    // whether this request may continue: two redemptions racing here both
    // pass the checks above, and only the one that actually removes the row
    // gets to mint tokens.
    const consumed = await c.env.DB.prepare(
      "DELETE FROM oauth_codes WHERE code = ?",
    )
      .bind(codeRow.code)
      .run();
    if (consumed.meta.changes !== 1)
      return c.json({ error: "invalid_grant" }, 400);

    const user = await c.env.DB.prepare(
      "SELECT * FROM users WHERE id = ? AND kind = 'user'",
    )
      .bind(codeRow.user_id)
      .first<UserRow>();
    if (!user || !user.is_active)
      return c.json({ error: "invalid_grant" }, 400);

    const scopes = JSON.parse(codeRow.scopes) as string[];
    const resources = parseResources(codeRow.resource);
    const hasOffline = scopes.includes("offline_access");
    const { atTtl, rtTtl } = tokenTtls(user, config);
    const refreshToken = hasOffline ? randomBase64url(48) : null;

    const jti = randomId();
    const accessToken = await mintAccessToken(c, oauthApp, {
      sub: user.id,
      clientId,
      jti,
      scopes,
      resources,
      dpopJkt,
      authTime: codeRow.auth_time,
      amr: codeRow.amr,
      ttl: atTtl,
    });
    await insertOAuthToken(c.env, {
      id: jti,
      accessToken,
      refreshToken,
      clientId,
      userId: user.id,
      scopes,
      resource: codeRow.resource,
      dpopJkt,
      authTime: codeRow.auth_time,
      amr: codeRow.amr,
      expiresAt: now + atTtl,
      refreshExpiresAt: hasOffline ? now + rtTtl : null,
      now,
    });

    const response: Record<string, unknown> = {
      access_token: accessToken,
      token_type: dpopJkt ? "DPoP" : "Bearer",
      expires_in: atTtl,
      scope: scopes.join(" "),
    };
    if (refreshToken) response.refresh_token = refreshToken;
    if (scopes.includes("openid")) {
      const rsaKeyPair = await getRsaKeyPair(c.env.KV_SESSIONS);
      response.id_token = await buildIdToken(
        user,
        clientId,
        scopes,
        codeRow.nonce,
        rsaKeyPair.privateKey,
        rsaKeyPair.kid,
        atTtl,
        c.env.APP_URL,
        c.env.DB,
        {
          authTime: codeRow.auth_time,
          amr: codeRow.amr ? (JSON.parse(codeRow.amr) as string[]) : null,
          sid: codeRow.session_id,
        },
      );
    }
    return c.json(response);
  }

  // ── Refresh Token grant ──────────────────────────────────────────────────
  if (grant_type === "refresh_token") {
    const now = Math.floor(Date.now() / 1000);
    const refreshLookup = await hashLookupCandidate(c.env, refresh_token);
    if (!refreshLookup) return c.json({ error: "invalid_grant" }, 400);
    const tokenRow = await c.env.DB.prepare(
      "SELECT * FROM oauth_tokens WHERE refresh_token = ? OR refresh_token = ?",
    )
      .bind(refresh_token, refreshLookup)
      .first<OAuthTokenRow>();

    // A token that matches nothing current may still be one this row already
    // rotated away. That is a replay — the client kept a superseded value, or
    // someone else is using a stolen one — and there is no way to tell which
    // from here, so the grant is revoked and both have to re-authorise.
    if (!tokenRow) {
      const superseded = await c.env.DB.prepare(
        "SELECT id FROM oauth_tokens WHERE previous_refresh_token = ? OR previous_refresh_token = ?",
      )
        .bind(refresh_token, refreshLookup)
        .first<{ id: string }>();
      if (superseded) {
        await c.env.DB.prepare("DELETE FROM oauth_tokens WHERE id = ?")
          .bind(superseded.id)
          .run();
      }
      return c.json({ error: "invalid_grant" }, 400);
    }
    if (tokenRow.client_id !== clientId)
      return c.json({ error: "invalid_grant" }, 400);
    if (!tokenRow.refresh_expires_at || tokenRow.refresh_expires_at < now) {
      return c.json(
        { error: "invalid_grant", error_description: "Refresh token expired" },
        400,
      );
    }

    // RFC 9449 §5: a DPoP-bound refresh token may only be refreshed with a
    // proof from the same key. The binding is preserved across rotation.
    if (tokenRow.dpop_jkt && dpopJkt !== tokenRow.dpop_jkt)
      return c.json(
        { error: "invalid_dpop_proof", error_description: "DPoP key mismatch" },
        400,
      );
    const effJkt = tokenRow.dpop_jkt ?? dpopJkt;

    const user = await c.env.DB.prepare(
      "SELECT * FROM users WHERE id = ? AND kind = 'user'",
    )
      .bind(tokenRow.user_id)
      .first<UserRow>();
    if (!user || !user.is_active)
      return c.json({ error: "invalid_grant" }, 400);

    const scopes = JSON.parse(tokenRow.scopes) as string[];
    const resources = parseResources(tokenRow.resource);
    const { atTtl } = tokenTtls(user, config);

    const newAccessToken = await mintAccessToken(c, oauthApp, {
      sub: tokenRow.user_id,
      clientId: tokenRow.client_id,
      jti: tokenRow.id,
      scopes,
      resources,
      dpopJkt: effJkt,
      authTime: tokenRow.auth_time,
      amr: tokenRow.amr,
      ttl: atTtl,
    });

    const storedNewAccess = await hashSecret(c.env, newAccessToken);

    // Rotate the refresh token as well. The row remembers the value being
    // replaced so a later presentation of it can be recognised as a replay
    // (see the reuse check above). refresh_expires_at is deliberately left
    // alone: rotation should not extend the grant's lifetime.
    const newRefreshToken = randomBase64url(48);
    const storedNewRefresh = await hashSecret(c.env, newRefreshToken);
    const rotated = await c.env.DB.prepare(
      `UPDATE oauth_tokens
          SET access_token = ?, expires_at = ?,
              refresh_token = ?, previous_refresh_token = ?, dpop_jkt = ?
        WHERE id = ? AND refresh_token = ?`,
    )
      .bind(
        storedNewAccess,
        now + atTtl,
        storedNewRefresh,
        tokenRow.refresh_token,
        effJkt,
        tokenRow.id,
        tokenRow.refresh_token,
      )
      .run();
    // Lost a race with a concurrent refresh of the same token: that request
    // rotated first, so this one is holding a superseded value.
    if (rotated.meta.changes !== 1)
      return c.json({ error: "invalid_grant" }, 400);

    return c.json({
      access_token: newAccessToken,
      token_type: effJkt ? "DPoP" : "Bearer",
      expires_in: atTtl,
      scope: scopes.join(" "),
      refresh_token: newRefreshToken,
    });
  }

  // ── Device Authorization Grant (RFC 8628 §3.4) ───────────────────────────
  if (grant_type === DEVICE_GRANT_TYPE) {
    const now = Math.floor(Date.now() / 1000);
    const deviceCode = params.device_code;
    if (!deviceCode)
      return c.json(
        { error: "invalid_request", error_description: "device_code required" },
        400,
      );

    const dcLookup = await hashLookupCandidate(c.env, deviceCode);
    if (!dcLookup) return c.json({ error: "invalid_grant" }, 400);
    const dc = await c.env.DB.prepare(
      "SELECT * FROM oauth_device_codes WHERE device_code = ? OR device_code = ?",
    )
      .bind(deviceCode, dcLookup)
      .first<OAuthDeviceCodeRow>();

    if (!dc || dc.client_id !== clientId)
      return c.json({ error: "invalid_grant" }, 400);

    // RFC 8628 §3.5 polling errors. Expiry is checked first so a stale code
    // reports expired_token rather than authorization_pending.
    if (dc.expires_at < now) {
      await c.env.DB.prepare(
        "DELETE FROM oauth_device_codes WHERE device_code = ?",
      )
        .bind(dc.device_code)
        .run();
      return c.json({ error: "expired_token" }, 400);
    }

    // Enforce the minimum polling interval; a device that polls too fast is
    // told to slow_down and its interval is bumped by 5s (§3.5).
    if (dc.last_polled_at > 0 && now - dc.last_polled_at < dc.interval) {
      await c.env.DB.prepare(
        "UPDATE oauth_device_codes SET interval = interval + 5, last_polled_at = ? WHERE device_code = ?",
      )
        .bind(now, dc.device_code)
        .run();
      return c.json({ error: "slow_down" }, 400);
    }
    await c.env.DB.prepare(
      "UPDATE oauth_device_codes SET last_polled_at = ? WHERE device_code = ?",
    )
      .bind(now, dc.device_code)
      .run();

    if (dc.status === "denied") {
      await c.env.DB.prepare(
        "DELETE FROM oauth_device_codes WHERE device_code = ?",
      )
        .bind(dc.device_code)
        .run();
      return c.json({ error: "access_denied" }, 400);
    }
    if (dc.status !== "approved" || !dc.user_id)
      return c.json({ error: "authorization_pending" }, 400);

    // PKCE is optional in the device flow, but when the device bound a
    // code_challenge at authorization time it must present the verifier now —
    // so a leaked device_code alone can't be redeemed.
    if (dc.code_challenge) {
      if (!code_verifier)
        return c.json(
          {
            error: "invalid_grant",
            error_description: "code_verifier required",
          },
          400,
        );
      const pkceOk = await verifyPkce(
        code_verifier,
        dc.code_challenge,
        dc.code_challenge_method ?? "S256",
      );
      if (!pkceOk)
        return c.json(
          {
            error: "invalid_grant",
            error_description: "PKCE verification failed",
          },
          400,
        );
    }

    const user = await c.env.DB.prepare(
      "SELECT * FROM users WHERE id = ? AND kind = 'user'",
    )
      .bind(dc.user_id)
      .first<UserRow>();
    if (!user || !user.is_active)
      return c.json({ error: "invalid_grant" }, 400);

    // Approved: mint tokens, then burn the device code (single use).
    const consumed = await c.env.DB.prepare(
      "DELETE FROM oauth_device_codes WHERE device_code = ? AND status = 'approved'",
    )
      .bind(dc.device_code)
      .run();
    if (consumed.meta.changes !== 1)
      return c.json({ error: "invalid_grant" }, 400);

    const scopes = JSON.parse(dc.scopes) as string[];
    const resources = parseResources(dc.resource);
    const hasOffline = scopes.includes("offline_access");
    const { atTtl, rtTtl } = tokenTtls(user, config);
    const refreshToken = hasOffline ? randomBase64url(48) : null;

    const jti = randomId();
    const accessToken = await mintAccessToken(c, oauthApp, {
      sub: user.id,
      clientId,
      jti,
      scopes,
      resources,
      dpopJkt,
      ttl: atTtl,
    });
    await insertOAuthToken(c.env, {
      id: jti,
      accessToken,
      refreshToken,
      clientId,
      userId: user.id,
      scopes,
      resource: dc.resource,
      dpopJkt,
      expiresAt: now + atTtl,
      refreshExpiresAt: hasOffline ? now + rtTtl : null,
      now,
    });

    const response: Record<string, unknown> = {
      access_token: accessToken,
      token_type: dpopJkt ? "DPoP" : "Bearer",
      expires_in: atTtl,
      scope: scopes.join(" "),
    };
    if (refreshToken) response.refresh_token = refreshToken;
    if (scopes.includes("openid")) {
      const rsaKeyPair = await getRsaKeyPair(c.env.KV_SESSIONS);
      response.id_token = await buildIdToken(
        user,
        clientId,
        scopes,
        dc.nonce,
        rsaKeyPair.privateKey,
        rsaKeyPair.kid,
        atTtl,
        c.env.APP_URL,
        c.env.DB,
      );
    }
    return c.json(response);
  }

  // ── Token Exchange (RFC 8693) ────────────────────────────────────────────
  if (grant_type === TOKEN_EXCHANGE_GRANT_TYPE) {
    const now = Math.floor(Date.now() / 1000);
    const subjectToken = params.subject_token;
    const subjectTokenType = params.subject_token_type;
    if (!subjectToken || !subjectTokenType)
      return c.json(
        {
          error: "invalid_request",
          error_description:
            "subject_token and subject_token_type are required",
        },
        400,
      );
    if (subjectTokenType !== TOKEN_TYPE_ACCESS_TOKEN)
      return c.json(
        {
          error: "invalid_request",
          error_description: "only access_token subject tokens are supported",
        },
        400,
      );

    const subject = await lookupAccessToken(c, subjectToken);
    if (!subject)
      return c.json(
        {
          error: "invalid_grant",
          error_description: "subject_token is invalid",
        },
        400,
      );

    // Authorization: the requesting client may exchange a subject token that
    // was issued to it, or one that carries a cross-app scope naming it
    // (app:<clientId>:*). Anything else is refused — a token is not a bearer
    // key that lets any client mint a fresh one.
    const targetsRequester = subject.scopes.some((s) =>
      s.startsWith(`app:${clientId}:`),
    );
    if (subject.clientId !== clientId && !targetsRequester)
      return c.json(
        {
          error: "invalid_grant",
          error_description: "client may not exchange this token",
        },
        400,
      );

    // Requested scope must be a subset of the subject token's scope.
    const requested = (params.scope ?? "").split(" ").filter(Boolean);
    let newScopes = subject.scopes;
    if (requested.length) {
      if (!requested.every((s) => subject.scopes.includes(s)))
        return c.json({ error: "invalid_scope" }, 400);
      newScopes = requested;
    }

    // RFC 8707 resource / RFC 8693 audience both constrain the new aud.
    const audienceVals = form
      ? form.getAll("audience")
      : typeof json?.audience === "string"
        ? [json.audience]
        : Array.isArray(json?.audience)
          ? json.audience.filter((v): v is string => typeof v === "string")
          : [];
    const resources = validateResources([
      ...collectResourceParams(form, json?.resource),
      ...audienceVals,
    ]);
    if (resources === null)
      return c.json(
        {
          error: "invalid_target",
          error_description: "invalid resource/audience",
        },
        400,
      );

    const user = await c.env.DB.prepare(
      "SELECT * FROM users WHERE id = ? AND kind = 'user'",
    )
      .bind(subject.userId)
      .first<UserRow>();
    if (!user || !user.is_active)
      return c.json({ error: "invalid_grant" }, 400);

    const { atTtl } = tokenTtls(user, config);
    const resourceJson = serializeResources(resources);
    const jti = randomId();
    const accessToken = await mintAccessToken(c, oauthApp, {
      sub: user.id,
      clientId,
      jti,
      scopes: newScopes,
      resources,
      dpopJkt,
      ttl: atTtl,
    });
    // Exchanged tokens are not refreshable (no refresh_token issued).
    await insertOAuthToken(c.env, {
      id: jti,
      accessToken,
      refreshToken: null,
      clientId,
      userId: user.id,
      scopes: newScopes,
      resource: resourceJson,
      dpopJkt,
      expiresAt: now + atTtl,
      refreshExpiresAt: null,
      now,
    });

    return c.json({
      access_token: accessToken,
      issued_token_type: TOKEN_TYPE_ACCESS_TOKEN,
      token_type: dpopJkt ? "DPoP" : "Bearer",
      expires_in: atTtl,
      scope: newScopes.join(" "),
    });
  }

  return c.json({ error: "unsupported_grant_type" }, 400);
});

// ─── Shared helpers for the /par and /device_authorization endpoints ─────────

// ─── Pushed Authorization Request endpoint (RFC 9126) ────────────────────────

app.post("/par", async (c) => {
  noStore(c);
  const { params, form, json } = await readOAuthBody(c);

  const auth = await authenticateClient(c, params);
  if (!auth.ok) {
    if (auth.badRequest) return c.json({ error: "invalid_request" }, 400);
    if (auth.usedBasic) challengeBasic(c);
    return c.json({ error: "invalid_client" }, 401);
  }
  const oauthApp = auth.app;

  // RFC 9126 §2.1: a PAR request MUST NOT itself carry a request_uri.
  if (params.request_uri)
    return c.json(
      {
        error: "invalid_request",
        error_description: "request_uri is not allowed here",
      },
      400,
    );

  if ((params.response_type ?? "code") !== "code")
    return c.json({ error: "unsupported_response_type" }, 400);

  const redirectUri = params.redirect_uri;
  const redirectUris = parseRedirectUris(oauthApp.redirect_uris);
  if (!redirectUri || !redirectUriMatchesRegistered(redirectUri, redirectUris))
    return c.json(
      { error: "invalid_request", error_description: "invalid redirect_uri" },
      400,
    );

  // Public clients must use PKCE (OAuth 2.0 Security BCP); enforce it here so a
  // pushed request can't sidestep the check the interactive flow applies.
  if (oauthApp.is_public === 1 && !params.code_challenge)
    return c.json(
      {
        error: "invalid_request",
        error_description: "code_challenge is required for public clients",
      },
      400,
    );

  const resources = validateResources(
    collectResourceParams(form, json?.resource),
  );
  if (resources === null)
    return c.json(
      {
        error: "invalid_target",
        error_description: "invalid resource indicator",
      },
      400,
    );

  const payload: PushedRequest = {
    client_id: oauthApp.client_id,
    redirect_uri: redirectUri,
    scope: params.scope ?? "",
    optional_scope: params.optional_scope,
    state: params.state,
    code_challenge: params.code_challenge,
    code_challenge_method: params.code_challenge_method,
    nonce: params.nonce,
    response_type: "code",
    resource: resources.length ? resources : undefined,
    prompt: params.prompt,
    max_age: params.max_age ? Number(params.max_age) : undefined,
    acr_values: params.acr_values,
  };
  const { requestUri, expiresIn } = await storePushedRequest(c.env, payload);
  // RFC 9126 §2.2: 201 Created with the request_uri and its lifetime.
  return c.json({ request_uri: requestUri, expires_in: expiresIn }, 201);
});

// ─── Device Authorization Grant (RFC 8628) ───────────────────────────────────

app.post("/device_authorization", async (c) => {
  noStore(c);
  const { params, form, json } = await readOAuthBody(c);

  const auth = await authenticateClient(c, params);
  if (!auth.ok) {
    if (auth.badRequest) return c.json({ error: "invalid_request" }, 400);
    if (auth.usedBasic) challengeBasic(c);
    return c.json({ error: "invalid_client" }, 401);
  }
  const oauthApp = auth.app;

  const resources = validateResources(
    collectResourceParams(form, json?.resource),
  );
  if (resources === null)
    return c.json(
      {
        error: "invalid_target",
        error_description: "invalid resource indicator",
      },
      400,
    );

  const requestedScopes = (params.scope ?? "").split(" ").filter(Boolean);
  const allowedScopes = JSON.parse(oauthApp.allowed_scopes) as string[];
  const { scopes } = await resolveRequestedScopes(
    c.env.DB,
    c.env.APP_URL,
    requestedScopes,
    allowedScopes,
    oauthApp.client_id,
  );

  // The device verification screen is a deliberately simple approve/deny. It
  // cannot carry the admin 2FA gate site scopes need, nor the team picker the
  // unbound team scopes need, so those are refused here rather than granted
  // through a weaker consent than the interactive flow demands.
  if (hasSiteScopes(scopes) || hasUnboundTeamScopes(scopes))
    return c.json(
      {
        error: "invalid_scope",
        error_description:
          "site-level and team scopes cannot be granted via the device flow",
      },
      400,
    );

  const now = Math.floor(Date.now() / 1000);
  const deviceCode = randomBase64url(32);
  const storedDeviceCode = await hashSecret(c.env, deviceCode);
  const resourceJson = serializeResources(resources);

  // user_code is UNIQUE; retry a few times on the (astronomically unlikely)
  // collision before giving up.
  let userCode = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateUserCode();
    try {
      await c.env.DB.prepare(
        `INSERT INTO oauth_device_codes
           (device_code, user_code, client_id, scopes, resource, code_challenge, code_challenge_method, nonce, status, interval, last_polled_at, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?, ?)`,
      )
        .bind(
          storedDeviceCode,
          normalizeUserCode(candidate),
          oauthApp.client_id,
          JSON.stringify(scopes),
          resourceJson,
          params.code_challenge ?? null,
          params.code_challenge_method ?? null,
          params.nonce ?? null,
          DEVICE_POLL_INTERVAL_SECONDS,
          now + DEVICE_CODE_TTL_SECONDS,
          now,
        )
        .run();
      userCode = candidate;
      break;
    } catch {
      // UNIQUE violation on user_code — try another.
    }
  }
  if (!userCode) return c.json({ error: "server_error" }, 500);

  const verificationUri = `${c.env.APP_URL}/device`;
  return c.json({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: `${verificationUri}?user_code=${encodeURIComponent(userCode)}`,
    expires_in: DEVICE_CODE_TTL_SECONDS,
    interval: DEVICE_POLL_INTERVAL_SECONDS,
  });
});

// GET /api/oauth/device — verification-screen data for a user_code (SPA).
app.get("/device", optionalAuth, async (c) => {
  const userCode = normalizeUserCode(c.req.query("user_code") ?? "");
  if (!userCode) return c.json({ error: "invalid_request" }, 400);

  const now = Math.floor(Date.now() / 1000);
  const dc = await c.env.DB.prepare(
    "SELECT * FROM oauth_device_codes WHERE user_code = ?",
  )
    .bind(userCode)
    .first<OAuthDeviceCodeRow>();
  if (!dc || dc.expires_at < now)
    return c.json({ error: "expired_or_unknown" }, 404);
  if (dc.status !== "pending")
    return c.json({ error: "already_handled", status: dc.status }, 409);

  const oauthApp = await c.env.DB.prepare(
    "SELECT * FROM oauth_apps WHERE client_id = ? AND is_active = 1",
  )
    .bind(dc.client_id)
    .first<OAuthAppRow>();
  if (!oauthApp) return c.json({ error: "invalid_client" }, 400);

  const isVerified = await computeIsVerified(
    c.env.DB,
    oauthApp.owner_id,
    oauthApp.website_url,
    oauthApp.redirect_uris,
    oauthApp.team_id,
  );
  const scopes = JSON.parse(dc.scopes) as string[];
  return c.json({
    app: await buildConsentAppSummary(c.env, oauthApp, isVerified),
    scopes,
    user: c.get("user") ?? null,
    user_code: userCode,
  });
});

// POST /api/oauth/device/decision — the signed-in user approves or denies.
app.post("/device/decision", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    user_code: string;
    action: "approve" | "deny";
  }>();
  const userCode = normalizeUserCode(body.user_code ?? "");
  if (!userCode) return c.json({ error: "invalid_request" }, 400);

  const now = Math.floor(Date.now() / 1000);
  const dc = await c.env.DB.prepare(
    "SELECT * FROM oauth_device_codes WHERE user_code = ?",
  )
    .bind(userCode)
    .first<OAuthDeviceCodeRow>();
  if (!dc || dc.expires_at < now)
    return c.json({ error: "expired_or_unknown" }, 404);
  if (dc.status !== "pending")
    return c.json({ error: "already_handled", status: dc.status }, 409);

  const oauthApp = await c.env.DB.prepare(
    "SELECT * FROM oauth_apps WHERE client_id = ? AND is_active = 1",
  )
    .bind(dc.client_id)
    .first<OAuthAppRow>();
  if (!oauthApp) return c.json({ error: "invalid_client" }, 400);

  if (body.action === "deny") {
    await c.env.DB.prepare(
      "UPDATE oauth_device_codes SET status = 'denied' WHERE user_code = ? AND status = 'pending'",
    )
      .bind(userCode)
      .run();
    return c.json({ status: "denied" });
  }

  // Restricted accounts follow the same app-authorization gate as the
  // interactive flow.
  const restriction = await getRestrictionState(c.env.DB, user.id);
  if (restriction) {
    const appErr = await checkAppAuthorizationAllowed(
      c.env.DB,
      restriction,
      oauthApp,
    );
    if (appErr) return c.json({ error: appErr }, 403);
  }
  const whitelistDenied = await checkAccessWhitelist(
    c.env.DB,
    oauthApp,
    user.id,
  );
  if (whitelistDenied)
    return c.json(
      { error: "unauthorized_whitelist", app_name: oauthApp.name },
      403,
    );

  const scopes = JSON.parse(dc.scopes) as string[];
  await c.env.DB.prepare(
    `INSERT INTO oauth_consents (id, user_id, client_id, scopes, granted_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, client_id) DO UPDATE SET scopes = excluded.scopes, granted_at = excluded.granted_at`,
  )
    .bind(randomId(), user.id, dc.client_id, JSON.stringify(scopes), now)
    .run();

  const approved = await c.env.DB.prepare(
    "UPDATE oauth_device_codes SET status = 'approved', user_id = ? WHERE user_code = ? AND status = 'pending'",
  )
    .bind(user.id, userCode)
    .run();
  if (approved.meta.changes !== 1)
    return c.json({ error: "already_handled" }, 409);

  c.executionCtx.waitUntil(
    deliverAppEvent(c.env, oauthApp.id, "user.token_granted", {
      user_id: user.id,
      scopes,
      granted_at: now,
    }).catch(() => {}),
  );
  return c.json({ status: "approved" });
});

app.route("/", registrationRoutes);

// ─── UserInfo endpoint (OpenID Connect) ─────────────────────────────────────

// OIDC Core §5.3.1: the UserInfo Endpoint MUST support both GET and POST.
// The Access Token is taken from the `Authorization: Bearer` header, or — for
// POST with a form body — the `access_token` parameter (RFC 6750 §2.2).
async function handleUserInfo(c: Context<AppEnv>): Promise<Response> {
  let accessToken: string | undefined;
  // RFC 9449: the DPoP scheme carries a bound access token; Bearer carries an
  // ordinary one (or POST form body per RFC 6750 §2.2).
  let dpopScheme = false;
  const auth = c.req.header("Authorization");
  if (auth?.startsWith("Bearer ")) {
    accessToken = auth.slice(7);
  } else if (auth?.startsWith("DPoP ")) {
    accessToken = auth.slice(5);
    dpopScheme = true;
  } else if (c.req.method === "POST") {
    const ct = c.req.header("Content-Type") ?? "";
    if (ct.includes("application/x-www-form-urlencoded")) {
      const body = await c.req.parseBody();
      if (typeof body.access_token === "string")
        accessToken = body.access_token;
    }
  }

  if (!accessToken) {
    // RFC 6750 §3: no credentials → challenge without an error code.
    challengeBearer(c);
    return c.json({ error: "invalid_token" }, 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const accessLookup = await hashLookupCandidate(c.env, accessToken);
  if (!accessLookup) {
    challengeBearer(c, "invalid_token", "The access token is invalid");
    return c.json({ error: "invalid_token" }, 401);
  }
  const tokenRow = await c.env.DB.prepare(
    "SELECT * FROM oauth_tokens WHERE access_token = ? OR access_token = ?",
  )
    .bind(accessToken, accessLookup)
    .first<OAuthTokenRow>();

  if (!tokenRow || tokenRow.expires_at < now) {
    challengeBearer(
      c,
      "invalid_token",
      "The access token expired or is invalid",
    );
    return c.json({ error: "invalid_token" }, 401);
  }

  // RFC 9449 §7.1: a DPoP-bound token requires the DPoP scheme and a valid
  // proof; a bound token used as Bearer, or a mismatched proof, is rejected.
  if (tokenRow.dpop_jkt) {
    const proof = c.req.header("DPoP");
    const res =
      dpopScheme && proof
        ? await verifyDpopProof(c.env, proof, {
            htm: c.req.method,
            htu: c.req.url,
            accessToken,
          })
        : { error: "invalid_dpop_proof" };
    if ("error" in res || res.jkt !== tokenRow.dpop_jkt) {
      challengeDpop(c, "invalid_token", "a valid DPoP proof is required");
      return c.json({ error: "invalid_token" }, 401);
    }
  } else if (dpopScheme) {
    challengeBearer(c, "invalid_token", "token is not DPoP-bound");
    return c.json({ error: "invalid_token" }, 401);
  }

  // OIDC Core §5.4: the openid scope is what authorizes access to UserInfo.
  const scopes = JSON.parse(tokenRow.scopes) as string[];
  if (!scopes.includes("openid")) {
    challengeBearer(c, "insufficient_scope", "The openid scope is required");
    return c.json({ error: "insufficient_scope" }, 403);
  }

  const user = await c.env.DB.prepare(
    "SELECT * FROM users WHERE id = ? AND kind = 'user'",
  )
    .bind(tokenRow.user_id)
    .first<UserRow>();
  if (!user) {
    challengeBearer(c, "invalid_token", "The access token is invalid");
    return c.json({ error: "invalid_token" }, 401);
  }

  const claims = await buildClaims(
    user,
    tokenRow.client_id,
    scopes,
    c.env.DB,
    c.env.APP_URL,
  );
  return c.json(claims);
}

app.get("/userinfo", handleUserInfo);
app.post("/userinfo", handleUserInfo);

// ─── Token introspection ─────────────────────────────────────────────────────

/**
 * Authenticate the calling client for introspection / revocation. Delegates to
 * authenticateClient, so all three methods (private_key_jwt, client_secret_*,
 * none) work here too. Returns the app row, or null when the credentials do not
 * check out.
 */
async function authenticateCallingClient(
  c: Context<AppEnv>,
  params: Record<string, string>,
): Promise<OAuthAppRow | null> {
  const auth = await authenticateClient(c, params);
  return auth.ok ? auth.app : null;
}

app.post("/introspect", async (c) => {
  const body = await c.req.text();
  const params = Object.fromEntries(new URLSearchParams(body));

  // RFC 7662 §2.1: the endpoint has to be authorized. Unauthenticated, it
  // answers whether any token is live and hands back its scopes, client and
  // subject — a convenient way to triage tokens picked up somewhere else.
  //
  // Public clients are refused outright. They authenticate with nothing but a
  // client_id, which is not secret, so admitting them would leave the oracle
  // open to anyone who can read an app's public configuration. Introspection
  // is for confidential resource servers; a public client that wants to know
  // whether its token still works can simply use it.
  const caller = await authenticateCallingClient(c, params);
  if (!caller || caller.is_public) {
    if (c.req.header("Authorization")?.startsWith("Basic ")) challengeBasic(c);
    return c.json({ error: "invalid_client" }, 401);
  }

  const token = params.token;
  if (!token) return c.json({ active: false });

  const now = Math.floor(Date.now() / 1000);

  let tokenRow: OAuthTokenRow | null;

  if (token.split(".").length === 3) {
    // JWT — verify signature first, then look up by jti for revocation
    try {
      const mldsaKey = await getMLDSAKey(c.env.KV_SESSIONS);
      const payload = verifyAccessToken(token, mldsaKey.publicKey);
      tokenRow = await c.env.DB.prepare(
        "SELECT * FROM oauth_tokens WHERE id = ?",
      )
        .bind(payload.jti)
        .first<OAuthTokenRow>();
    } catch {
      return c.json({ active: false });
    }
  } else {
    const tokenLookup = await hashLookupCandidate(c.env, token);
    if (!tokenLookup) return c.json({ active: false });
    tokenRow = await c.env.DB.prepare(
      "SELECT * FROM oauth_tokens WHERE access_token = ? OR access_token = ?",
    )
      .bind(token, tokenLookup)
      .first<OAuthTokenRow>();
  }

  if (!tokenRow || tokenRow.expires_at < now) return c.json({ active: false });
  const activeUser = await c.env.DB.prepare(
    "SELECT id FROM users WHERE id = ? AND is_active = 1 AND kind = 'user'",
  )
    .bind(tokenRow.user_id)
    .first<{ id: string }>();
  if (!activeUser) return c.json({ active: false });

  const scopes = JSON.parse(tokenRow.scopes) as string[];
  // The issuing client may inspect its own token. A target resource app may
  // also inspect a cross-app token that explicitly names its client_id in an
  // app:<client_id>:<scope> grant. No other client gets a token oracle.
  if (!canClientIntrospectToken(tokenRow.client_id, caller.client_id, scopes))
    return c.json({ active: false });

  return c.json({
    active: true,
    scope: scopes.join(" "),
    client_id: tokenRow.client_id,
    username: tokenRow.user_id,
    // RFC 7662 §2.2: DPoP-bound tokens are token_type "DPoP" and carry the
    // key thumbprint in cnf (RFC 9449 §7); everything else is Bearer.
    token_type: tokenRow.dpop_jkt ? "DPoP" : "Bearer",
    exp: tokenRow.expires_at,
    iat: tokenRow.created_at,
    sub: tokenRow.user_id,
    aud: extractAud(scopes, c.env.APP_URL, parseResources(tokenRow.resource)),
    iss: c.env.APP_URL,
    ...(tokenRow.dpop_jkt ? { cnf: { jkt: tokenRow.dpop_jkt } } : {}),
    // RFC 9470 authentication context, for a resource server's step-up decision.
    ...accessAuthClaims(tokenRow.auth_time, tokenRow.amr),
  });
});

// ─── Revocation endpoint ─────────────────────────────────────────────────────

app.post("/revoke", async (c) => {
  const body = await c.req.text();
  const params = Object.fromEntries(new URLSearchParams(body));

  // RFC 7009 §2.1: authenticate the client, and revoke only what belongs to
  // it — otherwise anyone who learns a token value can invalidate it, including
  // one issued to a different client.
  //
  // Public clients are allowed here, unlike introspection: signing out of an
  // SPA or a mobile app should revoke the token it holds, and the caller has
  // to present that token anyway. The client_id only narrows the delete to
  // that app's own grants.
  const caller = await authenticateCallingClient(c, params);
  if (!caller) {
    if (c.req.header("Authorization")?.startsWith("Basic ")) challengeBasic(c);
    return c.json({ error: "invalid_client" }, 401);
  }

  const token = params.token;
  if (token) {
    const tokenLookup = await hashLookupCandidate(c.env, token);
    // hashLookupCandidate returns null only for malicious inputs (those
    // that look like our internal stored representation); silently
    // accept and no-op.
    if (tokenLookup) {
      await c.env.DB.prepare(
        `DELETE FROM oauth_tokens
          WHERE client_id = ?
            AND (access_token = ? OR access_token = ?
                 OR refresh_token = ? OR refresh_token = ?
                 OR previous_refresh_token = ? OR previous_refresh_token = ?)`,
      )
        .bind(
          caller.client_id,
          token,
          tokenLookup,
          token,
          tokenLookup,
          token,
          tokenLookup,
        )
        .run();
    }
  }
  return new Response(null, { status: 200 });
});

// ─── RP-Initiated Logout (OpenID Connect) ────────────────────────────────────

// end_session_endpoint. Ends the caller's Prism session and, when a registered
// post_logout_redirect_uri is supplied, sends the browser back to it with the
// client's `state`. Accepts GET and POST (OIDC RP-Initiated Logout §2/§5).
async function handleEndSession(c: Context<AppEnv>): Promise<Response> {
  const q = c.req.query();
  let form: Record<string, string> = {};
  if (c.req.method === "POST") {
    const ct = c.req.header("Content-Type") ?? "";
    if (ct.includes("application/x-www-form-urlencoded"))
      form = Object.fromEntries(new URLSearchParams(await c.req.text()));
  }
  const get = (k: string) => form[k] ?? q[k];
  const idTokenHint = get("id_token_hint");
  const postLogoutRedirectUri = get("post_logout_redirect_uri");
  const state = get("state");
  let clientIdHint = get("client_id");

  // A form POST from the app's site carries no session cookie (it is
  // SameSite=Lax), so it would look signed out already. Come back as a GET,
  // a top-level navigation the cookie does ride along on.
  if (c.req.method === "POST" && !c.get("user")) {
    const again = new URLSearchParams();
    for (const k of [
      "id_token_hint",
      "post_logout_redirect_uri",
      "state",
      "client_id",
    ]) {
      const v = get(k);
      if (v) again.set(k, v);
    }
    return c.redirect(`${c.env.APP_URL}/api/oauth/end_session?${again}`, 303);
  }
  // Whom and which Prism session a verified id_token_hint was issued for.
  let hint: { sub: string; sid: string } | null = null;
  let hintClientId: string | null = null;

  // Prefer the client identity from a verified id_token_hint. An expired hint
  // is still accepted (the session is ending); an unverifiable one is ignored.
  if (idTokenHint) {
    try {
      const rsa = await getRsaKeyPair(c.env.KV_SESSIONS);
      const payload = await verifyIdTokenRS256(idTokenHint, rsa.publicKey);
      const aud = payload.aud;
      if (typeof aud === "string") clientIdHint = aud;
      else if (Array.isArray(aud) && typeof aud[0] === "string")
        clientIdHint = aud[0];
      hintClientId = clientIdHint ?? null;
      if (typeof payload.sub === "string" && typeof payload.sid === "string")
        hint = { sub: payload.sub, sid: payload.sid };
    } catch {
      /* ignore an unverifiable hint */
    }
  }

  // Where the browser goes once signed out. Only a post_logout_redirect_uri
  // that the identified client has registered — otherwise the endpoint would
  // be an open redirect; else the built-in signed-out page.
  let target = `${c.env.APP_URL}/logged-out`;
  // The app the browser goes back to, named when the user is asked.
  let targetAppId: string | null = null;
  if (postLogoutRedirectUri && clientIdHint) {
    const appRow = await c.env.DB.prepare(
      "SELECT id, post_logout_redirect_uris FROM oauth_apps WHERE client_id = ? AND is_active = 1",
    )
      .bind(clientIdHint)
      .first<{ id: string; post_logout_redirect_uris: string }>();
    let allowList: string[] = [];
    if (appRow) {
      try {
        const parsed = JSON.parse(appRow.post_logout_redirect_uris);
        if (Array.isArray(parsed))
          allowList = parsed.filter((x): x is string => typeof x === "string");
      } catch {
        allowList = [];
      }
    }
    if (allowList.includes(postLogoutRedirectUri)) {
      const url = new URL(postLogoutRedirectUri);
      if (state) url.searchParams.set("state", state);
      target = url.toString();
      targetAppId = appRow!.id;
    }
  }

  const sessionId = c.get("sessionId");
  const endingUser = c.get("user");
  // Any page can link here, so a sign-out is only a request unless its
  // id_token_hint belongs to this very session: issued to this user, in this
  // browser session (sid), for an app that is still active and that the user
  // hasn't revoked. Anything else, the user confirms on the /logout page
  // (OpenID Connect RP-Initiated Logout §2). An ID token from another
  // session, or one that leaked, signs nobody out. A site admin can keep
  // this to first-party apps.
  const firstPartyOnly =
    (await getConfigValue(c.env.DB, "silent_logout_first_party_only")) === true;
  const fromThisSession =
    !!endingUser &&
    !!sessionId &&
    hint?.sub === endingUser.id &&
    hint.sid === sessionId &&
    !!hintClientId &&
    !!(await c.env.DB.prepare(
      `SELECT 1 FROM oauth_apps a
       WHERE a.client_id = ? AND a.is_active = 1
         AND (a.is_first_party = 1 OR (? = 0 AND EXISTS (
           SELECT 1 FROM oauth_consents c WHERE c.client_id = a.client_id AND c.user_id = ?)))`,
    )
      .bind(hintClientId, firstPartyOnly ? 1 : 0, endingUser.id)
      .first());
  if (endingUser && sessionId && !fromThisSession) {
    const page = await startUnverifiedLogout(c.env.DB, {
      appId: targetAppId,
      finishUrl: target,
    });
    return c.redirect(`${c.env.APP_URL}${page}`, 302);
  }

  // End the current session (if the browser presented one) and clear the cookie.
  // OIDC Back-Channel Logout: notify the user's clients before the session row
  // is gone (delivery reads only ids we already hold).
  if (endingUser)
    await deliverBackChannelLogout(
      c.env,
      c.executionCtx,
      endingUser.id,
      sessionId ?? null,
    );
  // SAML Single Logout: the session's SPs are visited first, on the way to
  // the target, by this browser (the cookie). Read before the session (and
  // its SAML sign-ins) are gone.
  const samlLogout = sessionId
    ? await startIdpLogout(c.env.DB, sessionId, target)
    : null;
  if (samlLogout) setSamlLogoutCookie(c, samlLogout, LOGOUT_TTL_SECONDS);
  if (sessionId)
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?")
      .bind(sessionId)
      .run();
  clearSessionCookie(c);

  return c.redirect(samlLogout ? `${c.env.APP_URL}/logout` : target, 302);
}

app.get("/end_session", optionalAuth, handleEndSession);
app.post("/end_session", optionalAuth, handleEndSession);

/**
 * Resolve an OAuth access token value (JWT or opaque) to its live grant, for
 * RFC 8693 token exchange. Returns the owner, scopes and issuing client, or
 * null when the token is unknown, expired, or its user is inactive.
 */
async function lookupAccessToken(
  c: Context<AppEnv>,
  token: string,
): Promise<{ userId: string; scopes: string[]; clientId: string } | null> {
  const now = Math.floor(Date.now() / 1000);
  let tokenRow: {
    user_id: string;
    scopes: string;
    expires_at: number;
    client_id: string;
  } | null;

  if (token.split(".").length === 3) {
    try {
      const mldsaKey = await getMLDSAKey(c.env.KV_SESSIONS);
      const payload = verifyAccessToken(token, mldsaKey.publicKey);
      tokenRow = await c.env.DB.prepare(
        "SELECT user_id, scopes, expires_at, client_id FROM oauth_tokens WHERE id = ?",
      )
        .bind(payload.jti)
        .first();
    } catch {
      return null;
    }
  } else {
    const lookup = await hashLookupCandidate(c.env, token);
    if (!lookup) return null;
    tokenRow = await c.env.DB.prepare(
      "SELECT user_id, scopes, expires_at, client_id FROM oauth_tokens WHERE access_token = ? OR access_token = ?",
    )
      .bind(token, lookup)
      .first();
  }

  if (!tokenRow || tokenRow.expires_at < now) return null;
  const userRow = await c.env.DB.prepare(
    "SELECT id FROM users WHERE id = ? AND is_active = 1 AND kind = 'user'",
  )
    .bind(tokenRow.user_id)
    .first<{ id: string }>();
  if (!userRow) return null;

  return {
    userId: tokenRow.user_id,
    scopes: JSON.parse(tokenRow.scopes) as string[],
    clientId: tokenRow.client_id,
  };
}

// OAuth-protected resource API (/me/*): see oauth-me.ts.
app.route("/", meRoutes);

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function buildClaims(
  user: UserRow,
  clientId: string,
  scopes: string[],
  db: D1Database,
  appUrl: string,
): Promise<Record<string, unknown>> {
  const appRow = await db
    .prepare("SELECT oidc_fields FROM oauth_apps WHERE client_id = ?")
    .bind(clientId)
    .first<{ oidc_fields: string }>();
  const oidcFields = new Set<string>(
    JSON.parse(appRow?.oidc_fields ?? "[]") as string[],
  );
  const wants = (field: string) => oidcFields.has(field);

  const claims: Record<string, unknown> = {
    sub: user.id,
    role: user.role,
  };
  if (scopes.includes("profile")) {
    claims.name = user.display_name;
    claims.preferred_username = user.username;
    claims.picture = await proxyImageUrl(appUrl, db, user.avatar_url);
  }
  if (scopes.includes("email")) {
    claims.email = user.email;
    claims.email_verified = user.email_verified === 1;
  }
  if (scopes.includes("teams:read")) {
    const rows = await db
      .prepare(
        "SELECT t.id, t.name, tm.role FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.user_id = ?",
      )
      .bind(user.id)
      .all<{ id: string; name: string; role: string }>();
    // Member groups for every team at once — teams with groups disabled are
    // simply absent from the map.
    const groupsByTeam = await getGroupsForUserByTeam(
      db,
      user.id,
      rows.results.map((r) => r.id),
    );
    // Flat claims always emitted with teams:read — required for Cloudflare Access policies
    for (const r of rows.results) {
      claims[`in_team_${r.id}`] = true;
      claims[`role_in_team_${r.id}`] = r.role;
      // Omitted rather than emitted empty: absence already means "holds no
      // group here", and it keeps the token from growing a claim per team.
      const groups = groupsByTeam.get(r.id);
      if (groups?.length)
        claims[`groups_in_team_${r.id}`] = groups.map((g) => g.slug);
    }
    // Structured array only when opted into via oidc_fields
    if (wants("teams")) {
      claims.teams = rows.results.map((r) => ({
        id: r.id,
        name: r.name,
        role: r.role,
        groups: (groupsByTeam.get(r.id) ?? []).map((g) => g.slug),
      }));
    }
  }

  // Emit flat claims for explicitly bound team scopes (team:<teamId>:*)
  const boundTeamIds = new Set<string>();
  for (const s of scopes) {
    const parsed = parseBoundTeamScope(s);
    if (parsed) boundTeamIds.add(parsed.teamId);
  }
  if (boundTeamIds.size > 0) {
    const placeholders = [...boundTeamIds].map(() => "?").join(", ");
    const boundRows = await db
      .prepare(
        `SELECT t.id, tm.role FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.user_id = ? AND t.id IN (${placeholders})`,
      )
      .bind(user.id, ...[...boundTeamIds])
      .all<{ id: string; role: string }>();
    // An app may hold only bound team scopes without `teams:read`, so this
    // path needs its own group lookup — otherwise those apps would see the
    // membership claims but never the labels.
    const boundGroups = await getGroupsForUserByTeam(
      db,
      user.id,
      boundRows.results.map((r) => r.id),
    );
    for (const r of boundRows.results) {
      claims[`in_team_${r.id}`] = true;
      claims[`role_in_team_${r.id}`] = r.role;
      const groups = boundGroups.get(r.id);
      if (groups?.length)
        claims[`groups_in_team_${r.id}`] = groups.map((g) => g.slug);
    }
  }

  if (scopes.includes("apps:read") && wants("apps")) {
    const rows = await db
      .prepare(
        "SELECT id, name, client_id, is_verified FROM oauth_apps WHERE owner_id = ? AND team_id IS NULL ORDER BY created_at DESC",
      )
      .bind(user.id)
      .all<{
        id: string;
        name: string;
        client_id: string;
        is_verified: number;
      }>();
    claims.apps = rows.results.map((r) => ({
      id: r.id,
      name: r.name,
      client_id: r.client_id,
      is_verified: r.is_verified === 1,
    }));
  }
  if (scopes.includes("domains:read") && wants("domains")) {
    const rows = await db
      .prepare(
        "SELECT id, domain, verified FROM domains WHERE user_id = ? AND team_id IS NULL ORDER BY created_at DESC",
      )
      .bind(user.id)
      .all<{ id: string; domain: string; verified: number }>();
    claims.domains = rows.results.map((r) => ({
      id: r.id,
      domain: r.domain,
      verified: r.verified === 1,
    }));
  }
  if (scopes.includes("gpg:read") && wants("gpg_keys")) {
    const rows = await db
      .prepare(
        "SELECT id, fingerprint, key_id, name FROM user_gpg_keys WHERE user_id = ? ORDER BY created_at ASC",
      )
      .bind(user.id)
      .all<{ id: string; fingerprint: string; key_id: string; name: string }>();
    claims.gpg_keys = rows.results.map((r) => ({
      id: r.id,
      fingerprint: r.fingerprint,
      key_id: r.key_id,
      name: r.name,
    }));
  }
  if (scopes.includes("social:read") && wants("social_accounts")) {
    const rows = await db
      .prepare(
        "SELECT id, provider, provider_user_id FROM social_connections WHERE user_id = ? ORDER BY connected_at ASC",
      )
      .bind(user.id)
      .all<{ id: string; provider: string; provider_user_id: string }>();
    claims.social_accounts = rows.results.map((r) => ({
      id: r.id,
      provider: r.provider,
      provider_user_id: r.provider_user_id,
    }));
  }
  return claims;
}

/** Access- and refresh-token lifetimes in seconds: the user's own override,
 *  else the site default. */
function tokenTtls(
  user: UserRow,
  config: { access_token_ttl_minutes: number; refresh_token_ttl_days: number },
): { atTtl: number; rtTtl: number } {
  return {
    atTtl:
      (user.access_token_ttl_minutes ?? config.access_token_ttl_minutes) * 60,
    rtTtl:
      (user.refresh_token_ttl_days ?? config.refresh_token_ttl_days) * 86400,
  };
}

/** A new access token for the grant: an ML-DSA-signed at+JWT when the app
 *  uses JWT tokens, otherwise an opaque random value. */
async function mintAccessToken(
  c: Context<AppEnv>,
  app: OAuthAppRow,
  t: {
    sub: string;
    clientId: string;
    jti: string;
    scopes: string[];
    resources: string[];
    dpopJkt: string | null;
    authTime?: number | null;
    amr?: string | null;
    ttl: number;
  },
): Promise<string> {
  if (!app.use_jwt_tokens) return randomBase64url(48);
  const mldsaKey = await getMLDSAKey(c.env.KV_SESSIONS);
  return signAccessToken(
    {
      iss: c.env.APP_URL,
      sub: t.sub,
      aud: extractAud(t.scopes, c.env.APP_URL, t.resources),
      client_id: t.clientId,
      jti: t.jti,
      scope: t.scopes.join(" "),
      ...(t.dpopJkt ? { cnf: { jkt: t.dpopJkt } } : {}),
      ...accessAuthClaims(t.authTime ?? null, t.amr ?? null),
    },
    mldsaKey.secretKey,
    mldsaKey.kid,
    t.ttl,
  );
}

/** Insert a newly issued grant into oauth_tokens.
 *
 *  The bearer values are stored as their HMAC-keyed hash so a D1 leak doesn't
 *  surrender every active session. JWT access tokens are hashed too even
 *  though they're verified by signature (lookup uses the jti column) — keeps
 *  the column shape uniform and lets revocation match the supplied JWT via
 *  the OR-pattern. */
async function insertOAuthToken(
  env: Env,
  t: {
    id: string;
    accessToken: string;
    refreshToken: string | null;
    clientId: string;
    userId: string;
    scopes: string[];
    resource: string | null;
    dpopJkt: string | null;
    authTime?: number | null;
    amr?: string | null;
    expiresAt: number;
    refreshExpiresAt: number | null;
    now: number;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO oauth_tokens (id, access_token, refresh_token, client_id, user_id, scopes, resource, dpop_jkt, auth_time, amr, expires_at, refresh_expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      t.id,
      await hashSecret(env, t.accessToken),
      await hashSecret(env, t.refreshToken),
      t.clientId,
      t.userId,
      JSON.stringify(t.scopes),
      t.resource,
      t.dpopJkt,
      t.authTime ?? null,
      t.amr ?? null,
      t.expiresAt,
      t.refreshExpiresAt,
      t.now,
    )
    .run();
}

/** RFC 9470 authentication-context claims for a JWT access token, from the
 *  authorizing session's auth_time + amr (stored on the code/token). */
function accessAuthClaims(
  authTime: number | null,
  amrJson: string | null,
): { auth_time?: number; acr?: string; amr?: string[] } {
  const out: { auth_time?: number; acr?: string; amr?: string[] } = {};
  if (authTime != null) out.auth_time = authTime;
  if (amrJson) {
    const amr = JSON.parse(amrJson) as string[];
    if (amr.length) {
      out.amr = amr;
      out.acr = deriveAcr(amr);
    }
  }
  return out;
}

async function buildIdToken(
  user: UserRow,
  clientId: string,
  scopes: string[],
  nonce: string | null,
  privateKey: CryptoKey,
  kid: string,
  ttl: number,
  issuer: string,
  db: D1Database,
  authContext?: {
    authTime: number | null;
    amr: string[] | null;
    sid?: string | null;
  },
): Promise<string> {
  const { signIdTokenRS256 } = await import("../lib/jwt");
  const claims = await buildClaims(user, clientId, scopes, db, issuer);
  claims.iss = issuer;
  claims.aud = clientId;
  if (nonce) claims.nonce = nonce;
  // OIDC Core §2: auth_time / acr / amr, when the authenticating session's
  // context was captured at consent. sid backs OIDC back-channel logout.
  if (authContext?.authTime != null) claims.auth_time = authContext.authTime;
  if (authContext?.amr && authContext.amr.length) {
    claims.amr = authContext.amr;
    claims.acr = deriveAcr(authContext.amr);
  }
  if (authContext?.sid) claims.sid = authContext.sid;
  return signIdTokenRS256(claims, privateKey, kid, ttl);
}

export default app;
