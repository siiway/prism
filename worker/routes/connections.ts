// Social platform connections (GitHub, Google, Microsoft, Discord, generic OIDC/OAuth2)

import { Hono } from "hono";
import { randomId, randomBase64url } from "../lib/crypto";
import { getConfig, getJwtSecret } from "../lib/config";
import { requireAuth, optionalAuth } from "../middleware/auth";
import { signJWT } from "../lib/jwt";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingState {
  type: "register" | "select";
  provider: string;
  providerUserId: string;
  providerEmail: string | null;
  accessToken: string;
  profileData: Record<string, unknown>;
  users?: Array<{
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
  }>;
}
import type {
  OAuthSourceRow,
  SocialConnectionRow,
  UserRow,
  Variables,
} from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

// ─── Provider definitions (URL/scope metadata, keyed by base provider type) ───

interface ProviderDef {
  authUrl: string;
  tokenUrl: string;
  userUrl: string;
  scopes: string;
  // Legacy site_config key names for backward-compatibility
  clientIdKey: string;
  clientSecretKey: string;
}

const PROVIDER_DEFS: Record<string, ProviderDef> = {
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
  // Generic providers — all URLs/scopes are configured per-source in oauth_sources table
  oidc: {
    authUrl: "",
    tokenUrl: "",
    userUrl: "",
    scopes: "openid email profile",
    clientIdKey: "",
    clientSecretKey: "",
  },
  oauth2: {
    authUrl: "",
    tokenUrl: "",
    userUrl: "",
    scopes: "",
    clientIdKey: "",
    clientSecretKey: "",
  },
};

// Resolved source: everything needed to run the OAuth flow for a given slug
interface ResolvedSource {
  slug: string;
  provider: string; // base type used for profile extraction helpers
  name: string;
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  userUrl: string;
  scopes: string;
}

/**
 * Look up an OAuth source by slug.
 * Priority: oauth_sources table → legacy site_config keys.
 * Returns null if the slug is unknown or unconfigured.
 */
async function resolveSource(
  db: D1Database,
  slug: string,
  config: import("../types").SiteConfig,
): Promise<ResolvedSource | null> {
  // 1. Check the explicit oauth_sources table
  const row = await db
    .prepare("SELECT * FROM oauth_sources WHERE slug = ? AND enabled = 1")
    .bind(slug)
    .first<OAuthSourceRow>();

  if (row) {
    const def = PROVIDER_DEFS[row.provider];
    if (!def) return null; // unknown base provider type

    // For generic providers (oidc/oauth2), URLs are stored per-row
    const isGeneric = row.provider === "oidc" || row.provider === "oauth2";
    const authUrl = isGeneric ? (row.auth_url ?? "") : def.authUrl;
    const tokenUrl = isGeneric ? (row.token_url ?? "") : def.tokenUrl;
    const userUrl = isGeneric ? (row.userinfo_url ?? "") : def.userUrl;
    const scopes = row.scopes ?? def.scopes;

    if (isGeneric && (!authUrl || !tokenUrl || !userUrl)) return null; // misconfigured generic source

    return {
      slug: row.slug,
      provider: row.provider,
      name: row.name,
      clientId: row.client_id,
      clientSecret: row.client_secret,
      authUrl,
      tokenUrl,
      userUrl,
      scopes,
    };
  }

  // 2. Fall back to legacy site_config keys (slug must equal a base provider name)
  const def = PROVIDER_DEFS[slug];
  if (!def) return null;

  const cfg = config as unknown as Record<string, string>;
  const clientId = cfg[def.clientIdKey];
  if (!clientId) return null;

  return {
    slug,
    provider: slug,
    name: slug.charAt(0).toUpperCase() + slug.slice(1),
    clientId,
    clientSecret: cfg[def.clientSecretKey] ?? "",
    authUrl: def.authUrl,
    tokenUrl: def.tokenUrl,
    userUrl: def.userUrl,
    scopes: def.scopes,
  };
}

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

// ─── Connect intent (pre-flight API call so userId survives the browser redirect) ──

app.post("/intent", requireAuth, async (c) => {
  const user = c.get("user");
  const key = `connect:intent:${randomBase64url(24)}`;
  await c.env.KV_CACHE.put(key, user.id, { expirationTtl: 300 });
  return c.json({ token: key });
});

// ─── Begin OAuth flow ─────────────────────────────────────────────────────────

app.get("/:provider/begin", optionalAuth, async (c) => {
  const slug = c.req.param("provider") ?? "";
  const config = await getConfig(c.env.DB);
  const source = await resolveSource(c.env.DB, slug, config);
  if (!source)
    return c.json({ error: "Unknown or unconfigured provider" }, 400);

  const state = randomBase64url(24);
  const mode = c.req.query("mode") ?? "login"; // 'login' | 'connect'

  // For connect mode, userId comes from a pre-issued intent token stored in KV
  let userId = c.get("user")?.id ?? null;
  if (!userId && mode === "connect") {
    const intentKey = c.req.query("intent");
    if (intentKey) {
      const stored = await c.env.KV_CACHE.get(intentKey);
      if (stored) {
        userId = stored;
        await c.env.KV_CACHE.delete(intentKey); // one-time use
      }
    }
  }

  await c.env.KV_CACHE.put(
    `social:state:${state}`,
    JSON.stringify({ slug, provider: source.provider, mode, userId }),
    { expirationTtl: 600 },
  );

  const redirectUri = `${c.env.APP_URL}/api/connections/${slug}/callback`;
  const params = new URLSearchParams({
    client_id: source.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: source.scopes,
    state,
  });

  if (source.provider === "google") params.set("access_type", "offline");
  if (source.provider === "microsoft") params.set("response_mode", "query");

  return c.redirect(`${source.authUrl}?${params}`);
});

// ─── OAuth callback ───────────────────────────────────────────────────────────

app.get("/:provider/callback", async (c) => {
  const slug = c.req.param("provider") ?? "";
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
      `[connections] invalid_state — key not found for state=${state} slug=${slug}`,
    );
    return c.redirect(`${c.env.APP_URL}/connections?error=invalid_state`);
  }
  await c.env.KV_CACHE.delete(`social:state:${state}`);

  const { provider, mode, userId } = JSON.parse(stateData) as {
    slug: string;
    provider: string;
    mode: string;
    userId: string | null;
  };

  const config = await getConfig(c.env.DB);
  const source = await resolveSource(c.env.DB, slug, config);
  if (!source)
    return c.redirect(
      `${c.env.APP_URL}/connections?error=provider_not_configured`,
    );

  const redirectUri = `${c.env.APP_URL}/api/connections/${slug}/callback`;

  // Exchange code for token
  let tokenData: Record<string, unknown>;
  try {
    const tokenRes = await fetch(source.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: source.clientId,
        client_secret: source.clientSecret,
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
    const userRes = await fetch(source.userUrl, {
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

  // `provider` is the base type (github/google/…); `slug` is the source identifier
  const providerUserId = extractProviderUserId(provider, profileData);
  const providerEmail = extractProviderEmail(provider, profileData);
  if (!providerUserId)
    return c.redirect(`${c.env.APP_URL}/connections?error=no_user_id`);

  const now = Math.floor(Date.now() / 1000);

  // Connect mode: attach to existing account
  // social_connections.provider stores the slug so users can have e.g. github + github-work
  if (mode === "connect" && userId) {
    const alreadyLinked = await c.env.DB.prepare(
      "SELECT id FROM social_connections WHERE user_id = ? AND provider = ? AND provider_user_id = ?",
    )
      .bind(userId, slug, providerUserId)
      .first();

    if (alreadyLinked)
      return c.redirect(`${c.env.APP_URL}/connections?error=already_connected`);

    await c.env.DB.prepare(
      "INSERT INTO social_connections (id, user_id, provider, provider_user_id, access_token, profile_data, connected_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        randomId(),
        userId,
        slug,
        providerUserId,
        accessToken,
        JSON.stringify(profileData),
        now,
      )
      .run();
    return c.redirect(`${c.env.APP_URL}/connections?success=connected`);
  }

  // Login mode: find ALL Prism accounts linked to this source slug + provider_user_id
  const linkedRows = await c.env.DB.prepare(
    "SELECT u.id, u.username, u.display_name, u.avatar_url, u.role, u.email, u.email_verified, u.is_active, u.created_at, u.updated_at, u.password_hash, u.email_verify_token FROM users u JOIN social_connections sc ON sc.user_id = u.id WHERE sc.provider = ? AND sc.provider_user_id = ?",
  )
    .bind(slug, providerUserId)
    .all<UserRow>();

  const linkedUsers = linkedRows.results;

  if (linkedUsers.length === 0) {
    // No account linked — ask user whether to create one
    const allowReg = await getConfig(c.env.DB).then(
      (cfg) => cfg.allow_registration,
    );
    if (!allowReg)
      return c.redirect(`${c.env.APP_URL}/login?error=registration_disabled`);

    const pendingKey = `social:pending:${randomBase64url(24)}`;
    await c.env.KV_CACHE.put(
      pendingKey,
      JSON.stringify({
        type: "register",
        provider: slug, // store slug so /complete can insert the right value
        providerUserId,
        providerEmail,
        accessToken,
        profileData,
      } satisfies PendingState),
      { expirationTtl: 600 },
    );
    return c.redirect(
      `${c.env.APP_URL}/social-confirm?key=${encodeURIComponent(pendingKey)}`,
    );
  }

  if (linkedUsers.length === 1) {
    // Single account — log in directly and refresh the token
    const user = linkedUsers[0];
    await c.env.DB.prepare(
      "UPDATE social_connections SET access_token = ?, profile_data = ? WHERE user_id = ? AND provider = ? AND provider_user_id = ?",
    )
      .bind(
        accessToken,
        JSON.stringify(profileData),
        user.id,
        slug,
        providerUserId,
      )
      .run();
    return c.redirect(
      `${c.env.APP_URL}/auth/callback?token=${encodeURIComponent(await issueJWT(user, c.env.KV_SESSIONS))}`,
    );
  }

  // Multiple accounts linked — ask user to pick one
  const pendingKey = `social:pending:${randomBase64url(24)}`;
  await c.env.KV_CACHE.put(
    pendingKey,
    JSON.stringify({
      type: "select",
      provider: slug,
      providerUserId,
      providerEmail,
      accessToken,
      profileData,
      users: linkedUsers.map((u: UserRow) => ({
        id: u.id,
        username: u.username,
        display_name: u.display_name,
        avatar_url: u.avatar_url,
      })),
    } satisfies PendingState),
    { expirationTtl: 600 },
  );
  return c.redirect(
    `${c.env.APP_URL}/social-select?key=${encodeURIComponent(pendingKey)}`,
  );
});

// ─── Pending social state (for confirm / select pages) ────────────────────────

app.get("/pending/:key", async (c) => {
  const key = c.req.param("key");
  const raw = await c.env.KV_CACHE.get(key);
  if (!raw) return c.json({ error: "Invalid or expired session" }, 404);

  const state = JSON.parse(raw) as PendingState;
  // state.provider holds the slug; resolve the base provider type for helpers
  const config = await getConfig(c.env.DB);
  const source = await resolveSource(c.env.DB, state.provider, config);
  const baseProvider = source?.provider ?? state.provider;

  return c.json({
    type: state.type,
    provider: state.provider, // slug (used for display / URL)
    provider_name: source?.name ?? state.provider,
    profile_name: extractDisplayName(baseProvider, state.profileData),
    profile_avatar: extractProviderAvatar(baseProvider, state.profileData),
    suggested_username: extractUsername(
      baseProvider,
      state.profileData,
      state.providerEmail,
    ),
    suggested_display_name: extractDisplayName(baseProvider, state.profileData),
    users: state.users,
  });
});

// ─── Complete pending social action ───────────────────────────────────────────

app.post("/complete", async (c) => {
  const body = await c.req
    .json<{
      key: string;
      action: "login" | "register";
      user_id?: string;
      username?: string;
      display_name?: string;
    }>()
    .catch(() => null);
  if (!body) return c.json({ error: "Invalid request body" }, 400);

  const raw = await c.env.KV_CACHE.get(body.key);
  if (!raw) return c.json({ error: "Invalid or expired session" }, 400);

  const state = JSON.parse(raw) as PendingState;
  await c.env.KV_CACHE.delete(body.key);

  const now = Math.floor(Date.now() / 1000);
  // Resolve base provider type for display-name helpers
  const completeCfg = await getConfig(c.env.DB);
  const completeSource = await resolveSource(
    c.env.DB,
    state.provider,
    completeCfg,
  );
  const baseProvider = completeSource?.provider ?? state.provider;

  if (body.action === "login") {
    if (state.type !== "select")
      return c.json({ error: "Invalid action for this session" }, 400);
    if (!body.user_id || !state.users?.find((u) => u.id === body.user_id))
      return c.json({ error: "Invalid user selection" }, 400);

    const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
      .bind(body.user_id)
      .first<UserRow>();
    if (!user) return c.json({ error: "User not found" }, 404);

    await c.env.DB.prepare(
      "UPDATE social_connections SET access_token = ?, profile_data = ? WHERE user_id = ? AND provider = ? AND provider_user_id = ?",
    )
      .bind(
        state.accessToken,
        JSON.stringify(state.profileData),
        user.id,
        state.provider,
        state.providerUserId,
      )
      .run();

    return c.json({
      token: await issueJWT(user, c.env.KV_SESSIONS),
      user: userToProfile(user),
    });
  }

  if (body.action === "register") {
    if (state.type !== "register")
      return c.json({ error: "Invalid action for this session" }, 400);

    const allowReg = await getConfig(c.env.DB).then(
      (cfg) => cfg.allow_registration,
    );
    if (!allowReg) return c.json({ error: "Registration is disabled" }, 403);

    const username = (body.username ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .slice(0, 32);
    const display_name = (
      body.display_name ?? extractDisplayName(baseProvider, state.profileData)
    )
      .trim()
      .slice(0, 64);

    if (!username) return c.json({ error: "Username is required" }, 400);

    const taken = await c.env.DB.prepare(
      "SELECT id FROM users WHERE username = ?",
    )
      .bind(username)
      .first();
    if (taken) return c.json({ error: "Username is already taken" }, 409);

    const newUserId = randomId();
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, username, display_name, role, email_verified, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'user', 1, 1, ?, ?)`,
    )
      .bind(
        newUserId,
        state.providerEmail ??
          `${state.provider}_${state.providerUserId}@prism.local`,
        username,
        display_name,
        now,
        now,
      )
      .run();

    await c.env.DB.prepare(
      "INSERT INTO social_connections (id, user_id, provider, provider_user_id, access_token, profile_data, connected_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        randomId(),
        newUserId,
        state.provider,
        state.providerUserId,
        state.accessToken,
        JSON.stringify(state.profileData),
        now,
      )
      .run();

    const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
      .bind(newUserId)
      .first<UserRow>();
    if (!user) return c.json({ error: "Failed to create user" }, 500);

    return c.json({
      token: await issueJWT(user, c.env.KV_SESSIONS),
      user: userToProfile(user),
    });
  }

  return c.json({ error: "Invalid action" }, 400);
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
    case "oidc":
      return String(profile.sub ?? "");
    case "microsoft":
      return String(profile.id ?? "");
    case "discord":
      return String(profile.id ?? "");
    default:
      // oauth2 and unknown — try sub first (OIDC-style), then id
      return String(profile.sub ?? profile.id ?? "");
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
    case "oidc":
      return (
        (profile.name as string) ||
        (profile.preferred_username as string) ||
        "User"
      );
    case "microsoft":
      return (profile.displayName as string) || "User";
    case "discord":
      return (
        (profile.global_name as string) ||
        (profile.username as string) ||
        "User"
      );
    default:
      // oauth2 and unknown
      return (
        (profile.name as string) ||
        (profile.login as string) ||
        (profile.username as string) ||
        "User"
      );
  }
}

function extractUsername(
  provider: string,
  profile: Record<string, unknown>,
  email: string | null,
): string {
  let base: string;
  if (provider === "github") {
    base = (profile.login as string) || email?.split("@")[0] || "user";
  } else if (provider === "discord") {
    base = (profile.username as string) || email?.split("@")[0] || "user";
  } else {
    // google, microsoft, oidc, oauth2, unknown — prefer preferred_username, then email prefix
    base =
      (profile.preferred_username as string) ||
      (profile.login as string) ||
      (profile.username as string) ||
      email?.split("@")[0] ||
      "user";
  }
  return base
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 24);
}

function extractProviderAvatar(
  provider: string,
  profile: Record<string, unknown>,
): string | null {
  switch (provider) {
    case "github":
      return (profile.avatar_url as string) ?? null;
    case "google":
    case "oidc":
      return (profile.picture as string) ?? null;
    case "discord": {
      const id = profile.id as string;
      const avatar = profile.avatar as string;
      return id && avatar
        ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png`
        : null;
    }
    default:
      // oauth2 and unknown — try common field names
      return (
        (profile.picture as string) ?? (profile.avatar_url as string) ?? null
      );
  }
}

async function issueJWT(user: UserRow, kv: KVNamespace): Promise<string> {
  return signJWT(
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
    await getJwtSecret(kv),
    30 * 24 * 60 * 60,
  );
}

function userToProfile(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    display_name: user.display_name,
    avatar_url: user.avatar_url,
    role: user.role,
    email_verified: user.email_verified === 1,
  };
}

export default app;
