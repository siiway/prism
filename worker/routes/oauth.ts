// OAuth 2.0 Authorization Server (Authorization Code + PKCE, OpenID Connect)

import { Hono } from "hono";
import { getConfig, getRsaKeyPair } from "../lib/config";
import { getMLDSAKey } from "../lib/mldsa";
import { signAccessToken, verifyAccessToken, extractAud } from "../lib/jwt";
import {
  randomBase64url,
  randomId,
  verifyPkce,
  timingSafeStrEqual,
} from "../lib/crypto";
import { verifyAnyTotp } from "../lib/totp";
import { requireAuth, optionalAuth } from "../middleware/auth";
import {
  computeIsVerified,
  buildVerifiedDomainsMap,
  computeVerified,
} from "../lib/domainVerify";
import { hmacSign } from "../lib/webhooks";
import { proxyImageUrl } from "../lib/proxyImage";
import {
  parseAppScope,
  parseUnboundTeamScope,
  parseBoundTeamScope,
  bindTeamScopes,
  UNBOUND_TEAM_SCOPES,
} from "../lib/scopes";
import { deliverAppEvent } from "../lib/app-events";
import {
  deliverUserEmailNotifications,
  notificationActorMetaFromHeaders,
} from "../lib/notifications";
import type {
  OAuthAppRow,
  OAuthCodeRow,
  OAuthTokenRow,
  UserRow,
  WebhookDeliveryRow,
  WebhookRow,
  Variables,
} from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

const VALID_SCOPES = new Set([
  "openid",
  "profile",
  "profile:write",
  "email",
  "apps:read",
  "apps:write",
  "teams:read",
  "teams:write",
  "teams:create",
  "teams:delete",
  "domains:read",
  "domains:write",
  "gpg:read",
  "gpg:write",
  "social:read",
  "social:write",
  "admin:users:read",
  "admin:users:write",
  "admin:users:delete",
  "admin:config:read",
  "admin:config:write",
  "admin:invites:read",
  "admin:invites:create",
  "admin:invites:delete",
  "admin:webhooks:read",
  "admin:webhooks:write",
  "admin:webhooks:delete",
  "webhooks:read",
  "webhooks:write",
  "offline_access",
  // Site-level scopes — full cross-user access, admin-only grant, requires 2FA + confirmation
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

function unboundTeamPermissions(scopes: string[]): string[] {
  return scopes
    .map((s) => parseUnboundTeamScope(s))
    .filter((p): p is string => p !== null);
}

// ─── Scope helpers ───────────────────────────────────────────────────────────

/**
 * Resolves requested scopes against what the app is allowed to request.
 * Regular platform scopes are checked against VALID_SCOPES.
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
    if (VALID_SCOPES.has(s) || UNBOUND_TEAM_SCOPES.has(s)) {
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
      app_icon_url: proxyImageUrl(appUrl, target.icon_url),
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

  const [consentRows, tokenRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT oc.client_id, oc.scopes, oc.granted_at,
              oa.name, oa.description, oa.icon_url, oa.website_url,
              oa.owner_id, oa.redirect_uris
       FROM oauth_consents oc
       JOIN oauth_apps oa ON oa.client_id = oc.client_id
       WHERE oc.user_id = ?
       ORDER BY oc.granted_at DESC`,
    )
      .bind(user.id)
      .all<{
        client_id: string;
        scopes: string;
        granted_at: number;
        name: string;
        description: string;
        icon_url: string | null;
        website_url: string | null;
        owner_id: string;
        redirect_uris: string;
      }>(),
    c.env.DB.prepare(
      `SELECT id, client_id, scopes, created_at, expires_at, refresh_expires_at
       FROM oauth_tokens
       WHERE user_id = ? AND expires_at > ?
       ORDER BY created_at DESC`,
    )
      .bind(user.id, now)
      .all<{
        id: string;
        client_id: string;
        scopes: string;
        created_at: number;
        expires_at: number;
        refresh_expires_at: number | null;
      }>(),
  ]);

  const ownerIds = [...new Set(consentRows.results.map((r) => r.owner_id))];
  const domainsMap = await buildVerifiedDomainsMap(c.env.DB, ownerIds);

  // Group tokens by client_id
  const tokensByApp = new Map<string, typeof tokenRows.results>();
  for (const t of tokenRows.results) {
    const list = tokensByApp.get(t.client_id) ?? [];
    list.push(t);
    tokensByApp.set(t.client_id, list);
  }

  return c.json({
    consents: consentRows.results.map((r) => ({
      client_id: r.client_id,
      scopes: JSON.parse(r.scopes) as string[],
      granted_at: r.granted_at,
      app: {
        name: r.name,
        description: r.description,
        icon_url: proxyImageUrl(c.env.APP_URL, r.icon_url),
        unproxied_icon_url: r.icon_url,
        website_url: r.website_url,
        is_verified: computeVerified(
          domainsMap.get(r.owner_id) ?? new Set(),
          r.website_url,
          r.redirect_uris,
        ),
      },
      tokens: (tokensByApp.get(r.client_id) ?? []).map((t) => ({
        id: t.id,
        scopes: JSON.parse(t.scopes) as string[],
        created_at: t.created_at,
        expires_at: t.expires_at,
        is_persistent: t.refresh_expires_at !== null,
      })),
    })),
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
  return c.json({ message: "Token revoked" });
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
        deliverAppEvent(c.env.DB, appRow.id, "user.token_revoked", {
          user_id: user.id,
        }).catch(() => {}),
        deliverUserEmailNotifications(
          c.env.DB,
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
  }

  return c.json({ message: "Access revoked" });
});

// GET /api/oauth/authorize — redirect browser to SPA consent page
app.get("/authorize", (c) => {
  const qs = new URL(c.req.url).search;
  return c.redirect(`/oauth/authorize${qs}`, 302);
});

// GET /api/oauth/app-info — consent screen data (called by the SPA)
app.get("/app-info", optionalAuth, async (c) => {
  const {
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

  if (!client_id || !redirect_uri || response_type !== "code") {
    return c.json({ error: "invalid_request" }, 400);
  }

  const oauthApp = await c.env.DB.prepare(
    "SELECT * FROM oauth_apps WHERE client_id = ? AND is_active = 1",
  )
    .bind(client_id)
    .first<OAuthAppRow>();
  if (!oauthApp) return c.json({ error: "invalid_client" }, 400);

  const redirectUris = JSON.parse(oauthApp.redirect_uris) as string[];
  if (!redirectUris.includes(redirect_uri))
    return c.json({ error: "invalid_redirect_uri" }, 400);

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
    const { results } = await c.env.DB.prepare(
      `SELECT t.id, t.name, t.avatar_url, tm.role
       FROM team_members tm JOIN teams t ON t.id = tm.team_id
       WHERE tm.user_id = ? AND tm.role IN ('owner','co-owner','admin')
       ORDER BY CASE tm.role WHEN 'owner' THEN 0 WHEN 'co-owner' THEN 1 ELSE 2 END, t.name ASC`,
    )
      .bind(c.get("user")!.id)
      .all<{
        id: string;
        name: string;
        avatar_url: string | null;
        role: string;
      }>();
    userAdminTeams = results.map((t) => ({
      ...t,
      avatar_url: proxyImageUrl(c.env.APP_URL, t.avatar_url),
    }));
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
  const currentUser = c.get("user");
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

  return c.json({
    app: {
      id: oauthApp.id,
      name: oauthApp.name,
      description: oauthApp.description,
      icon_url: proxyImageUrl(c.env.APP_URL, oauthApp.icon_url),
      unproxied_icon_url: oauthApp.icon_url,
      website_url: oauthApp.website_url,
      is_verified: isVerified,
      is_official: oauthApp.is_official === 1,
      is_first_party: oauthApp.is_first_party === 1,
      is_public: oauthApp.is_public === 1,
    },
    scopes,
    optional_scopes: optionalScopes,
    app_scopes: appScopes,
    rejected_scopes: rejected,
    redirect_uri,
    state,
    code_challenge,
    code_challenge_method,
    nonce,
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
    totp_code?: string;
    passkey_verify_token?: string;
    confirm_text?: string;
    team_id?: string;
  }>();

  if (body.action === "deny") {
    const url = new URL(body.redirect_uri);
    url.searchParams.set("error", "access_denied");
    if (body.state) url.searchParams.set("state", body.state);
    return c.json({ redirect: url.toString() });
  }

  const oauthApp = await c.env.DB.prepare(
    "SELECT * FROM oauth_apps WHERE client_id = ? AND is_active = 1",
  )
    .bind(body.client_id)
    .first<OAuthAppRow>();
  if (!oauthApp) return c.json({ error: "invalid_client" }, 400);

  const redirectUris = JSON.parse(oauthApp.redirect_uris) as string[];
  if (!redirectUris.includes(body.redirect_uri))
    return c.json({ error: "invalid_redirect_uri" }, 400);

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
          message:
            "Site-level scopes can only be granted by a site administrator.",
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
      twoFaOk = await verifyAnyTotp(c.env.DB, user.id, body.totp_code);
    }

    if (!twoFaOk) {
      return c.json(
        {
          error: "site_scope_totp_invalid",
          message:
            body.totp_code || body.passkey_verify_token
              ? "Invalid 2FA credential."
              : "A 2FA verification is required to grant site-level scopes.",
        },
        400,
      );
    }
    if (body.confirm_text?.trim().toLowerCase() !== SITE_SCOPE_CONFIRM_PHRASE) {
      return c.json(
        {
          error: "site_scope_confirm_required",
          message: `Type "${SITE_SCOPE_CONFIRM_PHRASE}" to confirm.`,
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
          message: "Select a team to grant access to.",
        },
        400,
      );
    }
    // Verify the user is owner/admin/co-owner of the selected team
    const membership = await c.env.DB.prepare(
      "SELECT role FROM team_members WHERE team_id = ? AND user_id = ?",
    )
      .bind(body.team_id, user.id)
      .first<{ role: string }>();

    if (
      !membership ||
      !["owner", "co-owner", "admin"].includes(membership.role)
    ) {
      return c.json(
        {
          error: "team_scope_forbidden",
          message: "You must be a team owner or admin to grant team access.",
        },
        403,
      );
    }

    // team:delete requires owner or co-owner
    const requestsDelete = scopes.includes("team:delete");
    if (requestsDelete && !["owner", "co-owner"].includes(membership.role)) {
      return c.json(
        {
          error: "team_scope_owner_required",
          message: "Only team owners can grant team deletion access.",
        },
        403,
      );
    }

    boundScopes = bindTeamScopes(scopes, body.team_id);

    // Audit log
    const grantedPerms = scopes
      .map((s) => parseUnboundTeamScope(s))
      .filter((p): p is string => p !== null);
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

  // Store consent
  const now = Math.floor(Date.now() / 1000);
  const siteScopes = boundScopes.filter((s) => SITE_SCOPES.has(s));
  await c.env.DB.prepare(
    `INSERT INTO oauth_consents (id, user_id, client_id, scopes, granted_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, client_id) DO UPDATE SET scopes = excluded.scopes, granted_at = excluded.granted_at`,
  )
    .bind(randomId(), user.id, body.client_id, JSON.stringify(boundScopes), now)
    .run();

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

  c.executionCtx.waitUntil(
    deliverUserEmailNotifications(
      c.env.DB,
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

  // Issue authorization code (10 minute TTL)
  const code = randomBase64url(32);
  await c.env.DB.prepare(
    `INSERT INTO oauth_codes (code, client_id, user_id, redirect_uri, scopes, code_challenge, code_challenge_method, nonce, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      code,
      body.client_id,
      user.id,
      body.redirect_uri,
      JSON.stringify(boundScopes),
      body.code_challenge ?? null,
      body.code_challenge_method ?? null,
      body.nonce ?? null,
      now + 600,
      now,
    )
    .run();

  const url = new URL(body.redirect_uri);
  url.searchParams.set("code", code);
  if (body.state) url.searchParams.set("state", body.state);

  // Notify the app that a user just granted access
  c.executionCtx.waitUntil(
    deliverAppEvent(c.env.DB, oauthApp.id, "user.token_granted", {
      user_id: user.id,
      scopes: boundScopes,
      granted_at: now,
    }).catch(() => {}),
  );

  return c.json({ redirect: url.toString() });
});

// ─── Token endpoint ──────────────────────────────────────────────────────────

app.post("/token", async (c) => {
  const contentType = c.req.header("Content-Type") ?? "";
  let params: Record<string, string>;

  if (contentType.includes("application/json")) {
    params = await c.req.json<Record<string, string>>();
  } else {
    const text = await c.req.text();
    params = Object.fromEntries(new URLSearchParams(text));
  }

  const {
    grant_type,
    code,
    redirect_uri,
    client_id,
    client_secret,
    code_verifier,
    refresh_token,
  } = params;

  // Authenticate client
  const authHeader = c.req.header("Authorization");
  let clientId = client_id;
  let clientSecret = client_secret;
  if (authHeader?.startsWith("Basic ")) {
    const decoded = atob(authHeader.slice(6));
    const [id, secret] = decoded.split(":");
    clientId = id ?? "";
    clientSecret = secret ?? "";
  }

  const oauthApp = await c.env.DB.prepare(
    "SELECT * FROM oauth_apps WHERE client_id = ? AND is_active = 1",
  )
    .bind(clientId)
    .first<OAuthAppRow>();
  if (!oauthApp) return c.json({ error: "invalid_client" }, 401);

  // For public clients (PKCE), secret not required; for confidential clients,
  // verify the secret in constant time. Refuse if either side is empty so a
  // confidential client with an unset stored secret can never authenticate
  // by sending an empty secret.
  if (!oauthApp.is_public) {
    if (
      !oauthApp.client_secret ||
      !clientSecret ||
      !timingSafeStrEqual(oauthApp.client_secret, clientSecret)
    ) {
      return c.json({ error: "invalid_client" }, 401);
    }
  }

  const config = await getConfig(c.env.DB);

  // ── Authorization Code grant ─────────────────────────────────────────────
  if (grant_type === "authorization_code") {
    const now = Math.floor(Date.now() / 1000);
    const codeRow = await c.env.DB.prepare(
      "SELECT * FROM oauth_codes WHERE code = ?",
    )
      .bind(code)
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

    // Consume code
    await c.env.DB.prepare("DELETE FROM oauth_codes WHERE code = ?")
      .bind(code)
      .run();

    const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
      .bind(codeRow.user_id)
      .first<UserRow>();
    if (!user || !user.is_active)
      return c.json({ error: "invalid_grant" }, 400);

    const scopes = JSON.parse(codeRow.scopes) as string[];
    const hasOffline = scopes.includes("offline_access");
    const atTtl = config.access_token_ttl_minutes * 60;
    const rtTtl = config.refresh_token_ttl_days * 24 * 60 * 60;
    const refreshToken = hasOffline ? randomBase64url(48) : null;

    const jti = randomId();
    let accessToken: string;
    if (oauthApp.use_jwt_tokens) {
      const mldsaKey = await getMLDSAKey(c.env.KV_SESSIONS);
      accessToken = signAccessToken(
        {
          iss: c.env.APP_URL,
          sub: user.id,
          aud: extractAud(scopes, c.env.APP_URL),
          client_id: clientId,
          jti,
          scope: scopes.join(" "),
        },
        mldsaKey.secretKey,
        mldsaKey.kid,
        atTtl,
      );
    } else {
      accessToken = randomBase64url(48);
    }

    await c.env.DB.prepare(
      `INSERT INTO oauth_tokens (id, access_token, refresh_token, client_id, user_id, scopes, expires_at, refresh_expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        jti,
        accessToken,
        refreshToken,
        clientId,
        user.id,
        JSON.stringify(scopes),
        now + atTtl,
        hasOffline ? now + rtTtl : null,
        now,
      )
      .run();

    const response: Record<string, unknown> = {
      access_token: accessToken,
      token_type: "Bearer",
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
      );
    }
    return c.json(response);
  }

  // ── Refresh Token grant ──────────────────────────────────────────────────
  if (grant_type === "refresh_token") {
    const now = Math.floor(Date.now() / 1000);
    const tokenRow = await c.env.DB.prepare(
      "SELECT * FROM oauth_tokens WHERE refresh_token = ?",
    )
      .bind(refresh_token)
      .first<OAuthTokenRow>();

    if (!tokenRow || tokenRow.client_id !== clientId)
      return c.json({ error: "invalid_grant" }, 400);
    if (!tokenRow.refresh_expires_at || tokenRow.refresh_expires_at < now) {
      return c.json(
        { error: "invalid_grant", error_description: "Refresh token expired" },
        400,
      );
    }

    const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
      .bind(tokenRow.user_id)
      .first<UserRow>();
    if (!user || !user.is_active)
      return c.json({ error: "invalid_grant" }, 400);

    const scopes = JSON.parse(tokenRow.scopes) as string[];
    const atTtl = config.access_token_ttl_minutes * 60;

    let newAccessToken: string;
    if (oauthApp.use_jwt_tokens) {
      const mldsaKey = await getMLDSAKey(c.env.KV_SESSIONS);
      newAccessToken = signAccessToken(
        {
          iss: c.env.APP_URL,
          sub: tokenRow.user_id,
          aud: extractAud(scopes, c.env.APP_URL),
          client_id: tokenRow.client_id,
          jti: tokenRow.id,
          scope: scopes.join(" "),
        },
        mldsaKey.secretKey,
        mldsaKey.kid,
        atTtl,
      );
    } else {
      newAccessToken = randomBase64url(48);
    }

    await c.env.DB.prepare(
      "UPDATE oauth_tokens SET access_token = ?, expires_at = ? WHERE id = ?",
    )
      .bind(newAccessToken, now + atTtl, tokenRow.id)
      .run();

    return c.json({
      access_token: newAccessToken,
      token_type: "Bearer",
      expires_in: atTtl,
      scope: scopes.join(" "),
      refresh_token,
    });
  }

  return c.json({ error: "unsupported_grant_type" }, 400);
});

// ─── UserInfo endpoint (OpenID Connect) ─────────────────────────────────────

app.get("/userinfo", async (c) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer "))
    return c.json({ error: "invalid_token" }, 401);
  const accessToken = auth.slice(7);

  const now = Math.floor(Date.now() / 1000);
  const tokenRow = await c.env.DB.prepare(
    "SELECT * FROM oauth_tokens WHERE access_token = ?",
  )
    .bind(accessToken)
    .first<OAuthTokenRow>();

  if (!tokenRow || tokenRow.expires_at < now)
    return c.json({ error: "invalid_token" }, 401);

  const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(tokenRow.user_id)
    .first<UserRow>();
  if (!user) return c.json({ error: "invalid_token" }, 401);

  const scopes = JSON.parse(tokenRow.scopes) as string[];
  const claims = await buildClaims(
    user,
    tokenRow.client_id,
    scopes,
    c.env.DB,
    c.env.APP_URL,
  );
  console.log("[OIDC] userinfo response", {
    sub: user.id,
    client_id: tokenRow.client_id,
    scopes,
    claim_keys: Object.keys(claims),
  });
  return c.json(claims);
});

// ─── Token introspection ─────────────────────────────────────────────────────

app.post("/introspect", async (c) => {
  const body = await c.req.text();
  const params = Object.fromEntries(new URLSearchParams(body));
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
    tokenRow = await c.env.DB.prepare(
      "SELECT * FROM oauth_tokens WHERE access_token = ?",
    )
      .bind(token)
      .first<OAuthTokenRow>();
  }

  if (!tokenRow || tokenRow.expires_at < now) return c.json({ active: false });

  const scopes = JSON.parse(tokenRow.scopes) as string[];
  return c.json({
    active: true,
    scope: scopes.join(" "),
    client_id: tokenRow.client_id,
    username: tokenRow.user_id,
    exp: tokenRow.expires_at,
    iat: tokenRow.created_at,
    sub: tokenRow.user_id,
  });
});

// ─── Revocation endpoint ─────────────────────────────────────────────────────

app.post("/revoke", async (c) => {
  const body = await c.req.text();
  const params = Object.fromEntries(new URLSearchParams(body));
  const token = params.token;
  if (token) {
    await c.env.DB.prepare(
      "DELETE FROM oauth_tokens WHERE access_token = ? OR refresh_token = ?",
    )
      .bind(token, token)
      .run();
  }
  return new Response(null, { status: 200 });
});

// ─── Resource endpoints (OAuth-protected) ────────────────────────────────────

/** Validate Bearer token (OAuth access token or PAT) and check for a required scope. */
async function resolveBearerToken(
  c: { req: { header(name: string): string | undefined }; env: Env },
  requiredScope: string,
): Promise<{ userId: string; scopes: string[] } | null> {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const raw = auth.slice(7);
  const now = Math.floor(Date.now() / 1000);

  // Personal Access Token (prism_pat_ prefix)
  if (raw.startsWith("prism_pat_")) {
    const pat = await c.env.DB.prepare(
      "SELECT user_id, scopes, expires_at FROM personal_access_tokens WHERE token = ?",
    )
      .bind(raw)
      .first<{ user_id: string; scopes: string; expires_at: number | null }>();
    if (!pat) return null;
    if (pat.expires_at !== null && pat.expires_at < now) return null;
    const scopes = JSON.parse(pat.scopes) as string[];
    if (!scopes.includes(requiredScope)) return null;
    // Update last_used_at asynchronously (best-effort)
    c.env.DB.prepare(
      "UPDATE personal_access_tokens SET last_used_at = ? WHERE token = ?",
    )
      .bind(now, raw)
      .run()
      .catch(() => {});
    return { userId: pat.user_id, scopes };
  }

  // JWT access token (three dot-separated segments)
  if (raw.split(".").length === 3) {
    let payload;
    try {
      const mldsaKey = await getMLDSAKey(c.env.KV_SESSIONS);
      payload = verifyAccessToken(raw, mldsaKey.publicKey);
    } catch {
      return null;
    }
    // Revocation check: look up by jti (= oauth_tokens.id)
    const tokenRow = await c.env.DB.prepare(
      "SELECT user_id, scopes, expires_at FROM oauth_tokens WHERE id = ?",
    )
      .bind(payload.jti)
      .first<{ user_id: string; scopes: string; expires_at: number }>();
    if (!tokenRow || tokenRow.expires_at < now) return null;
    const scopes = JSON.parse(tokenRow.scopes) as string[];
    if (!scopes.includes(requiredScope)) return null;
    return { userId: tokenRow.user_id, scopes };
  }

  // Legacy opaque access token (kept for backward compatibility)
  const tokenRow = await c.env.DB.prepare(
    "SELECT user_id, scopes, expires_at FROM oauth_tokens WHERE access_token = ?",
  )
    .bind(raw)
    .first<{ user_id: string; scopes: string; expires_at: number }>();
  if (!tokenRow || tokenRow.expires_at < now) return null;
  const scopes = JSON.parse(tokenRow.scopes) as string[];
  if (!scopes.includes(requiredScope)) return null;
  return { userId: tokenRow.user_id, scopes };
}

// GET /api/oauth/me/apps — list the token owner's OAuth apps (requires apps:read)
app.get("/me/apps", async (c) => {
  const resolved = await resolveBearerToken(c, "apps:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const { results } = await c.env.DB.prepare(
    `SELECT id, name, client_id, description, icon_url, website_url, is_public, enabled, created_at
     FROM oauth_apps WHERE owner_id = ? ORDER BY created_at DESC`,
  )
    .bind(resolved.userId)
    .all<{
      id: string;
      name: string;
      client_id: string;
      description: string | null;
      icon_url: string | null;
      website_url: string | null;
      is_public: number;
      enabled: number;
      created_at: number;
    }>();

  return c.json({
    apps: results.map((a) => ({
      ...a,
      icon_url: proxyImageUrl(c.env.APP_URL, a.icon_url),
      unproxied_icon_url: a.icon_url,
    })),
  });
});

// GET /api/oauth/me/teams — list the token owner's team memberships (requires teams:read)
app.get("/me/teams", async (c) => {
  const resolved = await resolveBearerToken(c, "teams:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.description, t.avatar_url, t.created_at,
            tm.role, tm.joined_at
     FROM team_members tm
     JOIN teams t ON t.id = tm.team_id
     WHERE tm.user_id = ?
     ORDER BY tm.joined_at DESC`,
  )
    .bind(resolved.userId)
    .all<{
      id: string;
      name: string;
      description: string | null;
      avatar_url: string | null;
      created_at: number;
      role: string;
      joined_at: number;
    }>();

  return c.json({
    teams: results.map((t) => ({
      ...t,
      avatar_url: proxyImageUrl(c.env.APP_URL, t.avatar_url),
      unproxied_avatar_url: t.avatar_url,
    })),
  });
});

// GET /api/oauth/me/domains — list the token owner's verified domains (requires domains:read)
app.get("/me/domains", async (c) => {
  const resolved = await resolveBearerToken(c, "domains:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const { results } = await c.env.DB.prepare(
    `SELECT domain, verified_at, next_reverify_at, created_at
     FROM domains
     WHERE user_id = ? AND verified = 1
     ORDER BY verified_at DESC`,
  )
    .bind(resolved.userId)
    .all<{
      domain: string;
      verified_at: number | null;
      next_reverify_at: number | null;
      created_at: number;
    }>();

  return c.json({ domains: results });
});

// GET /api/oauth/me/gpg-keys — list the token owner's GPG keys (requires gpg:read)
app.get("/me/gpg-keys", async (c) => {
  const resolved = await resolveBearerToken(c, "gpg:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const { results } = await c.env.DB.prepare(
    "SELECT id, fingerprint, key_id, name, created_at, last_used_at FROM user_gpg_keys WHERE user_id = ? ORDER BY created_at ASC",
  )
    .bind(resolved.userId)
    .all<{
      id: string;
      fingerprint: string;
      key_id: string;
      name: string;
      created_at: number;
      last_used_at: number | null;
    }>();

  return c.json({ keys: results });
});

// POST /api/oauth/me/gpg-keys — add a GPG key (requires gpg:write)
app.post("/me/gpg-keys", async (c) => {
  const resolved = await resolveBearerToken(c, "gpg:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const { parseArmoredPublicKey } = await import("../lib/gpg");
  const body = await c.req.json<{ public_key: string; name?: string }>();
  if (!body.public_key) return c.json({ error: "public_key is required" }, 400);

  let parsed: Awaited<ReturnType<typeof parseArmoredPublicKey>>;
  try {
    parsed = await parseArmoredPublicKey(body.public_key);
  } catch {
    return c.json({ error: "Invalid PGP public key" }, 400);
  }

  const name = (body.name?.trim() || parsed.uids[0] || parsed.keyId).slice(
    0,
    128,
  );
  const existing = await c.env.DB.prepare(
    "SELECT id FROM user_gpg_keys WHERE user_id = ? AND fingerprint = ?",
  )
    .bind(resolved.userId, parsed.fingerprint)
    .first();
  if (existing) return c.json({ error: "Key already added" }, 409);

  const id = randomId();
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    "INSERT INTO user_gpg_keys (id, user_id, fingerprint, key_id, name, public_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      resolved.userId,
      parsed.fingerprint,
      parsed.keyId,
      name,
      body.public_key.trim(),
      now,
    )
    .run();

  return c.json({
    id,
    fingerprint: parsed.fingerprint,
    key_id: parsed.keyId,
    name,
    created_at: now,
    last_used_at: null,
  });
});

// DELETE /api/oauth/me/gpg-keys/:id — remove a GPG key (requires gpg:write)
app.delete("/me/gpg-keys/:id", async (c) => {
  const resolved = await resolveBearerToken(c, "gpg:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const result = await c.env.DB.prepare(
    "DELETE FROM user_gpg_keys WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), resolved.userId)
    .run();
  if (!result.meta.changes) return c.json({ error: "Key not found" }, 404);
  return c.json({ message: "Key removed" });
});

// GET /api/oauth/me/social-connections — list the token owner's social connections (requires social:read)
app.get("/me/social-connections", async (c) => {
  const resolved = await resolveBearerToken(c, "social:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const { results } = await c.env.DB.prepare(
    "SELECT id, provider, provider_user_id, profile_data, connected_at FROM social_connections WHERE user_id = ? ORDER BY connected_at ASC",
  )
    .bind(resolved.userId)
    .all<{
      id: string;
      provider: string;
      provider_user_id: string;
      profile_data: string;
      connected_at: number;
    }>();

  return c.json({
    connections: results.map((r) => ({
      id: r.id,
      provider: r.provider,
      provider_user_id: r.provider_user_id,
      profile: JSON.parse(r.profile_data ?? "{}"),
      connected_at: r.connected_at,
    })),
  });
});

// DELETE /api/oauth/me/social-connections/:id — disconnect a social connection (requires social:write)
app.delete("/me/social-connections/:id", async (c) => {
  const resolved = await resolveBearerToken(c, "social:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const result = await c.env.DB.prepare(
    "DELETE FROM social_connections WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), resolved.userId)
    .run();
  if (!result.meta.changes)
    return c.json({ error: "Connection not found" }, 404);
  return c.json({ message: "Connection removed" });
});

// POST /api/oauth/me/teams — create a team (requires teams:create)
app.post("/me/teams", async (c) => {
  const resolved = await resolveBearerToken(c, "teams:create");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const body = await c.req.json<{
    name: string;
    description?: string;
    avatar_url?: string;
  }>();
  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);

  const id = randomId();
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO teams (id, name, description, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(
      id,
      body.name.trim(),
      body.description ?? "",
      body.avatar_url ?? null,
      now,
      now,
    ),
    c.env.DB.prepare(
      "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
    ).bind(id, resolved.userId, now),
  ]);

  const team = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ?")
    .bind(id)
    .first();

  return c.json({ team: { ...team, role: "owner" } }, 201);
});

// PATCH /api/oauth/me/teams/:id — update team settings (requires teams:write, owner or admin)
app.patch("/me/teams/:id", async (c) => {
  const resolved = await resolveBearerToken(c, "teams:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const teamId = c.req.param("id");
  const member = await c.env.DB.prepare(
    "SELECT role FROM team_members WHERE team_id = ? AND user_id = ?",
  )
    .bind(teamId, resolved.userId)
    .first<{ role: string }>();

  if (!member || !["owner", "co-owner", "admin"].includes(member.role))
    return c.json({ error: "Forbidden" }, 403);

  const body = await c.req.json<{
    name?: string;
    description?: string;
    avatar_url?: string;
  }>();

  const now = Math.floor(Date.now() / 1000);
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    updates.push("name = ?");
    values.push(body.name.trim());
  }
  if (body.description !== undefined) {
    updates.push("description = ?");
    values.push(body.description);
  }
  if (body.avatar_url !== undefined) {
    updates.push("avatar_url = ?");
    values.push(body.avatar_url || null);
  }

  if (updates.length === 0) return c.json({ error: "Nothing to update" }, 400);

  updates.push("updated_at = ?");
  values.push(now, teamId);

  await c.env.DB.prepare(`UPDATE teams SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const team = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ?")
    .bind(teamId)
    .first();

  return c.json({ team });
});

// DELETE /api/oauth/me/teams/:id — delete a team (requires teams:delete, owner only)
app.delete("/me/teams/:id", async (c) => {
  const resolved = await resolveBearerToken(c, "teams:delete");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const teamId = c.req.param("id");
  const member = await c.env.DB.prepare(
    "SELECT role FROM team_members WHERE team_id = ? AND user_id = ?",
  )
    .bind(teamId, resolved.userId)
    .first<{ role: string }>();

  if (!member || member.role !== "owner")
    return c.json({ error: "Only the team owner can delete the team" }, 403);

  // Disown team apps (hand back to creator)
  await c.env.DB.prepare(
    "UPDATE oauth_apps SET team_id = NULL WHERE team_id = ?",
  )
    .bind(teamId)
    .run();

  await c.env.DB.prepare("DELETE FROM teams WHERE id = ?").bind(teamId).run();

  return c.json({ message: "Team deleted" });
});

// POST /api/oauth/me/domains — add a domain for verification (requires domains:write)
app.post("/me/domains", async (c) => {
  const resolved = await resolveBearerToken(c, "domains:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const body = await c.req.json<{ domain: string }>();
  if (!body.domain) return c.json({ error: "domain is required" }, 400);

  const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
  if (!domainRegex.test(body.domain))
    return c.json({ error: "Invalid domain format" }, 400);

  const domain = body.domain.toLowerCase().trim();

  const existing = await c.env.DB.prepare(
    "SELECT id FROM domains WHERE user_id = ? AND domain = ?",
  )
    .bind(resolved.userId, domain)
    .first();
  if (existing) return c.json({ error: "Domain already added" }, 409);

  const verificationToken = randomBase64url(24);
  const id = randomId();
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    "INSERT INTO domains (id, user_id, domain, verification_token, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(id, resolved.userId, domain, verificationToken, now)
    .run();

  return c.json(
    {
      id,
      domain,
      verification_token: verificationToken,
      txt_record: `_prism-verify.${domain}`,
      txt_value: `prism-verify=${verificationToken}`,
    },
    201,
  );
});

// DELETE /api/oauth/me/domains/:domain — remove a domain (requires domains:write)
app.delete("/me/domains/:domain", async (c) => {
  const resolved = await resolveBearerToken(c, "domains:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const domain = c.req.param("domain");
  const row = await c.env.DB.prepare(
    "SELECT id FROM domains WHERE user_id = ? AND domain = ? AND team_id IS NULL",
  )
    .bind(resolved.userId, domain)
    .first();

  if (!row) return c.json({ error: "Domain not found" }, 404);

  await c.env.DB.prepare("DELETE FROM domains WHERE id = ?")
    .bind((row as { id: string }).id)
    .run();

  return c.json({ message: "Domain removed" });
});

// POST /api/oauth/me/invites — create a site invite (requires admin:invites:create, admin only)
app.post("/me/invites", async (c) => {
  const resolved = await resolveBearerToken(c, "admin:invites:create");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const user = await c.env.DB.prepare("SELECT role FROM users WHERE id = ?")
    .bind(resolved.userId)
    .first<{ role: string }>();

  if (!user || user.role !== "admin")
    return c.json({ error: "Admin role required" }, 403);

  const body = await c.req.json<{
    email?: string;
    note?: string;
    max_uses?: number;
    expires_in_days?: number;
  }>();

  const now = Math.floor(Date.now() / 1000);
  const id = randomId();
  const token = randomBase64url(24);
  const expiresAt = body.expires_in_days
    ? now + body.expires_in_days * 86400
    : null;

  await c.env.DB.prepare(
    `INSERT INTO site_invites (id, token, email, note, max_uses, use_count, created_by, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  )
    .bind(
      id,
      token,
      body.email?.toLowerCase().trim() ?? null,
      body.note ?? null,
      body.max_uses ?? null,
      resolved.userId,
      expiresAt,
      now,
    )
    .run();

  const inviteUrl = `${c.env.APP_URL}/register?invite=${token}`;

  return c.json(
    { id, token, invite_url: inviteUrl, expires_at: expiresAt },
    201,
  );
});

// GET /api/oauth/me/invites — list site invites (requires admin:invites:read, admin only)
app.get("/me/invites", async (c) => {
  const resolved = await resolveBearerToken(c, "admin:invites:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const user = await c.env.DB.prepare("SELECT role FROM users WHERE id = ?")
    .bind(resolved.userId)
    .first<{ role: string }>();
  if (!user || user.role !== "admin")
    return c.json({ error: "Admin role required" }, 403);

  const { results } = await c.env.DB.prepare(
    `SELECT i.id, i.token, i.email, i.note, i.max_uses, i.use_count,
            i.created_by, i.expires_at, i.created_at,
            u.username AS created_by_username
     FROM site_invites i
     LEFT JOIN users u ON u.id = i.created_by
     ORDER BY i.created_at DESC`,
  ).all();

  return c.json({ invites: results });
});

// DELETE /api/oauth/me/invites/:id — revoke an invite (requires admin:invites:delete, admin only)
app.delete("/me/invites/:id", async (c) => {
  const resolved = await resolveBearerToken(c, "admin:invites:delete");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const user = await c.env.DB.prepare("SELECT role FROM users WHERE id = ?")
    .bind(resolved.userId)
    .first<{ role: string }>();
  if (!user || user.role !== "admin")
    return c.json({ error: "Admin role required" }, 403);

  const invite = await c.env.DB.prepare(
    "SELECT id FROM site_invites WHERE id = ?",
  )
    .bind(c.req.param("id"))
    .first();
  if (!invite) return c.json({ error: "Invite not found" }, 404);

  await c.env.DB.prepare("DELETE FROM site_invites WHERE id = ?")
    .bind(c.req.param("id"))
    .run();

  return c.json({ message: "Invite revoked" });
});

// GET /api/oauth/me/profile — read own profile (requires profile scope)
app.get("/me/profile", async (c) => {
  const resolved = await resolveBearerToken(c, "profile");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const user = await c.env.DB.prepare(
    "SELECT id, username, display_name, avatar_url, email, email_verified, role, created_at FROM users WHERE id = ?",
  )
    .bind(resolved.userId)
    .first<{
      id: string;
      username: string;
      display_name: string;
      avatar_url: string | null;
      email: string;
      email_verified: number;
      role: string;
      created_at: number;
    }>();

  if (!user) return c.json({ error: "User not found" }, 404);

  return c.json({
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    avatar_url: proxyImageUrl(c.env.APP_URL, user.avatar_url),
    unproxied_avatar_url: user.avatar_url,
    email: resolved.scopes.includes("email") ? user.email : undefined,
    email_verified: resolved.scopes.includes("email")
      ? user.email_verified === 1
      : undefined,
    role: user.role,
    created_at: user.created_at,
  });
});

// PATCH /api/oauth/me/profile — update own profile (requires profile:write)
app.patch("/me/profile", async (c) => {
  const resolved = await resolveBearerToken(c, "profile:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const body = await c.req.json<{
    display_name?: string;
    avatar_url?: string | null;
  }>();

  const now = Math.floor(Date.now() / 1000);
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.display_name !== undefined) {
    if (!body.display_name.trim())
      return c.json({ error: "display_name cannot be empty" }, 400);
    updates.push("display_name = ?");
    values.push(body.display_name.trim());
  }
  if ("avatar_url" in body) {
    updates.push("avatar_url = ?");
    values.push(body.avatar_url ?? null);
  }

  if (updates.length === 0) return c.json({ error: "Nothing to update" }, 400);

  updates.push("updated_at = ?");
  values.push(now, resolved.userId);

  await c.env.DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const user = await c.env.DB.prepare(
    "SELECT id, username, display_name, avatar_url, role FROM users WHERE id = ?",
  )
    .bind(resolved.userId)
    .first<{
      id: string;
      username: string;
      display_name: string;
      avatar_url: string | null;
      role: string;
    }>();

  return c.json({
    user: user
      ? {
          ...user,
          avatar_url: proxyImageUrl(c.env.APP_URL, user.avatar_url),
          unproxied_avatar_url: user.avatar_url,
        }
      : null,
  });
});

// POST /api/oauth/me/apps — create an OAuth app (requires apps:write)
app.post("/me/apps", async (c) => {
  const resolved = await resolveBearerToken(c, "apps:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const body = await c.req.json<{
    name: string;
    description?: string;
    website_url?: string;
    redirect_uris: string[];
    allowed_scopes?: string[];
    is_public?: boolean;
  }>();

  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);
  if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0)
    return c.json({ error: "redirect_uris is required" }, 400);

  for (const uri of body.redirect_uris) {
    try {
      new URL(uri);
    } catch {
      return c.json({ error: `Invalid redirect_uri: ${uri}` }, 400);
    }
  }

  const allowedScopes = (
    body.allowed_scopes ?? ["openid", "profile", "email"]
  ).filter((s) => VALID_SCOPES.has(s));

  const id = randomId();
  const clientId = `prism_${randomBase64url(16)}`;
  const clientSecret = randomBase64url(32);
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    `INSERT INTO oauth_apps
       (id, owner_id, name, description, website_url, client_id, client_secret,
        redirect_uris, allowed_scopes, is_public, is_active, is_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
  )
    .bind(
      id,
      resolved.userId,
      body.name.trim(),
      body.description ?? "",
      body.website_url ?? null,
      clientId,
      clientSecret,
      JSON.stringify(body.redirect_uris),
      JSON.stringify(allowedScopes),
      body.is_public ? 1 : 0,
      now,
      now,
    )
    .run();

  return c.json(
    {
      id,
      client_id: clientId,
      client_secret: clientSecret,
      name: body.name.trim(),
      description: body.description ?? "",
      website_url: body.website_url ?? null,
      redirect_uris: body.redirect_uris,
      allowed_scopes: allowedScopes,
      is_public: !!body.is_public,
      created_at: now,
    },
    201,
  );
});

// PATCH /api/oauth/me/apps/:id — update own OAuth app (requires apps:write)
app.patch("/me/apps/:id", async (c) => {
  const resolved = await resolveBearerToken(c, "apps:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const appId = c.req.param("id");
  const appRow = await c.env.DB.prepare(
    "SELECT id, owner_id FROM oauth_apps WHERE id = ?",
  )
    .bind(appId)
    .first<{ id: string; owner_id: string }>();

  if (!appRow) return c.json({ error: "App not found" }, 404);
  if (appRow.owner_id !== resolved.userId)
    return c.json({ error: "Forbidden" }, 403);

  const body = await c.req.json<{
    name?: string;
    description?: string;
    website_url?: string | null;
    redirect_uris?: string[];
    allowed_scopes?: string[];
    is_public?: boolean;
  }>();

  const now = Math.floor(Date.now() / 1000);
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    updates.push("name = ?");
    values.push(body.name.trim());
  }
  if (body.description !== undefined) {
    updates.push("description = ?");
    values.push(body.description);
  }
  if ("website_url" in body) {
    updates.push("website_url = ?");
    values.push(body.website_url ?? null);
  }
  if (body.redirect_uris !== undefined) {
    for (const uri of body.redirect_uris) {
      try {
        new URL(uri);
      } catch {
        return c.json({ error: `Invalid redirect_uri: ${uri}` }, 400);
      }
    }
    updates.push("redirect_uris = ?");
    values.push(JSON.stringify(body.redirect_uris));
  }
  if (body.allowed_scopes !== undefined) {
    updates.push("allowed_scopes = ?");
    values.push(
      JSON.stringify(body.allowed_scopes.filter((s) => VALID_SCOPES.has(s))),
    );
  }
  if (body.is_public !== undefined) {
    updates.push("is_public = ?");
    values.push(body.is_public ? 1 : 0);
  }

  if (updates.length === 0) return c.json({ error: "Nothing to update" }, 400);

  updates.push("updated_at = ?");
  values.push(now, appId);

  await c.env.DB.prepare(
    `UPDATE oauth_apps SET ${updates.join(", ")} WHERE id = ?`,
  )
    .bind(...values)
    .run();

  const updated = await c.env.DB.prepare(
    "SELECT * FROM oauth_apps WHERE id = ?",
  )
    .bind(appId)
    .first<OAuthAppRow>();

  return c.json({ app: updated });
});

// DELETE /api/oauth/me/apps/:id — delete own OAuth app (requires apps:write)
app.delete("/me/apps/:id", async (c) => {
  const resolved = await resolveBearerToken(c, "apps:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const appId = c.req.param("id");
  const appRow = await c.env.DB.prepare(
    "SELECT id, owner_id FROM oauth_apps WHERE id = ?",
  )
    .bind(appId)
    .first<{ id: string; owner_id: string }>();

  if (!appRow) return c.json({ error: "App not found" }, 404);
  if (appRow.owner_id !== resolved.userId)
    return c.json({ error: "Forbidden" }, 403);

  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM oauth_tokens WHERE client_id = (SELECT client_id FROM oauth_apps WHERE id = ?)",
    ).bind(appId),
    c.env.DB.prepare(
      "DELETE FROM oauth_consents WHERE client_id = (SELECT client_id FROM oauth_apps WHERE id = ?)",
    ).bind(appId),
    c.env.DB.prepare("DELETE FROM oauth_apps WHERE id = ?").bind(appId),
  ]);

  return c.json({ message: "App deleted" });
});

// POST /api/oauth/me/domains/:domain/verify — trigger DNS re-check (requires domains:write)
app.post("/me/domains/:domain/verify", async (c) => {
  const resolved = await resolveBearerToken(c, "domains:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const domain = c.req.param("domain");
  const row = await c.env.DB.prepare(
    "SELECT id, verification_token, verified FROM domains WHERE user_id = ? AND domain = ? AND team_id IS NULL",
  )
    .bind(resolved.userId, domain)
    .first<{ id: string; verification_token: string; verified: number }>();

  if (!row) return c.json({ error: "Domain not found" }, 404);
  if (row.verified === 1)
    return c.json({ message: "Already verified", verified: true });

  // DNS TXT lookup via Cloudflare DNS-over-HTTPS
  let verified: boolean;
  try {
    const resp = await fetch(
      `https://cloudflare-dns.com/dns-query?name=_prism-verify.${domain}&type=TXT`,
      { headers: { Accept: "application/dns-json" } },
    );
    const data = await resp.json<{ Answer?: { data: string }[] }>();
    const expected = `"prism-verify=${row.verification_token}"`;
    verified = (data.Answer ?? []).some(
      (a) => a.data === expected || a.data === expected.slice(1, -1),
    );
  } catch {
    return c.json({ error: "DNS lookup failed" }, 502);
  }

  if (!verified)
    return c.json({ error: "TXT record not found", verified: false }, 422);

  const now = Math.floor(Date.now() / 1000);
  const config = await import("../lib/config").then((m) =>
    m.getConfig(c.env.DB),
  );
  const reverifyDays = config.domain_reverify_days ?? 30;

  await c.env.DB.prepare(
    "UPDATE domains SET verified = 1, verified_at = ?, next_reverify_at = ? WHERE id = ?",
  )
    .bind(now, now + reverifyDays * 86400, row.id)
    .run();

  return c.json({ verified: true, verified_at: now });
});

// POST /api/oauth/me/teams/:id/members — add a team member (requires teams:write, owner or admin)
app.post("/me/teams/:id/members", async (c) => {
  const resolved = await resolveBearerToken(c, "teams:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const teamId = c.req.param("id");
  const caller = await c.env.DB.prepare(
    "SELECT role FROM team_members WHERE team_id = ? AND user_id = ?",
  )
    .bind(teamId, resolved.userId)
    .first<{ role: string }>();

  if (!caller || !["owner", "admin"].includes(caller.role))
    return c.json({ error: "Forbidden" }, 403);

  const body = await c.req.json<{
    username: string;
    role?: "admin" | "member";
  }>();
  if (!body.username) return c.json({ error: "username is required" }, 400);

  const targetUser = await c.env.DB.prepare(
    "SELECT id FROM users WHERE username = ? AND is_active = 1",
  )
    .bind(body.username.toLowerCase().trim())
    .first<{ id: string }>();

  if (!targetUser) return c.json({ error: "User not found" }, 404);

  const alreadyMember = await c.env.DB.prepare(
    "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?",
  )
    .bind(teamId, targetUser.id)
    .first();

  if (alreadyMember)
    return c.json({ error: "User is already a team member" }, 409);

  // Only owners can add admins
  const role =
    body.role === "admin" && caller.role === "owner" ? "admin" : "member";
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)",
  )
    .bind(teamId, targetUser.id, role, now)
    .run();

  return c.json({ user_id: targetUser.id, role, joined_at: now }, 201);
});

// DELETE /api/oauth/me/teams/:id/members/:userId — remove a team member (requires teams:write, owner or admin)
app.delete("/me/teams/:id/members/:userId", async (c) => {
  const resolved = await resolveBearerToken(c, "teams:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const teamId = c.req.param("id");
  const targetUserId = c.req.param("userId");

  const caller = await c.env.DB.prepare(
    "SELECT role FROM team_members WHERE team_id = ? AND user_id = ?",
  )
    .bind(teamId, resolved.userId)
    .first<{ role: string }>();

  if (!caller || !["owner", "admin"].includes(caller.role))
    return c.json({ error: "Forbidden" }, 403);

  const target = await c.env.DB.prepare(
    "SELECT role FROM team_members WHERE team_id = ? AND user_id = ?",
  )
    .bind(teamId, targetUserId)
    .first<{ role: string }>();

  if (!target) return c.json({ error: "Member not found" }, 404);

  // Admins cannot remove owners or other admins
  if (caller.role === "admin" && target.role !== "member")
    return c.json({ error: "Admins can only remove regular members" }, 403);

  // Owners cannot remove themselves via this endpoint
  if (targetUserId === resolved.userId && target.role === "owner")
    return c.json({ error: "Owner cannot remove themselves" }, 403);

  await c.env.DB.prepare(
    "DELETE FROM team_members WHERE team_id = ? AND user_id = ?",
  )
    .bind(teamId, targetUserId)
    .run();

  return c.json({ message: "Member removed" });
});

// ─── Admin resource endpoints (token owner must have role = 'admin') ─────────

/** Ensure the token owner is a site admin. Returns the user row or null. */
async function requireAdminToken(
  c: { req: { header(name: string): string | undefined }; env: Env },
  requiredScope: string,
): Promise<{ userId: string; scopes: string[] } | null> {
  const resolved = await resolveBearerToken(c, requiredScope);
  if (!resolved) return null;
  const user = await c.env.DB.prepare("SELECT role FROM users WHERE id = ?")
    .bind(resolved.userId)
    .first<{ role: string }>();
  if (!user || user.role !== "admin") return null;
  return resolved;
}

// GET /api/oauth/me/admin/users — list all users (requires admin:users:read)
app.get("/me/admin/users", async (c) => {
  const resolved = await requireAdminToken(c, "admin:users:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const { page = "1", limit = "50", q } = c.req.query();
  const pageNum = Math.max(1, parseInt(page, 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * pageSize;

  let query =
    "SELECT id, username, display_name, avatar_url, email, email_verified, role, is_active, created_at FROM users";
  const binds: unknown[] = [];

  if (q) {
    query += " WHERE (username LIKE ? OR email LIKE ? OR display_name LIKE ?)";
    const like = `%${q}%`;
    binds.push(like, like, like);
  }

  query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  binds.push(pageSize, offset);

  const { results } = await c.env.DB.prepare(query)
    .bind(...binds)
    .all();

  const countQuery = q
    ? "SELECT COUNT(*) AS total FROM users WHERE username LIKE ? OR email LIKE ? OR display_name LIKE ?"
    : "SELECT COUNT(*) AS total FROM users";
  const countBinds = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];
  const countRow = await c.env.DB.prepare(countQuery)
    .bind(...countBinds)
    .first<{ total: number }>();

  return c.json({
    users: results.map((u) => proxyUserAvatar(c.env.APP_URL, u)),
    total: countRow?.total ?? 0,
    page: pageNum,
    limit: pageSize,
  });
});

// GET /api/oauth/me/admin/users/:id — get a user by id (requires admin:users:read)
app.get("/me/admin/users/:id", async (c) => {
  const resolved = await requireAdminToken(c, "admin:users:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const user = await c.env.DB.prepare(
    "SELECT id, username, display_name, avatar_url, email, email_verified, role, is_active, created_at FROM users WHERE id = ?",
  )
    .bind(c.req.param("id"))
    .first();

  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json({ user: proxyUserAvatar(c.env.APP_URL, user) });
});

// PATCH /api/oauth/me/admin/users/:id — update a user (requires admin:users:write)
app.patch("/me/admin/users/:id", async (c) => {
  const resolved = await requireAdminToken(c, "admin:users:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const targetId = c.req.param("id");
  const body = await c.req.json<{
    role?: "admin" | "user";
    is_active?: boolean;
    display_name?: string;
    avatar_url?: string | null;
  }>();

  const now = Math.floor(Date.now() / 1000);
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.role !== undefined && ["admin", "user"].includes(body.role)) {
    updates.push("role = ?");
    values.push(body.role);
  }
  if (body.is_active !== undefined) {
    updates.push("is_active = ?");
    values.push(body.is_active ? 1 : 0);
  }
  if (body.display_name !== undefined) {
    updates.push("display_name = ?");
    values.push(body.display_name.trim());
  }
  if ("avatar_url" in body) {
    updates.push("avatar_url = ?");
    values.push(body.avatar_url ?? null);
  }

  if (updates.length === 0) return c.json({ error: "Nothing to update" }, 400);

  updates.push("updated_at = ?");
  values.push(now, targetId);

  await c.env.DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const user = await c.env.DB.prepare(
    "SELECT id, username, display_name, avatar_url, email, email_verified, role, is_active, created_at FROM users WHERE id = ?",
  )
    .bind(targetId)
    .first();

  return c.json({ user: user ? proxyUserAvatar(c.env.APP_URL, user) : null });
});

// DELETE /api/oauth/me/admin/users/:id — delete a user (requires admin:users:delete)
app.delete("/me/admin/users/:id", async (c) => {
  const resolved = await requireAdminToken(c, "admin:users:delete");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const targetId = c.req.param("id");

  if (targetId === resolved.userId)
    return c.json(
      { error: "Cannot delete your own account via this endpoint" },
      403,
    );

  const target = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?")
    .bind(targetId)
    .first();
  if (!target) return c.json({ error: "User not found" }, 404);

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetId),
    c.env.DB.prepare("DELETE FROM oauth_tokens WHERE user_id = ?").bind(
      targetId,
    ),
    c.env.DB.prepare("DELETE FROM oauth_consents WHERE user_id = ?").bind(
      targetId,
    ),
    c.env.DB.prepare("DELETE FROM team_members WHERE user_id = ?").bind(
      targetId,
    ),
    c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(targetId),
  ]);

  return c.json({ message: "User deleted" });
});

// GET /api/oauth/me/site/users — list all users (requires site:user:read, token owner must be admin)
app.get("/me/site/users", async (c) => {
  const resolved = await requireAdminToken(c, "site:user:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const { page = "1", limit = "50", q } = c.req.query();
  const pageNum = Math.max(1, parseInt(page, 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * pageSize;

  let query =
    "SELECT id, username, display_name, avatar_url, email, email_verified, role, is_active, created_at FROM users";
  const binds: unknown[] = [];

  if (q) {
    query += " WHERE (username LIKE ? OR email LIKE ? OR display_name LIKE ?)";
    const like = `%${q}%`;
    binds.push(like, like, like);
  }

  query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  binds.push(pageSize, offset);

  const { results } = await c.env.DB.prepare(query)
    .bind(...binds)
    .all();

  const countQuery = q
    ? "SELECT COUNT(*) AS total FROM users WHERE username LIKE ? OR email LIKE ? OR display_name LIKE ?"
    : "SELECT COUNT(*) AS total FROM users";
  const countBinds = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];
  const countRow = await c.env.DB.prepare(countQuery)
    .bind(...countBinds)
    .first<{ total: number }>();

  return c.json({
    users: results.map((u) => proxyUserAvatar(c.env.APP_URL, u)),
    total: countRow?.total ?? 0,
    page: pageNum,
    limit: pageSize,
  });
});

// GET /api/oauth/me/site/users/:id — get a user by id (requires site:user:read, token owner must be admin)
app.get("/me/site/users/:id", async (c) => {
  const resolved = await requireAdminToken(c, "site:user:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const user = await c.env.DB.prepare(
    "SELECT id, username, display_name, avatar_url, email, email_verified, role, is_active, created_at FROM users WHERE id = ?",
  )
    .bind(c.req.param("id"))
    .first();

  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json({ user: proxyUserAvatar(c.env.APP_URL, user) });
});

// ─── Team-scoped OAuth routes ─────────────────────────────────────────────────
// All routes below require a bound team scope: team:<teamId>:<permission>

async function resolveTeamToken(
  c: { req: { header(name: string): string | undefined }; env: Env },
  teamId: string,
  permission: string,
): Promise<{ userId: string; scopes: string[] } | null> {
  return resolveBearerToken(c, `team:${teamId}:${permission}`);
}

// GET /api/oauth/me/team/:teamId/info
app.get("/me/team/:teamId/info", async (c) => {
  const teamId = c.req.param("teamId");
  const resolved = await resolveTeamToken(c, teamId, "read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const team = await c.env.DB.prepare(
    "SELECT id, name, description, avatar_url, created_at FROM teams WHERE id = ?",
  )
    .bind(teamId)
    .first<{
      id: string;
      name: string;
      description: string | null;
      avatar_url: string | null;
      created_at: number;
    }>();

  if (!team) return c.json({ error: "Team not found" }, 404);
  return c.json({
    team: {
      ...team,
      avatar_url: proxyImageUrl(c.env.APP_URL, team.avatar_url),
      unproxied_avatar_url: team.avatar_url,
    },
  });
});

// PATCH /api/oauth/me/team/:teamId/info
app.patch("/me/team/:teamId/info", async (c) => {
  const teamId = c.req.param("teamId");
  const resolved = await resolveTeamToken(c, teamId, "write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const body = await c.req.json<{
    name?: string;
    description?: string;
    avatar_url?: string | null;
  }>();
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    updates.push("name = ?");
    values.push(body.name.trim());
  }
  if (body.description !== undefined) {
    updates.push("description = ?");
    values.push(body.description ?? null);
  }
  if ("avatar_url" in body) {
    updates.push("avatar_url = ?");
    values.push(body.avatar_url ?? null);
  }

  if (updates.length === 0) return c.json({ error: "Nothing to update" }, 400);

  const now = Math.floor(Date.now() / 1000);
  updates.push("updated_at = ?");
  values.push(now, teamId);

  await c.env.DB.prepare(`UPDATE teams SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const team = await c.env.DB.prepare(
    "SELECT id, name, description, avatar_url, created_at FROM teams WHERE id = ?",
  )
    .bind(teamId)
    .first();

  return c.json({ team });
});

// GET /api/oauth/me/team/:teamId/members
app.get("/me/team/:teamId/members", async (c) => {
  const teamId = c.req.param("teamId");
  const resolved = await resolveTeamToken(c, teamId, "member:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const { results } = await c.env.DB.prepare(
    `SELECT tm.user_id, tm.role, tm.joined_at
     FROM team_members tm WHERE tm.team_id = ? ORDER BY tm.joined_at ASC`,
  )
    .bind(teamId)
    .all<{ user_id: string; role: string; joined_at: number }>();

  return c.json({ members: results });
});

// GET /api/oauth/me/team/:teamId/members/:userId/profile
app.get("/me/team/:teamId/members/:userId/profile", async (c) => {
  const teamId = c.req.param("teamId");
  const userId = c.req.param("userId");
  const resolved = await resolveTeamToken(c, teamId, "member:profile:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const row = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, tm.role, tm.joined_at
     FROM team_members tm JOIN users u ON u.id = tm.user_id
     WHERE tm.team_id = ? AND tm.user_id = ?`,
  )
    .bind(teamId, userId)
    .first<{
      id: string;
      username: string;
      display_name: string | null;
      avatar_url: string | null;
      role: string;
      joined_at: number;
    }>();

  if (!row) return c.json({ error: "Member not found" }, 404);
  return c.json({
    member: {
      ...row,
      avatar_url: proxyImageUrl(c.env.APP_URL, row.avatar_url),
      unproxied_avatar_url: row.avatar_url,
    },
  });
});

// POST /api/oauth/me/team/:teamId/members
app.post("/me/team/:teamId/members", async (c) => {
  const teamId = c.req.param("teamId");
  const resolved = await resolveTeamToken(c, teamId, "member:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const body = await c.req.json<{ user_id: string; role?: string }>();
  if (!body.user_id) return c.json({ error: "user_id is required" }, 400);

  const role = body.role === "admin" ? "admin" : "member";
  const now = Math.floor(Date.now() / 1000);

  const existing = await c.env.DB.prepare(
    "SELECT user_id FROM team_members WHERE team_id = ? AND user_id = ?",
  )
    .bind(teamId, body.user_id)
    .first();
  if (existing) return c.json({ error: "User is already a member" }, 409);

  await c.env.DB.prepare(
    "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)",
  )
    .bind(teamId, body.user_id, role, now)
    .run();

  return c.json({ message: "Member added", user_id: body.user_id, role });
});

// PATCH /api/oauth/me/team/:teamId/members/:userId/role
app.patch("/me/team/:teamId/members/:userId/role", async (c) => {
  const teamId = c.req.param("teamId");
  const userId = c.req.param("userId");
  const resolved = await resolveTeamToken(c, teamId, "member:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const body = await c.req.json<{ role: string }>();
  const allowed = ["member", "admin"];
  if (!allowed.includes(body.role))
    return c.json({ error: "Invalid role" }, 400);

  await c.env.DB.prepare(
    "UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?",
  )
    .bind(body.role, teamId, userId)
    .run();

  return c.json({ message: "Role updated", user_id: userId, role: body.role });
});

// DELETE /api/oauth/me/team/:teamId/members/:userId
app.delete("/me/team/:teamId/members/:userId", async (c) => {
  const teamId = c.req.param("teamId");
  const userId = c.req.param("userId");
  const resolved = await resolveTeamToken(c, teamId, "member:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  await c.env.DB.prepare(
    "DELETE FROM team_members WHERE team_id = ? AND user_id = ?",
  )
    .bind(teamId, userId)
    .run();

  return c.json({ message: "Member removed" });
});

// GET /api/oauth/me/admin/config — read site config (requires admin:config:read)
app.get("/me/admin/config", async (c) => {
  const resolved = await requireAdminToken(c, "admin:config:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const { getConfig } = await import("../lib/config");
  const config = await getConfig(c.env.DB);

  // Strip sensitive credential fields
  const SENSITIVE_KEYS = [
    "github_client_secret",
    "google_client_secret",
    "microsoft_client_secret",
    "discord_client_secret",
    "captcha_secret_key",
    "smtp_password",
    "email_api_key",
  ];
  const safe = Object.fromEntries(
    Object.entries(config as unknown as Record<string, unknown>).filter(
      ([k]) => !SENSITIVE_KEYS.includes(k),
    ),
  );

  return c.json({ config: safe });
});

// PATCH /api/oauth/me/admin/config — update site config (requires admin:config:write)
app.patch("/me/admin/config", async (c) => {
  const resolved = await requireAdminToken(c, "admin:config:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const body = await c.req.json<Record<string, unknown>>();

  // Disallow updating sensitive credential fields via this endpoint
  const BLOCKED = new Set([
    "github_client_id",
    "github_client_secret",
    "google_client_id",
    "google_client_secret",
    "microsoft_client_id",
    "microsoft_client_secret",
    "discord_client_id",
    "discord_client_secret",
    "captcha_secret_key",
    "smtp_password",
    "email_api_key",
    "initialized",
  ]);

  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!BLOCKED.has(k)) updates[k] = v;
  }

  if (Object.keys(updates).length === 0)
    return c.json({ error: "No updatable fields provided" }, 400);

  const { setConfigValues } = await import("../lib/config");
  await setConfigValues(c.env.DB, updates);

  return c.json({ updated: Object.keys(updates) });
});

// ─── User: Webhooks ──────────────────────────────────────────────────────────

const USER_WEBHOOK_EVENTS_OAUTH = [
  "*",
  "app.created",
  "app.updated",
  "app.deleted",
  "domain.added",
  "domain.verified",
  "domain.deleted",
  "profile.updated",
] as const;

// GET /api/oauth/me/webhooks — list own webhooks (requires webhooks:read)
app.get("/me/webhooks", async (c) => {
  const resolved = await resolveBearerToken(c, "webhooks:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const { results } = await c.env.DB.prepare(
    "SELECT id, name, url, events, is_active, created_at, updated_at FROM webhooks WHERE user_id = ? ORDER BY created_at DESC",
  )
    .bind(resolved.userId)
    .all<Omit<WebhookRow, "secret" | "created_by">>();

  return c.json({ webhooks: results });
});

// POST /api/oauth/me/webhooks — create a webhook (requires webhooks:write)
app.post("/me/webhooks", async (c) => {
  const resolved = await resolveBearerToken(c, "webhooks:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const body = await c.req.json<{
    name: string;
    url: string;
    secret?: string;
    events: string[];
  }>();
  if (!body.name?.trim() || !body.url?.trim())
    return c.json({ error: "name and url are required" }, 400);

  try {
    new URL(body.url);
  } catch {
    return c.json({ error: "Invalid URL" }, 400);
  }

  const events = Array.isArray(body.events)
    ? body.events.filter((e) =>
        (USER_WEBHOOK_EVENTS_OAUTH as readonly string[]).includes(e),
      )
    : [];
  const secret = body.secret?.trim() || randomBase64url(32);
  const now = Math.floor(Date.now() / 1000);
  const id = randomId();

  await c.env.DB.prepare(
    "INSERT INTO webhooks (id, name, url, secret, events, is_active, user_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)",
  )
    .bind(
      id,
      body.name.trim(),
      body.url.trim(),
      secret,
      JSON.stringify(events),
      resolved.userId,
      resolved.userId,
      now,
      now,
    )
    .run();

  return c.json(
    {
      webhook: {
        id,
        name: body.name,
        url: body.url,
        secret,
        events,
        is_active: 1,
        created_at: now,
      },
    },
    201,
  );
});

// PATCH /api/oauth/me/webhooks/:id — update (requires webhooks:write)
app.patch("/me/webhooks/:id", async (c) => {
  const resolved = await resolveBearerToken(c, "webhooks:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const existing = await c.env.DB.prepare(
    "SELECT id FROM webhooks WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), resolved.userId)
    .first();
  if (!existing) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json<{
    name?: string;
    url?: string;
    secret?: string;
    events?: string[];
    is_active?: boolean;
  }>();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    sets.push("name = ?");
    values.push(body.name.trim());
  }
  if (body.url !== undefined) {
    try {
      new URL(body.url);
    } catch {
      return c.json({ error: "Invalid URL" }, 400);
    }
    sets.push("url = ?");
    values.push(body.url.trim());
  }
  if (body.secret !== undefined) {
    sets.push("secret = ?");
    values.push(body.secret);
  }
  if (body.events !== undefined) {
    const filtered = body.events.filter((e) =>
      (USER_WEBHOOK_EVENTS_OAUTH as readonly string[]).includes(e),
    );
    sets.push("events = ?");
    values.push(JSON.stringify(filtered));
  }
  if (body.is_active !== undefined) {
    sets.push("is_active = ?");
    values.push(body.is_active ? 1 : 0);
  }
  if (!sets.length) return c.json({ error: "Nothing to update" }, 400);

  sets.push("updated_at = ?");
  values.push(Math.floor(Date.now() / 1000));
  values.push(c.req.param("id"));
  values.push(resolved.userId);
  await c.env.DB.prepare(
    `UPDATE webhooks SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
  )
    .bind(...values)
    .run();
  return c.json({ message: "Updated" });
});

// DELETE /api/oauth/me/webhooks/:id — delete (requires webhooks:write)
app.delete("/me/webhooks/:id", async (c) => {
  const resolved = await resolveBearerToken(c, "webhooks:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const wh = await c.env.DB.prepare(
    "SELECT id FROM webhooks WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), resolved.userId)
    .first();
  if (!wh) return c.json({ error: "Not found" }, 404);

  await c.env.DB.prepare("DELETE FROM webhooks WHERE id = ?")
    .bind(c.req.param("id"))
    .run();
  return c.json({ message: "Deleted" });
});

// GET /api/oauth/me/webhooks/:id/deliveries (requires webhooks:read)
app.get("/me/webhooks/:id/deliveries", async (c) => {
  const resolved = await resolveBearerToken(c, "webhooks:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const wh = await c.env.DB.prepare(
    "SELECT id FROM webhooks WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), resolved.userId)
    .first();
  if (!wh) return c.json({ error: "Not found" }, 404);

  const { results } = await c.env.DB.prepare(
    "SELECT id, event_type, response_status, success, delivered_at FROM webhook_deliveries WHERE webhook_id = ? ORDER BY delivered_at DESC LIMIT 50",
  )
    .bind(c.req.param("id"))
    .all<
      Pick<
        WebhookDeliveryRow,
        "id" | "event_type" | "response_status" | "success" | "delivered_at"
      >
    >();

  return c.json({ deliveries: results });
});

// ─── Admin: Webhooks ─────────────────────────────────────────────────────────

const ALL_WEBHOOK_EVENTS = [
  "*",
  "admin.config.update",
  "admin.user.update",
  "admin.user.delete",
  "admin.app.update",
  "admin.team.delete",
  "invite.create",
  "invite.revoke",
  "oauth_source.create",
  "oauth_source.update",
  "oauth_source.delete",
  "webhook.create",
  "webhook.update",
  "webhook.delete",
] as const;

// GET /api/oauth/me/admin/webhooks — list webhooks (requires admin:webhooks:read)
app.get("/me/admin/webhooks", async (c) => {
  const resolved = await requireAdminToken(c, "admin:webhooks:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const { results } = await c.env.DB.prepare(
    "SELECT id, name, url, events, is_active, created_at, updated_at FROM webhooks ORDER BY created_at DESC",
  ).all<Omit<WebhookRow, "secret" | "created_by">>();

  return c.json({ webhooks: results });
});

// POST /api/oauth/me/admin/webhooks — create a webhook (requires admin:webhooks:write)
app.post("/me/admin/webhooks", async (c) => {
  const resolved = await requireAdminToken(c, "admin:webhooks:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const body = await c.req.json<{
    name: string;
    url: string;
    secret?: string;
    events: string[];
  }>();

  if (!body.name?.trim() || !body.url?.trim())
    return c.json({ error: "name and url are required" }, 400);

  try {
    new URL(body.url);
  } catch {
    return c.json({ error: "Invalid URL" }, 400);
  }

  const events = Array.isArray(body.events)
    ? body.events.filter((e) =>
        (ALL_WEBHOOK_EVENTS as readonly string[]).includes(e),
      )
    : [];
  const secret = body.secret?.trim() || randomBase64url(32);
  const now = Math.floor(Date.now() / 1000);
  const id = randomId();

  await c.env.DB.prepare(
    "INSERT INTO webhooks (id, name, url, secret, events, is_active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)",
  )
    .bind(
      id,
      body.name.trim(),
      body.url.trim(),
      secret,
      JSON.stringify(events),
      resolved.userId,
      now,
      now,
    )
    .run();

  return c.json(
    {
      webhook: {
        id,
        name: body.name,
        url: body.url,
        secret,
        events,
        is_active: 1,
        created_at: now,
      },
    },
    201,
  );
});

// GET /api/oauth/me/admin/webhooks/:id — get a webhook (requires admin:webhooks:read)
app.get("/me/admin/webhooks/:id", async (c) => {
  const resolved = await requireAdminToken(c, "admin:webhooks:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const wh = await c.env.DB.prepare(
    "SELECT id, name, url, events, is_active, created_at, updated_at FROM webhooks WHERE id = ?",
  )
    .bind(c.req.param("id"))
    .first<Omit<WebhookRow, "secret" | "created_by">>();

  if (!wh) return c.json({ error: "Not found" }, 404);
  return c.json({ webhook: wh });
});

// PATCH /api/oauth/me/admin/webhooks/:id — update a webhook (requires admin:webhooks:write)
app.patch("/me/admin/webhooks/:id", async (c) => {
  const resolved = await requireAdminToken(c, "admin:webhooks:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const existing = await c.env.DB.prepare(
    "SELECT id FROM webhooks WHERE id = ?",
  )
    .bind(c.req.param("id"))
    .first();
  if (!existing) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json<{
    name?: string;
    url?: string;
    secret?: string;
    events?: string[];
    is_active?: boolean;
  }>();

  const sets: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    sets.push("name = ?");
    values.push(body.name.trim());
  }
  if (body.url !== undefined) {
    try {
      new URL(body.url);
    } catch {
      return c.json({ error: "Invalid URL" }, 400);
    }
    sets.push("url = ?");
    values.push(body.url.trim());
  }
  if (body.secret !== undefined) {
    sets.push("secret = ?");
    values.push(body.secret);
  }
  if (body.events !== undefined) {
    const filtered = body.events.filter((e) =>
      (ALL_WEBHOOK_EVENTS as readonly string[]).includes(e),
    );
    sets.push("events = ?");
    values.push(JSON.stringify(filtered));
  }
  if (body.is_active !== undefined) {
    sets.push("is_active = ?");
    values.push(body.is_active ? 1 : 0);
  }

  if (!sets.length) return c.json({ error: "Nothing to update" }, 400);

  sets.push("updated_at = ?");
  values.push(Math.floor(Date.now() / 1000));
  values.push(c.req.param("id"));

  await c.env.DB.prepare(`UPDATE webhooks SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  return c.json({ message: "Updated" });
});

// DELETE /api/oauth/me/admin/webhooks/:id — delete a webhook (requires admin:webhooks:delete)
app.delete("/me/admin/webhooks/:id", async (c) => {
  const resolved = await requireAdminToken(c, "admin:webhooks:delete");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const wh = await c.env.DB.prepare("SELECT id FROM webhooks WHERE id = ?")
    .bind(c.req.param("id"))
    .first();
  if (!wh) return c.json({ error: "Not found" }, 404);

  await c.env.DB.prepare("DELETE FROM webhooks WHERE id = ?")
    .bind(c.req.param("id"))
    .run();

  return c.json({ message: "Deleted" });
});

// POST /api/oauth/me/admin/webhooks/:id/test — send a test ping (requires admin:webhooks:write)
app.post("/me/admin/webhooks/:id/test", async (c) => {
  const resolved = await requireAdminToken(c, "admin:webhooks:write");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const wh = await c.env.DB.prepare(
    "SELECT id, url, secret FROM webhooks WHERE id = ?",
  )
    .bind(c.req.param("id"))
    .first<Pick<WebhookRow, "id" | "url" | "secret">>();
  if (!wh) return c.json({ error: "Not found" }, 404);

  const now = Math.floor(Date.now() / 1000);
  const deliveryId = randomId();
  const payload = JSON.stringify({
    event: "webhook.test",
    timestamp: now,
    data: { message: "Test delivery from Prism" },
  });

  const sig = await hmacSign(wh.secret, payload);
  let status: number | null = null;
  let response: string | null;
  let success = false;

  try {
    const res = await fetch(wh.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Prism-Event": "webhook.test",
        "X-Prism-Signature": `sha256=${sig}`,
        "X-Prism-Delivery": deliveryId,
      },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    response = (await res.text()).slice(0, 512);
    success = status >= 200 && status < 300;
  } catch (err) {
    response = String(err).slice(0, 512);
  }

  await c.env.DB.prepare(
    "INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload, response_status, response_body, success, delivered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      deliveryId,
      wh.id,
      "webhook.test",
      payload,
      status,
      response,
      success ? 1 : 0,
      now,
    )
    .run();

  return c.json({ success, status, response });
});

// GET /api/oauth/me/admin/webhooks/:id/deliveries — delivery history (requires admin:webhooks:read)
app.get("/me/admin/webhooks/:id/deliveries", async (c) => {
  const resolved = await requireAdminToken(c, "admin:webhooks:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const wh = await c.env.DB.prepare("SELECT id FROM webhooks WHERE id = ?")
    .bind(c.req.param("id"))
    .first();
  if (!wh) return c.json({ error: "Not found" }, 404);

  const { results } = await c.env.DB.prepare(
    "SELECT id, event_type, response_status, success, delivered_at FROM webhook_deliveries WHERE webhook_id = ? ORDER BY delivered_at DESC LIMIT 50",
  )
    .bind(c.req.param("id"))
    .all<
      Pick<
        WebhookDeliveryRow,
        "id" | "event_type" | "response_status" | "success" | "delivered_at"
      >
    >();

  return c.json({ deliveries: results });
});

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
    claims.picture = proxyImageUrl(appUrl, user.avatar_url);
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
    // Flat claims always emitted with teams:read — required for Cloudflare Access policies
    for (const r of rows.results) {
      claims[`in_team_${r.id}`] = true;
      claims[`role_in_team_${r.id}`] = r.role;
    }
    // Structured array only when opted into via oidc_fields
    if (wants("teams")) {
      claims.teams = rows.results.map((r) => ({
        id: r.id,
        name: r.name,
        role: r.role,
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
    for (const r of boundRows.results) {
      claims[`in_team_${r.id}`] = true;
      claims[`role_in_team_${r.id}`] = r.role;
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
        "SELECT id, domain, verified FROM domains WHERE user_id = ? ORDER BY created_at DESC",
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
  console.log("[OIDC] buildClaims", {
    sub: user.id,
    client_id: clientId,
    scopes,
    oidc_fields: [...oidcFields],
    claim_keys: Object.keys(claims),
  });
  return claims;
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
): Promise<string> {
  const { signIdTokenRS256 } = await import("../lib/jwt");
  const claims = await buildClaims(user, clientId, scopes, db, issuer);
  claims.iss = issuer;
  claims.aud = clientId;
  if (nonce) claims.nonce = nonce;
  console.log("[OIDC] issuing ID token", {
    sub: user.id,
    client_id: clientId,
    iss: issuer,
    scopes,
    claim_keys: Object.keys(claims),
    has_nonce: !!nonce,
  });
  return signIdTokenRS256(claims, privateKey, kid, ttl);
}

function proxyUserAvatar<T extends Record<string, unknown>>(
  baseUrl: string,
  row: T,
): T & { unproxied_avatar_url: unknown } {
  return {
    ...row,
    avatar_url: proxyImageUrl(baseUrl, row.avatar_url as string | null),
    unproxied_avatar_url: row.avatar_url,
  };
}

export default app;
