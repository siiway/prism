// OAuth application management (CRUD for user-owned apps)

import { Hono, type Context, type Next } from "hono";
import { randomId, randomBase64url } from "../lib/crypto";
import { encryptSecret, timingSafeSecretEqual } from "../lib/secretCrypto";
import { requireAuth, tryPatAuth } from "../middleware/auth";
import { getConfigValue } from "../lib/config";
import { computeIsVerified, computeVerified } from "../lib/domainVerify";
import { validateImageUrl } from "../lib/imageValidation";
import { proxyImageUrl } from "../lib/proxyImage";
import { parseAppScope } from "../lib/scopes";
import { APP_EVENT_TYPES } from "../lib/app-events";
import { deliverUserWebhooks } from "../lib/webhooks";
import {
  deliverUserEmailNotifications,
  notificationActorMetaFromHeaders,
} from "../lib/notifications";
import type {
  OAuthAppRow,
  TeamMemberRow,
  AppScopeDefinitionRow,
  AppScopeAccessRuleRow,
  Variables,
} from "../types";

// Mirror of the platform scope set in oauth.ts — used to validate app:* inner scopes
const VALID_PLATFORM_SCOPES = new Set([
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
  "site:user:read",
  "site:user:write",
  "site:user:delete",
  "site:team:read",
  "site:team:write",
  "site:team:delete",
  "site:config:read",
  "site:config:write",
  "site:token:revoke",
  "team:read",
  "team:write",
  "team:delete",
  "team:member:read",
  "team:member:write",
  "team:member:profile:read",
  "offline_access",
]);

function isAllowedScope(s: string): boolean {
  if (VALID_PLATFORM_SCOPES.has(s)) return true;
  const parsed = parseAppScope(s);
  // inner scope: either a platform scope or any non-empty identifier (app-defined)
  return parsed !== null && parsed.innerScope.length > 0;
}

/** Check access rules for target app before adding an app:* scope to allowed_scopes.
 *  Returns null if allowed, or an error string if denied. */
async function checkOwnerScopeAccess(
  db: D1Database,
  targetClientId: string,
  requestingUserId: string,
): Promise<string | null> {
  const targetApp = await db
    .prepare("SELECT id FROM oauth_apps WHERE client_id = ? AND is_active = 1")
    .bind(targetClientId)
    .first<{ id: string }>();
  if (!targetApp)
    return `App with client_id ${targetClientId} not found or inactive`;

  const rules = await db
    .prepare(
      "SELECT rule_type, target_id FROM app_scope_access_rules WHERE app_id = ? AND rule_type IN ('owner_allow','owner_deny')",
    )
    .bind(targetApp.id)
    .all<{ rule_type: string; target_id: string }>();

  const allowList = rules.results
    .filter((r) => r.rule_type === "owner_allow")
    .map((r) => r.target_id);
  const denyList = rules.results
    .filter((r) => r.rule_type === "owner_deny")
    .map((r) => r.target_id);

  if (denyList.includes(requestingUserId))
    return "You are not permitted to use this app's scopes";
  if (allowList.length > 0 && !allowList.includes(requestingUserId))
    return "You are not on the allow-list for this app's scopes";

  return null;
}

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

// Opt-in: let an app authenticate as itself (HTTP Basic with client_id:client_secret)
// against its own scope-definitions endpoints. Must run BEFORE requireAuth so that
// requireAuth can see the populated appSelfAuth context and skip user-token checks.
//
// Security gates enforced below: app must be active, NOT public (public apps have
// no meaningful secret), have `allow_self_manage_exported_permissions=1`, and present a
// secret that matches via a length-independent constant-time compare.
app.use("/:id/scope-definitions", tryAppSelfAuthForScopeDefs);
app.use("/:id/scope-definitions/*", tryAppSelfAuthForScopeDefs);

// Personal Access Tokens with apps:read / apps:write scopes can manage apps too,
// so the API surface is reachable without a session cookie.
app.use("*", tryPatAuth({ read: "apps:read", write: "apps:write" }));

app.use("*", requireAuth);

// ─── Auth helpers ─────────────────────────────────────────────────────────────

const ROLE_RANK: Record<string, number> = {
  owner: 4,
  "co-owner": 3,
  admin: 2,
  member: 1,
};

async function getTeamMember(
  db: D1Database,
  teamId: string,
  userId: string,
): Promise<TeamMemberRow | null> {
  return db
    .prepare("SELECT * FROM team_members WHERE team_id = ? AND user_id = ?")
    .bind(teamId, userId)
    .first<TeamMemberRow>();
}

/** Try to authenticate the request as the app itself via HTTP Basic.
 *
 * Only succeeds when ALL of these hold:
 *   - Authorization: Basic <base64(client_id:client_secret)> is present and parseable
 *   - The app row exists, is_active=1, is_public=0 (public apps have no real secret)
 *   - allow_self_manage_exported_permissions=1 (owner has opted in)
 *   - A non-empty client_secret that matches in constant time
 *   - The authenticated app's id matches the URL ":id" parameter
 *
 * On success, sets c.get("appSelfAuth") and lets the request through.
 * On any failure, leaves context untouched so requireAuth can fall back to
 * standard user-session auth (Bearer / X-Session-Token).
 */
async function tryAppSelfAuthForScopeDefs(
  c: Context<AppEnv>,
  next: Next,
): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Basic ")) return await next();

  let decoded: string;
  try {
    decoded = atob(authHeader.slice(6));
  } catch {
    return await next();
  }
  const sep = decoded.indexOf(":");
  if (sep < 1) return await next();
  const clientId = decoded.slice(0, sep);
  const clientSecret = decoded.slice(sep + 1);
  if (!clientSecret) return await next();

  const row = await c.env.DB.prepare(
    "SELECT id, client_id, client_secret, is_active, is_public, allow_self_manage_exported_permissions FROM oauth_apps WHERE client_id = ?",
  )
    .bind(clientId)
    .first<{
      id: string;
      client_id: string;
      client_secret: string;
      is_active: number;
      is_public: number;
      allow_self_manage_exported_permissions: number;
    }>();

  if (
    !row ||
    row.is_active !== 1 ||
    row.is_public === 1 ||
    row.allow_self_manage_exported_permissions !== 1 ||
    !row.client_secret ||
    !(await timingSafeSecretEqual(c.env, row.client_secret, clientSecret))
  ) {
    return await next();
  }

  // Scope the authentication to the requested app: presenting app A's
  // credentials must not grant access to app B's scope-definitions.
  // The URL :id may be either the database id or the client_id — apps
  // authenticating as themselves naturally know themselves by client_id.
  const urlId = c.req.param("id");
  if (urlId !== row.id && urlId !== row.client_id) return await next();

  c.set("appSelfAuth", { appId: row.id, clientId: row.client_id });
  return await next();
}

/** Returns true if the user may access the app (read or write). */
async function canAccess(
  db: D1Database,
  row: OAuthAppRow,
  userId: string,
  siteRole: string,
  write: boolean,
): Promise<boolean> {
  if (siteRole === "admin") return true;
  if (row.team_id) {
    const m = await getTeamMember(db, row.team_id, userId);
    if (!m) return false;
    return write ? (ROLE_RANK[m.role] ?? 0) >= ROLE_RANK["admin"] : true;
  }
  return row.owner_id === userId;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// List user's personal apps (team apps are listed via /api/teams/:id/apps)
app.get("/", async (c) => {
  const user = c.get("user");
  const [rows, domainRows] = await Promise.all([
    c.env.DB.prepare(
      "SELECT * FROM oauth_apps WHERE owner_id = ? AND team_id IS NULL ORDER BY created_at DESC",
    )
      .bind(user.id)
      .all<OAuthAppRow>(),
    c.env.DB.prepare(
      "SELECT domain FROM domains WHERE user_id = ? AND verified = 1",
    )
      .bind(user.id)
      .all<{ domain: string }>(),
  ]);
  const verifiedDomains = new Set(domainRows.results.map((r) => r.domain));
  return c.json({
    apps: rows.results.map((row) =>
      safeApp(
        c.env.APP_URL,
        row,
        computeVerified(verifiedDomains, row.website_url, row.redirect_uris),
      ),
    ),
  });
});

// Get single app (personal owner, team member, or site admin)
app.get("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM oauth_apps WHERE id = ?")
    .bind(id)
    .first<OAuthAppRow>();

  if (!row) return c.json({ error: "Not found" }, 404);
  if (!(await canAccess(c.env.DB, row, user.id, user.role, false)))
    return c.json({ error: "Forbidden" }, 403);

  const isVerified = await computeIsVerified(
    c.env.DB,
    row.owner_id,
    row.website_url,
    row.redirect_uris,
    row.team_id,
  );
  return c.json({ app: fullApp(c.env.APP_URL, row, isVerified) });
});

// Create personal app
app.post("/", async (c) => {
  const user = c.get("user");

  if (user.role !== "admin") {
    const disabled = await getConfigValue(c.env.DB, "disable_user_create_app");
    if (disabled) return c.json({ error: "App creation is disabled" }, 403);
  }

  const body = await c.req.json<{
    name: string;
    description?: string;
    website_url?: string;
    redirect_uris: string[];
    allowed_scopes?: string[];
    optional_scopes?: string[];
    oidc_fields?: string[];
    is_public?: boolean;
  }>();

  if (!body.name) return c.json({ error: "name is required" }, 400);
  if (!body.redirect_uris?.length)
    return c.json({ error: "At least one redirect_uri required" }, 400);

  for (const uri of body.redirect_uris) {
    try {
      new URL(uri);
    } catch {
      return c.json({ error: `Invalid redirect_uri: ${uri}` }, 400);
    }
  }

  const allowedScopes = (
    body.allowed_scopes ?? ["openid", "profile", "email"]
  ).filter(isAllowedScope);
  const optionalScopes = (body.optional_scopes ?? []).filter((s) =>
    allowedScopes.includes(s),
  );

  const id = randomId();
  const clientId = `prism_${randomBase64url(16)}`;
  const clientSecret = randomBase64url(32);
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    `INSERT INTO oauth_apps
       (id, owner_id, name, description, website_url, client_id, client_secret,
        redirect_uris, allowed_scopes, optional_scopes, oidc_fields, is_public, is_active, is_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
  )
    .bind(
      id,
      user.id,
      body.name,
      body.description ?? "",
      body.website_url ?? null,
      clientId,
      // Encrypt at rest. The plaintext value is returned in the response
      // body of this endpoint so the user can save it; we never need to
      // hand it back from D1 except through timingSafeSecretEqual.
      await encryptSecret(c.env, clientSecret),
      JSON.stringify(body.redirect_uris),
      JSON.stringify(allowedScopes),
      JSON.stringify(optionalScopes),
      JSON.stringify(body.oidc_fields ?? []),
      body.is_public ? 1 : 0,
      now,
      now,
    )
    .run();

  const row = await c.env.DB.prepare("SELECT * FROM oauth_apps WHERE id = ?")
    .bind(id)
    .first<OAuthAppRow>();

  const isVerified = await computeIsVerified(
    c.env.DB,
    user.id,
    body.website_url ?? null,
    JSON.stringify(body.redirect_uris),
  );
  c.executionCtx.waitUntil(
    deliverUserWebhooks(c.env.DB, user.id, "app.created", {
      app_id: id,
      name: body.name,
    }).catch(() => {}),
  );
  c.executionCtx.waitUntil(
    deliverUserEmailNotifications(
      c.env,
      user.id,
      "app.created",
      {
        app_id: id,
        name: body.name,
        ...notificationActorMetaFromHeaders(c.req.raw.headers),
      },
      c.env.APP_URL,
    ).catch(() => {}),
  );
  return c.json({ app: fullApp(c.env.APP_URL, row!, isVerified) }, 201);
});

// Update app
app.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM oauth_apps WHERE id = ?")
    .bind(id)
    .first<OAuthAppRow>();

  if (!row) return c.json({ error: "Not found" }, 404);
  if (!(await canAccess(c.env.DB, row, user.id, user.role, true)))
    return c.json({ error: "Forbidden" }, 403);

  const body = await c.req.json<{
    name?: string;
    description?: string;
    icon_url?: string;
    website_url?: string;
    redirect_uris?: string[];
    allowed_scopes?: string[];
    optional_scopes?: string[];
    oidc_fields?: string[];
    is_public?: boolean;
    use_jwt_tokens?: boolean;
    allow_self_manage_exported_permissions?: boolean;
  }>();

  if (body.icon_url) {
    const imgErr = await validateImageUrl(body.icon_url);
    if (imgErr) return c.json({ error: `icon_url: ${imgErr}` }, 400);
  }

  // Check access rules for any newly-added app:* scopes
  if (body.allowed_scopes) {
    const existingScopes = JSON.parse(row.allowed_scopes) as string[];
    const newAppScopes = body.allowed_scopes.filter(
      (s) => s.startsWith("app:") && !existingScopes.includes(s),
    );
    const checkedClientIds = new Set<string>();
    for (const s of newAppScopes) {
      const parsed = parseAppScope(s);
      if (!parsed || checkedClientIds.has(parsed.clientId)) continue;
      checkedClientIds.add(parsed.clientId);
      const err = await checkOwnerScopeAccess(
        c.env.DB,
        parsed.clientId,
        user.id,
      );
      if (err) return c.json({ error: err }, 403);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const newAllowedScopes = body.allowed_scopes
    ? body.allowed_scopes.filter(isAllowedScope)
    : (JSON.parse(row.allowed_scopes) as string[]);
  const updated = {
    name: body.name ?? row.name,
    description: body.description ?? row.description,
    icon_url: body.icon_url !== undefined ? body.icon_url : row.icon_url,
    website_url:
      body.website_url !== undefined ? body.website_url : row.website_url,
    redirect_uris: body.redirect_uris
      ? JSON.stringify(body.redirect_uris)
      : row.redirect_uris,
    allowed_scopes: JSON.stringify(newAllowedScopes),
    optional_scopes:
      body.optional_scopes !== undefined
        ? JSON.stringify(
            body.optional_scopes.filter((s) => newAllowedScopes.includes(s)),
          )
        : (row.optional_scopes ?? "[]"),
    oidc_fields: body.oidc_fields
      ? JSON.stringify(body.oidc_fields)
      : row.oidc_fields,
    is_public:
      body.is_public !== undefined ? (body.is_public ? 1 : 0) : row.is_public,
    use_jwt_tokens:
      body.use_jwt_tokens !== undefined
        ? body.use_jwt_tokens
          ? 1
          : 0
        : row.use_jwt_tokens,
    allow_self_manage_exported_permissions:
      body.allow_self_manage_exported_permissions !== undefined
        ? body.allow_self_manage_exported_permissions
          ? 1
          : 0
        : row.allow_self_manage_exported_permissions,
  };

  await c.env.DB.prepare(
    `UPDATE oauth_apps SET name=?, description=?, icon_url=?, website_url=?, redirect_uris=?, allowed_scopes=?, optional_scopes=?, oidc_fields=?, is_public=?, use_jwt_tokens=?, allow_self_manage_exported_permissions=?, updated_at=? WHERE id=?`,
  )
    .bind(
      updated.name,
      updated.description,
      updated.icon_url,
      updated.website_url,
      updated.redirect_uris,
      updated.allowed_scopes,
      updated.optional_scopes,
      updated.oidc_fields,
      updated.is_public,
      updated.use_jwt_tokens,
      updated.allow_self_manage_exported_permissions,
      now,
      id,
    )
    .run();

  const updatedRow = await c.env.DB.prepare(
    "SELECT * FROM oauth_apps WHERE id = ?",
  )
    .bind(id)
    .first<OAuthAppRow>();

  const isVerified = await computeIsVerified(
    c.env.DB,
    row.owner_id,
    updatedRow!.website_url,
    updatedRow!.redirect_uris,
    row.team_id,
  );
  c.executionCtx.waitUntil(
    deliverUserWebhooks(c.env.DB, user.id, "app.updated", { app_id: id }).catch(
      () => {},
    ),
  );
  c.executionCtx.waitUntil(
    deliverUserEmailNotifications(
      c.env,
      user.id,
      "app.updated",
      {
        app_id: id,
        name: updated.name,
        ...notificationActorMetaFromHeaders(c.req.raw.headers),
      },
      c.env.APP_URL,
    ).catch(() => {}),
  );
  return c.json({ app: fullApp(c.env.APP_URL, updatedRow!, isVerified) });
});

// Rotate client secret
app.post("/:id/rotate-secret", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM oauth_apps WHERE id = ?")
    .bind(id)
    .first<OAuthAppRow>();

  if (!row) return c.json({ error: "Not found" }, 404);
  if (!(await canAccess(c.env.DB, row, user.id, user.role, true)))
    return c.json({ error: "Forbidden" }, 403);

  const newSecret = randomBase64url(32);
  await c.env.DB.prepare(
    "UPDATE oauth_apps SET client_secret = ?, updated_at = ? WHERE id = ?",
  )
    .bind(
      await encryptSecret(c.env, newSecret),
      Math.floor(Date.now() / 1000),
      id,
    )
    .run();

  return c.json({ client_secret: newSecret });
});

// Delete app
app.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM oauth_apps WHERE id = ?")
    .bind(id)
    .first<OAuthAppRow>();

  if (!row) return c.json({ error: "Not found" }, 404);
  if (!(await canAccess(c.env.DB, row, user.id, user.role, true)))
    return c.json({ error: "Forbidden" }, 403);

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM oauth_tokens WHERE client_id = ?").bind(
      row.client_id,
    ),
    c.env.DB.prepare("DELETE FROM oauth_codes WHERE client_id = ?").bind(
      row.client_id,
    ),
    c.env.DB.prepare("DELETE FROM oauth_2fa_codes WHERE client_id = ?").bind(
      row.client_id,
    ),
    c.env.DB.prepare(
      "DELETE FROM oauth_2fa_challenges WHERE client_id = ?",
    ).bind(row.client_id),
    c.env.DB.prepare("DELETE FROM oauth_consents WHERE client_id = ?").bind(
      row.client_id,
    ),
    c.env.DB.prepare("DELETE FROM oauth_apps WHERE id = ?").bind(id),
  ]);

  c.executionCtx.waitUntil(
    deliverUserWebhooks(c.env.DB, user.id, "app.deleted", { app_id: id }).catch(
      () => {},
    ),
  );
  c.executionCtx.waitUntil(
    deliverUserEmailNotifications(
      c.env,
      user.id,
      "app.deleted",
      {
        app_id: id,
        name: row.name,
        ...notificationActorMetaFromHeaders(c.req.raw.headers),
      },
      c.env.APP_URL,
    ).catch(() => {}),
  );
  return c.json({ message: "App deleted" });
});

// ─── App notification channels ───────────────────────────────────────────────
//
// Authentication for SSE/WS endpoints: HTTP Basic — client_id:client_secret.

type AppWebhookRow = {
  id: string;
  app_id: string;
  url: string;
  secret: string;
  events: string;
  is_active: number;
  created_at: number;
  updated_at: number;
};

/** Verify Basic auth for app client credentials. Returns the app row or null.
 *
 *  Two security properties this enforces beyond a naive string compare:
 *   1. Decrypts the at-rest stored secret via timingSafeSecretEqual, so apps
 *      keep authenticating after the secrets-store migration encrypts the
 *      column.
 *   2. Constant-time comparison to defeat timing side-channels on the secret.
 */
async function verifyClientAuth(
  env: Env,
  authHeader: string | undefined,
): Promise<{
  id: string;
  client_id: string;
  is_active: number;
} | null> {
  if (!authHeader?.startsWith("Basic ")) return null;
  let decoded: string;
  try {
    decoded = atob(authHeader.slice(6));
  } catch {
    return null;
  }
  const sep = decoded.indexOf(":");
  if (sep < 1) return null;
  const clientId = decoded.slice(0, sep);
  const clientSecret = decoded.slice(sep + 1);
  if (!clientSecret) return null;
  const row = await env.DB.prepare(
    "SELECT id, client_id, client_secret, is_active FROM oauth_apps WHERE client_id = ?",
  )
    .bind(clientId)
    .first<{
      id: string;
      client_id: string;
      client_secret: string;
      is_active: number;
    }>();
  if (!row || row.is_active !== 1) return null;
  if (!(await timingSafeSecretEqual(env, row.client_secret, clientSecret)))
    return null;
  return { id: row.id, client_id: row.client_id, is_active: row.is_active };
}

// GET /:id/webhooks — list app webhooks (app owner / team admin / site admin)
app.get("/:id/webhooks", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM oauth_apps WHERE id = ?")
    .bind(id)
    .first<OAuthAppRow>();
  if (!row) return c.json({ error: "Not found" }, 404);
  if (!(await canAccess(c.env.DB, row, user.id, user.role, false)))
    return c.json({ error: "Forbidden" }, 403);

  const { results } = await c.env.DB.prepare(
    "SELECT id, url, events, is_active, created_at, updated_at FROM app_webhooks WHERE app_id = ? ORDER BY created_at DESC",
  )
    .bind(id)
    .all<AppWebhookRow>();

  return c.json({
    webhooks: results.map((wh) => ({
      ...wh,
      events: JSON.parse(wh.events) as string[],
      is_active: wh.is_active === 1,
    })),
  });
});

// POST /:id/webhooks — create app webhook
app.post("/:id/webhooks", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM oauth_apps WHERE id = ?")
    .bind(id)
    .first<OAuthAppRow>();
  if (!row) return c.json({ error: "Not found" }, 404);
  if (!(await canAccess(c.env.DB, row, user.id, user.role, true)))
    return c.json({ error: "Forbidden" }, 403);

  const body = await c.req.json<{
    url: string;
    events?: string[];
    secret?: string;
  }>();

  if (!body.url) return c.json({ error: "url is required" }, 400);
  try {
    new URL(body.url);
  } catch {
    return c.json({ error: "Invalid url" }, 400);
  }

  const events = (body.events ?? ["*"]).filter(
    (e) => e === "*" || APP_EVENT_TYPES.has(e),
  );
  const secret = body.secret?.trim() || randomBase64url(32);
  const whId = randomId();
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    `INSERT INTO app_webhooks (id, app_id, url, secret, events, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
  )
    .bind(whId, id, body.url, secret, JSON.stringify(events), now, now)
    .run();

  return c.json(
    {
      id: whId,
      app_id: id,
      url: body.url,
      secret,
      events,
      is_active: true,
      created_at: now,
      updated_at: now,
    },
    201,
  );
});

// PATCH /:id/webhooks/:wid — update app webhook
app.patch("/:id/webhooks/:wid", async (c) => {
  const user = c.get("user");
  const { id, wid } = c.req.param();
  const row = await c.env.DB.prepare("SELECT * FROM oauth_apps WHERE id = ?")
    .bind(id)
    .first<OAuthAppRow>();
  if (!row) return c.json({ error: "Not found" }, 404);
  if (!(await canAccess(c.env.DB, row, user.id, user.role, true)))
    return c.json({ error: "Forbidden" }, 403);

  const wh = await c.env.DB.prepare(
    "SELECT * FROM app_webhooks WHERE id = ? AND app_id = ?",
  )
    .bind(wid, id)
    .first<AppWebhookRow>();
  if (!wh) return c.json({ error: "Webhook not found" }, 404);

  const body = await c.req.json<{
    url?: string;
    events?: string[];
    secret?: string;
    is_active?: boolean;
  }>();

  const now = Math.floor(Date.now() / 1000);
  const updated = {
    url: body.url ?? wh.url,
    events: body.events
      ? JSON.stringify(
          body.events.filter((e) => e === "*" || APP_EVENT_TYPES.has(e)),
        )
      : wh.events,
    secret: body.secret?.trim() || wh.secret,
    is_active:
      body.is_active !== undefined ? (body.is_active ? 1 : 0) : wh.is_active,
  };

  await c.env.DB.prepare(
    "UPDATE app_webhooks SET url=?, events=?, secret=?, is_active=?, updated_at=? WHERE id=?",
  )
    .bind(
      updated.url,
      updated.events,
      updated.secret,
      updated.is_active,
      now,
      wid,
    )
    .run();

  return c.json({
    id: wid,
    app_id: id,
    url: updated.url,
    events: JSON.parse(updated.events) as string[],
    is_active: updated.is_active === 1,
    created_at: wh.created_at,
    updated_at: now,
  });
});

// DELETE /:id/webhooks/:wid — delete app webhook
app.delete("/:id/webhooks/:wid", async (c) => {
  const user = c.get("user");
  const { id, wid } = c.req.param();
  const row = await c.env.DB.prepare("SELECT * FROM oauth_apps WHERE id = ?")
    .bind(id)
    .first<OAuthAppRow>();
  if (!row) return c.json({ error: "Not found" }, 404);
  if (!(await canAccess(c.env.DB, row, user.id, user.role, true)))
    return c.json({ error: "Forbidden" }, 403);

  const wh = await c.env.DB.prepare(
    "SELECT id FROM app_webhooks WHERE id = ? AND app_id = ?",
  )
    .bind(wid, id)
    .first<{ id: string }>();
  if (!wh) return c.json({ error: "Webhook not found" }, 404);

  await c.env.DB.prepare("DELETE FROM app_webhooks WHERE id = ?")
    .bind(wid)
    .run();
  return c.json({ message: "Deleted" });
});

// POST /:id/webhooks/:wid/test — send a test delivery
app.post("/:id/webhooks/:wid/test", async (c) => {
  const user = c.get("user");
  const { id, wid } = c.req.param();
  const row = await c.env.DB.prepare("SELECT * FROM oauth_apps WHERE id = ?")
    .bind(id)
    .first<OAuthAppRow>();
  if (!row) return c.json({ error: "Not found" }, 404);
  if (!(await canAccess(c.env.DB, row, user.id, user.role, true)))
    return c.json({ error: "Forbidden" }, 403);

  const wh = await c.env.DB.prepare(
    "SELECT * FROM app_webhooks WHERE id = ? AND app_id = ?",
  )
    .bind(wid, id)
    .first<AppWebhookRow>();
  if (!wh) return c.json({ error: "Webhook not found" }, 404);

  const { deliverOnce: deliver } = await import("../lib/webhooks");
  const now = Math.floor(Date.now() / 1000);
  const deliveryId = randomId();
  const payload = JSON.stringify({ event: "ping", timestamp: now, data: {} });
  const result = await deliver(wh.url, wh.secret, deliveryId, "ping", payload);

  await c.env.DB.prepare(
    `INSERT INTO app_webhook_deliveries
       (id, webhook_id, event_type, payload, response_status, response_body, success, delivered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      deliveryId,
      wid,
      "ping",
      payload,
      result.status,
      result.response,
      result.success ? 1 : 0,
      now,
    )
    .run();

  return c.json({ success: result.success, status: result.status });
});

// GET /:id/webhooks/:wid/deliveries — delivery history
app.get("/:id/webhooks/:wid/deliveries", async (c) => {
  const user = c.get("user");
  const { id, wid } = c.req.param();
  const row = await c.env.DB.prepare("SELECT * FROM oauth_apps WHERE id = ?")
    .bind(id)
    .first<OAuthAppRow>();
  if (!row) return c.json({ error: "Not found" }, 404);
  if (!(await canAccess(c.env.DB, row, user.id, user.role, false)))
    return c.json({ error: "Forbidden" }, 403);

  const { results } = await c.env.DB.prepare(
    `SELECT id, event_type, response_status, success, delivered_at
     FROM app_webhook_deliveries WHERE webhook_id = ?
     ORDER BY delivered_at DESC LIMIT 50`,
  )
    .bind(wid)
    .all<{
      id: string;
      event_type: string;
      response_status: number | null;
      success: number;
      delivered_at: number;
    }>();

  return c.json({
    deliveries: results.map((d) => ({ ...d, success: d.success === 1 })),
  });
});

// GET /:id/events/sse — Server-Sent Events stream for app events
// Auth: HTTP Basic  (client_id:client_secret)
app.get("/:id/events/sse", async (c) => {
  const appRow = await verifyClientAuth(c.env, c.req.header("Authorization"));
  if (!appRow) return c.json({ error: "Unauthorized" }, 401);

  const appId = c.req.param("id");
  if (appRow.id !== appId) return c.json({ error: "Forbidden" }, 403);

  // Resume from Last-Event-ID (integer rowid cursor; 0 = tail from now)
  const rawCursor = c.req.header("Last-Event-ID");
  let cursor: number;
  if (rawCursor && /^\d+$/.test(rawCursor)) {
    cursor = parseInt(rawCursor, 10);
  } else {
    // Default: start from the most recent event already in the queue
    const latest = await c.env.DB.prepare(
      "SELECT id FROM app_event_queue WHERE app_id = ? ORDER BY id DESC LIMIT 1",
    )
      .bind(appId)
      .first<{ id: number }>();
    cursor = latest?.id ?? 0;
  }

  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          /* stream closed */
        }
      };

      // Send a connected comment with the current cursor so clients can resume
      send(`: connected\nid: ${cursor}\n\n`);

      // Poll loop — Workers support long-lived responses on paid plans
      while (true) {
        await new Promise((r) => setTimeout(r, 2_000));

        try {
          const { results } = await c.env.DB.prepare(
            `SELECT id, event_type, payload
             FROM app_event_queue
             WHERE app_id = ? AND id > ?
             ORDER BY id ASC LIMIT 50`,
          )
            .bind(appId, cursor)
            .all<{ id: number; event_type: string; payload: string }>();

          for (const row of results) {
            send(
              `id: ${row.id}\nevent: ${row.event_type}\ndata: ${row.payload}\n\n`,
            );
            cursor = row.id;
          }

          // Heartbeat keeps the connection alive and lets clients detect drops
          send(": heartbeat\n\n");
        } catch {
          controller.close();
          return;
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
});

// GET /:id/events/ws — WebSocket stream for app events
// Auth: ?client_secret=<secret>  (client_id inferred from :id lookup by client_id param)
// Or: Authorization: Basic client_id:client_secret
app.get("/:id/events/ws", async (c) => {
  const upgradeHeader = c.req.header("Upgrade");
  if (upgradeHeader?.toLowerCase() !== "websocket") {
    return c.json({ error: "Expected WebSocket upgrade" }, 426);
  }

  // Support Basic auth OR query-string for environments that can't set headers
  let authHeader = c.req.header("Authorization");
  if (!authHeader) {
    const qs = new URL(c.req.url).searchParams;
    const qsClientId = qs.get("client_id");
    const qsSecret = qs.get("client_secret");
    if (qsClientId && qsSecret) {
      authHeader = `Basic ${btoa(`${qsClientId}:${qsSecret}`)}`;
    }
  }

  const appRow = await verifyClientAuth(c.env, authHeader);
  if (!appRow) return c.json({ error: "Unauthorized" }, 401);

  const appId = c.req.param("id");
  if (appRow.id !== appId) return c.json({ error: "Forbidden" }, 403);

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair) as [
    WebSocket,
    WebSocket & { accept(): void },
  ];
  server.accept();

  let cursor: number;
  const latest = await c.env.DB.prepare(
    "SELECT id FROM app_event_queue WHERE app_id = ? ORDER BY id DESC LIMIT 1",
  )
    .bind(appId)
    .first<{ id: number }>();
  cursor = latest?.id ?? 0;

  // Send a connect message
  server.send(JSON.stringify({ type: "connected", cursor }));

  // Poll for new events and push them over the socket
  const poll = async () => {
    try {
      const { results } = await c.env.DB.prepare(
        `SELECT id, event_type, payload
         FROM app_event_queue
         WHERE app_id = ? AND id > ?
         ORDER BY id ASC LIMIT 50`,
      )
        .bind(appId, cursor)
        .all<{ id: number; event_type: string; payload: string }>();

      for (const row of results) {
        server.send(
          JSON.stringify({
            type: "event",
            id: row.id,
            event: row.event_type,
            data: JSON.parse(row.payload),
          }),
        );
        cursor = row.id;
      }
    } catch {
      server.close(1011, "Internal error");
      return;
    }
    setTimeout(poll, 2_000);
  };

  server.addEventListener("message", (msg) => {
    // Clients may send { type: "resume", cursor: N } to catch up
    try {
      const parsed = JSON.parse(
        typeof msg.data === "string"
          ? msg.data
          : new TextDecoder().decode(msg.data as ArrayBuffer),
      ) as { type?: string; cursor?: number };
      if (parsed.type === "resume" && typeof parsed.cursor === "number") {
        cursor = parsed.cursor;
      }
    } catch {
      /* ignore malformed */
    }
  });

  server.addEventListener("close", () => {
    /* connection closed by client */
  });

  poll();

  return new Response(null, { status: 101, webSocket: client });
});

// ─── Scope definitions ────────────────────────────────────────────────────────

/** Authorization check for scope-definitions endpoints.
 *  Accepts either app-self auth (scoped to this appId) or user auth with
 *  the normal team/owner permission model. Returns null on allow, or a
 *  Response to return on deny. */
async function authorizeScopeDefsAccess(
  c: Context<AppEnv>,
  row: OAuthAppRow,
  appId: string,
  write: boolean,
): Promise<Response | null> {
  const appSelf = c.get("appSelfAuth");
  if (appSelf && appSelf.appId === appId) return null;

  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  if (!(await canAccess(c.env.DB, row, user.id, user.role, write)))
    return c.json({ error: "Forbidden" }, 403);
  return null;
}

// GET /:id/scope-definitions — list all scope metadata defined by this app
app.get("/:id/scope-definitions", async (c) => {
  const urlId = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT * FROM oauth_apps WHERE id = ? OR client_id = ?",
  )
    .bind(urlId, urlId)
    .first<OAuthAppRow>();
  if (!row) return c.json({ error: "Not found" }, 404);
  const denied = await authorizeScopeDefsAccess(c, row, row.id, false);
  if (denied) return denied;

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM app_scope_definitions WHERE app_id = ? ORDER BY scope ASC",
  )
    .bind(row.id)
    .all<AppScopeDefinitionRow>();
  return c.json({ definitions: results });
});

// POST /:id/scope-definitions — create or update a scope definition
app.post("/:id/scope-definitions", async (c) => {
  const urlId = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT * FROM oauth_apps WHERE id = ? OR client_id = ?",
  )
    .bind(urlId, urlId)
    .first<OAuthAppRow>();
  if (!row) return c.json({ error: "Not found" }, 404);
  const denied = await authorizeScopeDefsAccess(c, row, row.id, true);
  if (denied) return denied;

  const body = await c.req.json<{
    scope: string;
    title: string;
    description?: string;
  }>();
  if (!body.scope?.trim()) return c.json({ error: "scope is required" }, 400);
  if (!body.title?.trim()) return c.json({ error: "title is required" }, 400);

  // Scope must be a non-empty identifier (no whitespace, no colons)
  if (!/^[a-zA-Z0-9_.-]+$/.test(body.scope.trim()))
    return c.json(
      { error: "scope must be an alphanumeric identifier (a-z, 0-9, _, -, .)" },
      400,
    );

  const now = Math.floor(Date.now() / 1000);
  const defId = randomId();

  await c.env.DB.prepare(
    `INSERT INTO app_scope_definitions (id, app_id, scope, title, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(app_id, scope) DO UPDATE SET title=excluded.title, description=excluded.description, updated_at=excluded.updated_at`,
  )
    .bind(
      defId,
      row.id,
      body.scope.trim(),
      body.title.trim(),
      body.description?.trim() ?? "",
      now,
      now,
    )
    .run();

  const def = await c.env.DB.prepare(
    "SELECT * FROM app_scope_definitions WHERE app_id = ? AND scope = ?",
  )
    .bind(row.id, body.scope.trim())
    .first<AppScopeDefinitionRow>();

  return c.json({ definition: def }, 201);
});

// PATCH /:id/scope-definitions/:defId — update a scope definition
app.patch("/:id/scope-definitions/:defId", async (c) => {
  const { id: urlId, defId } = c.req.param();
  const row = await c.env.DB.prepare(
    "SELECT * FROM oauth_apps WHERE id = ? OR client_id = ?",
  )
    .bind(urlId, urlId)
    .first<OAuthAppRow>();
  if (!row) return c.json({ error: "Not found" }, 404);
  const denied = await authorizeScopeDefsAccess(c, row, row.id, true);
  if (denied) return denied;

  const def = await c.env.DB.prepare(
    "SELECT * FROM app_scope_definitions WHERE id = ? AND app_id = ?",
  )
    .bind(defId, row.id)
    .first<AppScopeDefinitionRow>();
  if (!def) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json<{ title?: string; description?: string }>();
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    "UPDATE app_scope_definitions SET title=?, description=?, updated_at=? WHERE id=?",
  )
    .bind(
      body.title?.trim() ?? def.title,
      body.description?.trim() ?? def.description,
      now,
      defId,
    )
    .run();

  return c.json({
    definition: {
      ...def,
      title: body.title?.trim() ?? def.title,
      description: body.description?.trim() ?? def.description,
      updated_at: now,
    },
  });
});

// DELETE /:id/scope-definitions/:defId — delete a scope definition
app.delete("/:id/scope-definitions/:defId", async (c) => {
  const { id: urlId, defId } = c.req.param();
  const row = await c.env.DB.prepare(
    "SELECT * FROM oauth_apps WHERE id = ? OR client_id = ?",
  )
    .bind(urlId, urlId)
    .first<OAuthAppRow>();
  if (!row) return c.json({ error: "Not found" }, 404);
  const denied = await authorizeScopeDefsAccess(c, row, row.id, true);
  if (denied) return denied;

  await c.env.DB.prepare(
    "DELETE FROM app_scope_definitions WHERE id = ? AND app_id = ?",
  )
    .bind(defId, row.id)
    .run();
  return c.json({ message: "Deleted" });
});

// ─── Scope access rules ───────────────────────────────────────────────────────

// GET /:id/scope-access-rules — list all access rules
app.get("/:id/scope-access-rules", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM oauth_apps WHERE id = ?")
    .bind(id)
    .first<OAuthAppRow>();
  if (!row) return c.json({ error: "Not found" }, 404);
  if (!(await canAccess(c.env.DB, row, user.id, user.role, false)))
    return c.json({ error: "Forbidden" }, 403);

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM app_scope_access_rules WHERE app_id = ? ORDER BY rule_type, created_at ASC",
  )
    .bind(id)
    .all<AppScopeAccessRuleRow>();
  return c.json({ rules: results });
});

// POST /:id/scope-access-rules — create an access rule
app.post("/:id/scope-access-rules", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM oauth_apps WHERE id = ?")
    .bind(id)
    .first<OAuthAppRow>();
  if (!row) return c.json({ error: "Not found" }, 404);
  if (!(await canAccess(c.env.DB, row, user.id, user.role, true)))
    return c.json({ error: "Forbidden" }, 403);

  const body = await c.req.json<{ rule_type: string; target_id: string }>();
  const VALID_RULE_TYPES = [
    "owner_allow",
    "owner_deny",
    "app_allow",
    "app_deny",
  ];
  if (!VALID_RULE_TYPES.includes(body.rule_type))
    return c.json(
      { error: `rule_type must be one of: ${VALID_RULE_TYPES.join(", ")}` },
      400,
    );
  if (!body.target_id?.trim())
    return c.json({ error: "target_id is required" }, 400);

  const now = Math.floor(Date.now() / 1000);
  const ruleId = randomId();

  try {
    await c.env.DB.prepare(
      "INSERT INTO app_scope_access_rules (id, app_id, rule_type, target_id, created_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(ruleId, id, body.rule_type, body.target_id.trim(), now)
      .run();
  } catch {
    return c.json({ error: "Rule already exists" }, 409);
  }

  return c.json(
    {
      rule: {
        id: ruleId,
        app_id: id,
        rule_type: body.rule_type,
        target_id: body.target_id.trim(),
        created_at: now,
      },
    },
    201,
  );
});

// DELETE /:id/scope-access-rules/:ruleId — delete an access rule
app.delete("/:id/scope-access-rules/:ruleId", async (c) => {
  const user = c.get("user");
  const { id, ruleId } = c.req.param();
  const row = await c.env.DB.prepare("SELECT * FROM oauth_apps WHERE id = ?")
    .bind(id)
    .first<OAuthAppRow>();
  if (!row) return c.json({ error: "Not found" }, 404);
  if (!(await canAccess(c.env.DB, row, user.id, user.role, true)))
    return c.json({ error: "Forbidden" }, 403);

  await c.env.DB.prepare(
    "DELETE FROM app_scope_access_rules WHERE id = ? AND app_id = ?",
  )
    .bind(ruleId, id)
    .run();
  return c.json({ message: "Deleted" });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeApp(baseUrl: string, row: OAuthAppRow, isVerified: boolean) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon_url: proxyImageUrl(baseUrl, row.icon_url),
    unproxied_icon_url: row.icon_url,
    website_url: row.website_url,
    client_id: row.client_id,
    redirect_uris: JSON.parse(row.redirect_uris) as string[],
    allowed_scopes: JSON.parse(row.allowed_scopes) as string[],
    optional_scopes: JSON.parse(row.optional_scopes ?? "[]") as string[],
    oidc_fields: JSON.parse(row.oidc_fields ?? "[]") as string[],
    is_public: row.is_public === 1,
    is_active: row.is_active === 1,
    is_verified: isVerified,
    is_official: row.is_official === 1,
    is_first_party: row.is_first_party === 1,
    use_jwt_tokens: row.use_jwt_tokens === 1,
    allow_self_manage_exported_permissions:
      row.allow_self_manage_exported_permissions === 1,
    team_id: row.team_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function fullApp(baseUrl: string, row: OAuthAppRow, isVerified: boolean) {
  return {
    ...safeApp(baseUrl, row, isVerified),
    client_secret: row.client_secret,
  };
}

export default app;
