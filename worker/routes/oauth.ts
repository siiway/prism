// OAuth 2.0 Authorization Server (Authorization Code + PKCE, OpenID Connect)

import { Hono } from "hono";
import { getConfig, getJwtSecret } from "../lib/config";
import { randomBase64url, randomId, verifyPkce } from "../lib/crypto";
import { requireAuth, optionalAuth } from "../middleware/auth";
import {
  computeIsVerified,
  buildVerifiedDomainsMap,
  computeVerified,
} from "../lib/domainVerify";
import { hmacSign } from "../lib/webhooks";
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
]);

// ─── Authorization endpoint ───────────────────────────────────────────────────

// GET /api/oauth/consents — list apps the user has granted access to
app.get("/consents", requireAuth, async (c) => {
  const user = c.get("user");
  const rows = await c.env.DB.prepare(
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
    }>();

  const ownerIds = [...new Set(rows.results.map((r) => r.owner_id))];
  const domainsMap = await buildVerifiedDomainsMap(c.env.DB, ownerIds);

  return c.json({
    consents: rows.results.map((r) => ({
      client_id: r.client_id,
      scopes: JSON.parse(r.scopes) as string[],
      granted_at: r.granted_at,
      app: {
        name: r.name,
        description: r.description,
        icon_url: r.icon_url,
        website_url: r.website_url,
        is_verified: computeVerified(
          domainsMap.get(r.owner_id) ?? new Set(),
          r.website_url,
          r.redirect_uris,
        ),
      },
    })),
  });
});

// DELETE /api/oauth/consents/:client_id — revoke consent and associated tokens
app.delete("/consents/:client_id", requireAuth, async (c) => {
  const user = c.get("user");
  const clientId = c.req.param("client_id");

  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM oauth_consents WHERE user_id = ? AND client_id = ?",
    ).bind(user.id, clientId),
    c.env.DB.prepare(
      "DELETE FROM oauth_tokens WHERE user_id = ? AND client_id = ?",
    ).bind(user.id, clientId),
  ]);

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
  const scopes = requestedScopes.filter(
    (s) => VALID_SCOPES.has(s) && allowedScopes.includes(s),
  );

  return c.json({
    app: {
      id: oauthApp.id,
      name: oauthApp.name,
      description: oauthApp.description,
      icon_url: oauthApp.icon_url,
      website_url: oauthApp.website_url,
      is_verified: await computeIsVerified(
        c.env.DB,
        oauthApp.owner_id,
        oauthApp.website_url,
        oauthApp.redirect_uris,
        oauthApp.team_id,
      ),
      is_official: oauthApp.is_official === 1,
      is_first_party: oauthApp.is_first_party === 1,
    },
    scopes,
    redirect_uri,
    state,
    code_challenge,
    code_challenge_method,
    nonce,
    user: c.get("user") ?? null,
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

  const allowedScopes = JSON.parse(oauthApp.allowed_scopes) as string[];
  const scopes = (body.scope ?? "")
    .split(" ")
    .filter((s) => VALID_SCOPES.has(s) && allowedScopes.includes(s));

  // Store consent
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    `INSERT INTO oauth_consents (id, user_id, client_id, scopes, granted_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, client_id) DO UPDATE SET scopes = excluded.scopes, granted_at = excluded.granted_at`,
  )
    .bind(randomId(), user.id, body.client_id, JSON.stringify(scopes), now)
    .run();

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
      JSON.stringify(scopes),
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

  // For public clients (PKCE), secret not required; for confidential clients, verify secret
  if (!oauthApp.is_public && oauthApp.client_secret !== clientSecret) {
    return c.json({ error: "invalid_client" }, 401);
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
    const accessToken = randomBase64url(48);
    const hasOffline = scopes.includes("offline_access");
    const refreshToken = hasOffline ? randomBase64url(48) : null;
    const atTtl = config.access_token_ttl_minutes * 60;
    const rtTtl = config.refresh_token_ttl_days * 24 * 60 * 60;

    await c.env.DB.prepare(
      `INSERT INTO oauth_tokens (id, access_token, refresh_token, client_id, user_id, scopes, expires_at, refresh_expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        randomId(),
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
      response.id_token = await buildIdToken(
        user,
        clientId,
        scopes,
        codeRow.nonce,
        await getJwtSecret(c.env.KV_SESSIONS),
        atTtl,
        c.env.APP_URL,
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
    const newAccessToken = randomBase64url(48);
    const atTtl = config.access_token_ttl_minutes * 60;

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
  const claims: Record<string, unknown> = { sub: user.id };
  if (scopes.includes("profile")) {
    claims.name = user.display_name;
    claims.preferred_username = user.username;
    claims.picture = user.avatar_url;
  }
  if (scopes.includes("email")) {
    claims.email = user.email;
    claims.email_verified = user.email_verified === 1;
  }
  return c.json(claims);
});

// ─── Token introspection ─────────────────────────────────────────────────────

app.post("/introspect", async (c) => {
  const body = await c.req.text();
  const params = Object.fromEntries(new URLSearchParams(body));
  const token = params.token;
  if (!token) return c.json({ active: false });

  const now = Math.floor(Date.now() / 1000);
  const tokenRow = await c.env.DB.prepare(
    "SELECT * FROM oauth_tokens WHERE access_token = ?",
  )
    .bind(token)
    .first<OAuthTokenRow>();

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

  // Standard OAuth access token
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

  return c.json({ apps: results });
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

  return c.json({ teams: results });
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

  if (!member || !["owner", "admin"].includes(member.role))
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
    avatar_url: user.avatar_url,
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
    .first();

  return c.json({ user });
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
  let verified = false;
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
    users: results,
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
  return c.json({ user });
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

  return c.json({ user });
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

// GET /api/oauth/me/admin/config — read site config (requires admin:config:read)
app.get("/me/admin/config", async (c) => {
  const resolved = await requireAdminToken(c, "admin:config:read");
  if (!resolved) return c.json({ error: "insufficient_scope" }, 403);

  const { getConfig } = await import("../lib/config");
  const config = await getConfig(c.env.DB);

  // Strip sensitive credential fields
  const {
    github_client_secret,
    google_client_secret,
    microsoft_client_secret,
    discord_client_secret,
    captcha_secret_key,
    smtp_password,
    email_api_key,
    ...safe
  } = config as unknown as Record<string, unknown>;
  (void github_client_secret,
    google_client_secret,
    microsoft_client_secret,
    discord_client_secret,
    captcha_secret_key,
    smtp_password,
    email_api_key);

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
  let response: string | null = null;
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

async function buildIdToken(
  user: UserRow,
  clientId: string,
  scopes: string[],
  nonce: string | null,
  secret: string,
  ttl: number,
  issuer: string,
): Promise<string> {
  const { signJWT } = await import("../lib/jwt");
  const claims: Record<string, unknown> = {
    iss: issuer,
    aud: clientId,
    sub: user.id,
    sessionId: "",
    role: user.role,
  };
  if (nonce) claims.nonce = nonce;
  if (scopes.includes("profile")) {
    claims.name = user.display_name;
    claims.preferred_username = user.username;
    claims.picture = user.avatar_url;
  }
  if (scopes.includes("email")) {
    claims.email = user.email;
    claims.email_verified = user.email_verified === 1;
  }
  return signJWT(claims as Parameters<typeof signJWT>[0], secret, ttl);
}

export default app;
