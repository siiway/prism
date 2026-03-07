// Social platform connections (GitHub, Google, Microsoft, Discord)

import { Hono } from "hono";
import { randomId, randomBase64url } from "../lib/crypto";
import { getConfig, getJwtSecret } from "../lib/config";
import { requireAuth, optionalAuth } from "../middleware/auth";
import { signJWT } from "../lib/jwt";
import type { SocialConnectionRow, UserRow, Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

// ─── Provider config ──────────────────────────────────────────────────────────

interface ProviderDef {
  authUrl: string;
  tokenUrl: string;
  userUrl: string;
  scopes: string;
  clientIdKey: keyof import("../types").SiteConfig;
  clientSecretKey: keyof import("../types").SiteConfig;
}

const PROVIDERS: Record<string, ProviderDef> = {
  github: {
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userUrl: "https://api.github.com/user",
    scopes: "read:user user:email",
    clientIdKey: "github_client_id",
    clientSecretKey: "github_client_secret",
  },
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
    scopes: "openid email profile",
    clientIdKey: "google_client_id",
    clientSecretKey: "google_client_secret",
  },
  microsoft: {
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    userUrl: "https://graph.microsoft.com/v1.0/me",
    scopes: "openid email profile User.Read",
    clientIdKey: "microsoft_client_id",
    clientSecretKey: "microsoft_client_secret",
  },
  discord: {
    authUrl: "https://discord.com/api/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    userUrl: "https://discord.com/api/users/@me",
    scopes: "identify email",
    clientIdKey: "discord_client_id",
    clientSecretKey: "discord_client_secret",
  },
};

// ─── List connections ─────────────────────────────────────────────────────────

app.get("/", requireAuth, async (c) => {
  const user = c.get("user");
  const rows = await c.env.DB.prepare(
    "SELECT id, provider, provider_user_id, profile_data, connected_at FROM social_connections WHERE user_id = ?",
  )
    .bind(user.id)
    .all<
      Pick<
        SocialConnectionRow,
        "id" | "provider" | "provider_user_id" | "profile_data" | "connected_at"
      >
    >();

  return c.json({
    connections: rows.results.map(
      (
        r: Pick<
          SocialConnectionRow,
          | "id"
          | "provider"
          | "provider_user_id"
          | "profile_data"
          | "connected_at"
        >,
      ) => ({
        id: r.id,
        provider: r.provider,
        provider_user_id: r.provider_user_id,
        profile: JSON.parse(r.profile_data) as unknown,
        connected_at: r.connected_at,
      }),
    ),
  });
});

// ─── Begin OAuth flow ─────────────────────────────────────────────────────────

app.get("/:provider/begin", optionalAuth, async (c) => {
  const provider = c.req.param("provider") ?? "";
  const def = PROVIDERS[provider];
  if (!def) return c.json({ error: "Unknown provider" }, 400);

  const config = await getConfig(c.env.DB);
  const cfg = config as unknown as Record<string, unknown>;
  const clientId = cfg[def.clientIdKey as string] as string;
  if (!clientId) return c.json({ error: `${provider} is not configured` }, 503);

  const state = randomBase64url(24);
  const mode = c.req.query("mode") ?? "login"; // 'login' | 'connect'
  const userId = c.get("user")?.id ?? null;

  await c.env.KV_CACHE.put(
    `social:state:${state}`,
    JSON.stringify({ provider, mode, userId }),
    { expirationTtl: 600 },
  );

  const redirectUri = `${c.env.APP_URL}/api/connections/${provider}/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: def.scopes,
    state,
  });

  // Google/Microsoft need additional params
  if (provider === "google") params.set("access_type", "offline");
  if (provider === "microsoft") params.set("response_mode", "query");

  return c.redirect(`${def.authUrl}?${params}`);
});

// ─── OAuth callback ───────────────────────────────────────────────────────────

app.get("/:provider/callback", async (c) => {
  const provider = c.req.param("provider") ?? "";
  const def = PROVIDERS[provider];
  if (!def) return c.json({ error: "Unknown provider" }, 400);

  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  if (error)
    return c.redirect(
      `${c.env.APP_URL}/connections?error=${encodeURIComponent(error)}`,
    );
  if (!code || !state)
    return c.redirect(`${c.env.APP_URL}/connections?error=missing_params`);

  const stateData = await c.env.KV_CACHE.get(`social:state:${state}`);
  if (!stateData) {
    console.error(
      `[connections] invalid_state — key not found for state=${state} provider=${provider}`,
    );
    return c.redirect(`${c.env.APP_URL}/connections?error=invalid_state`);
  }
  await c.env.KV_CACHE.delete(`social:state:${state}`);

  const { mode, userId } = JSON.parse(stateData) as {
    provider: string;
    mode: string;
    userId: string | null;
  };

  const config = await getConfig(c.env.DB);
  const cfgCb = config as unknown as Record<string, unknown>;
  const clientId = cfgCb[def.clientIdKey as string] as string;
  const clientSecret = cfgCb[def.clientSecretKey as string] as string;
  const redirectUri = `${c.env.APP_URL}/api/connections/${provider}/callback`;

  // Exchange code for token
  let tokenData: Record<string, unknown>;
  try {
    const tokenRes = await fetch(def.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    tokenData = (await tokenRes.json()) as Record<string, unknown>;
  } catch {
    return c.redirect(
      `${c.env.APP_URL}/connections?error=token_exchange_failed`,
    );
  }

  const accessToken = tokenData.access_token as string;
  if (!accessToken)
    return c.redirect(`${c.env.APP_URL}/connections?error=no_access_token`);

  // Fetch user profile
  let profileData: Record<string, unknown>;
  try {
    const userRes = await fetch(def.userUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "Prism/1.0",
      },
    });
    if (!userRes.ok) {
      const body = await userRes.text();
      console.error(
        `[connections] ${provider} profile fetch ${userRes.status}: ${body}`,
      );
      return c.redirect(
        `${c.env.APP_URL}/connections?error=profile_fetch_failed&status=${userRes.status}`,
      );
    }
    profileData = (await userRes.json()) as Record<string, unknown>;
  } catch (err) {
    console.error(`[connections] ${provider} profile fetch threw:`, err);
    return c.redirect(
      `${c.env.APP_URL}/connections?error=profile_fetch_failed`,
    );
  }

  const providerUserId = extractProviderUserId(provider, profileData);
  const providerEmail = extractProviderEmail(provider, profileData);
  if (!providerUserId)
    return c.redirect(`${c.env.APP_URL}/connections?error=no_user_id`);

  const now = Math.floor(Date.now() / 1000);

  // Connect mode: attach to existing account
  if (mode === "connect" && userId) {
    // Check if this specific provider account is already linked (to any user)
    const taken = await c.env.DB.prepare(
      "SELECT user_id FROM social_connections WHERE provider = ? AND provider_user_id = ?",
    )
      .bind(provider, providerUserId)
      .first<{ user_id: string }>();

    if (taken) {
      const errKey =
        taken.user_id === userId ? "already_connected" : "account_taken";
      return c.redirect(`${c.env.APP_URL}/connections?error=${errKey}`);
    }

    await c.env.DB.prepare(
      "INSERT INTO social_connections (id, user_id, provider, provider_user_id, access_token, profile_data, connected_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        randomId(),
        userId,
        provider,
        providerUserId,
        accessToken,
        JSON.stringify(profileData),
        now,
      )
      .run();
    return c.redirect(`${c.env.APP_URL}/connections?success=connected`);
  }

  // Login mode: find or create user
  let user = await c.env.DB.prepare(
    "SELECT u.* FROM users u JOIN social_connections sc ON sc.user_id = u.id WHERE sc.provider = ? AND sc.provider_user_id = ?",
  )
    .bind(provider, providerUserId)
    .first<UserRow>();

  if (!user && providerEmail) {
    user = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?")
      .bind(providerEmail.toLowerCase())
      .first<UserRow>();
  }

  if (!user) {
    // Auto-register
    const allowReg = await getConfig(c.env.DB).then(
      (cfg) => cfg.allow_registration,
    );
    if (!allowReg)
      return c.redirect(`${c.env.APP_URL}/login?error=registration_disabled`);

    const newUserId = randomId();
    const username = await uniqueUsername(
      c.env.DB,
      extractUsername(provider, profileData, providerEmail),
    );
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, username, display_name, role, email_verified, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'user', 1, 1, ?, ?)`,
    )
      .bind(
        newUserId,
        providerEmail ?? `${provider}_${providerUserId}@prism.local`,
        username,
        extractDisplayName(provider, profileData),
        now,
        now,
      )
      .run();

    user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
      .bind(newUserId)
      .first<UserRow>();
  }

  if (!user)
    return c.redirect(`${c.env.APP_URL}/login?error=user_creation_failed`);

  // Upsert social connection (keyed by provider+provider_user_id so re-login refreshes token)
  await c.env.DB.prepare(
    `INSERT INTO social_connections (id, user_id, provider, provider_user_id, access_token, profile_data, connected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, provider_user_id) DO UPDATE SET access_token = excluded.access_token, profile_data = excluded.profile_data`,
  )
    .bind(
      randomId(),
      user.id,
      provider,
      providerUserId,
      accessToken,
      JSON.stringify(profileData),
      now,
    )
    .run();

  const sessionTtl = 30 * 24 * 60 * 60;
  const token = await signJWT(
    {
      sub: user.id,
      role: user.role,
      email: user.email,
      username: user.username,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
      email_verified: user.email_verified === 1,
      sessionId: randomId(32),
    },
    await getJwtSecret(c.env.KV_SESSIONS),
    sessionTtl,
  );

  // Redirect to frontend with token
  return c.redirect(
    `${c.env.APP_URL}/auth/callback?token=${encodeURIComponent(token)}`,
  );
});

// Disconnect a specific connection by ID
app.delete("/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const result = await c.env.DB.prepare(
    "DELETE FROM social_connections WHERE id = ? AND user_id = ?",
  )
    .bind(id, user.id)
    .run();
  if (!result.meta.changes)
    return c.json({ error: "Connection not found" }, 404);
  return c.json({ message: "Disconnected" });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractProviderUserId(
  provider: string,
  profile: Record<string, unknown>,
): string | null {
  switch (provider) {
    case "github":
      return String(profile.id ?? "");
    case "google":
      return String(profile.sub ?? "");
    case "microsoft":
      return String(profile.id ?? "");
    case "discord":
      return String(profile.id ?? "");
    default:
      return String(profile.id ?? profile.sub ?? "");
  }
}

function extractProviderEmail(
  provider: string,
  profile: Record<string, unknown>,
): string | null {
  const email = (profile.email as string) ?? null;
  if (provider === "microsoft")
    return (
      (profile.mail as string) ?? (profile.userPrincipalName as string) ?? email
    );
  return email;
}

function extractDisplayName(
  provider: string,
  profile: Record<string, unknown>,
): string {
  switch (provider) {
    case "github":
      return (profile.name as string) || (profile.login as string) || "User";
    case "google":
      return (profile.name as string) || "User";
    case "microsoft":
      return (profile.displayName as string) || "User";
    case "discord":
      return (
        (profile.global_name as string) ||
        (profile.username as string) ||
        "User"
      );
    default:
      return "User";
  }
}

function extractUsername(
  provider: string,
  profile: Record<string, unknown>,
  email: string | null,
): string {
  const base =
    provider === "github"
      ? (profile.login as string)
      : provider === "discord"
        ? (profile.username as string)
        : (email?.split("@")[0] ?? "user");
  return base
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 24);
}

async function uniqueUsername(db: D1Database, base: string): Promise<string> {
  let candidate = base || "user";
  let i = 0;
  while (true) {
    const name = i === 0 ? candidate : `${candidate}${i}`;
    const existing = await db
      .prepare("SELECT id FROM users WHERE username = ?")
      .bind(name)
      .first();
    if (!existing) return name;
    i++;
  }
}

export default app;
