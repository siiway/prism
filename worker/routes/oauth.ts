// OAuth 2.0 Authorization Server (Authorization Code + PKCE, OpenID Connect)

import { Hono } from "hono";
import { getConfig, getJwtSecret } from "../lib/config";
import { randomBase64url, randomId, verifyPkce } from "../lib/crypto";
import { requireAuth, optionalAuth } from "../middleware/auth";
import type {
  OAuthAppRow,
  OAuthCodeRow,
  OAuthTokenRow,
  UserRow,
  Variables,
} from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

const VALID_SCOPES = new Set([
  "openid",
  "profile",
  "email",
  "apps:read",
  "offline_access",
]);

// ─── Authorization endpoint ───────────────────────────────────────────────────

// GET /api/oauth/consents — list apps the user has granted access to
app.get("/consents", requireAuth, async (c) => {
  const user = c.get("user");
  const rows = await c.env.DB.prepare(
    `SELECT oc.client_id, oc.scopes, oc.granted_at,
            oa.name, oa.description, oa.icon_url, oa.website_url, oa.is_verified
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
      is_verified: number;
    }>();

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
        is_verified: r.is_verified === 1,
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
      is_verified: oauthApp.is_verified === 1,
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

// ─── OpenID Connect Discovery ─────────────────────────────────────────────────

app.get("/.well-known/openid-configuration", (c) => {
  const base = c.env.APP_URL;
  return c.json({
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    userinfo_endpoint: `${base}/api/oauth/userinfo`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    introspection_endpoint: `${base}/api/oauth/introspect`,
    scopes_supported: [...VALID_SCOPES],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["HS256"],
    token_endpoint_auth_methods_supported: [
      "client_secret_post",
      "client_secret_basic",
      "none",
    ],
    code_challenge_methods_supported: ["S256", "plain"],
    claims_supported: [
      "sub",
      "name",
      "preferred_username",
      "picture",
      "email",
      "email_verified",
    ],
  });
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
