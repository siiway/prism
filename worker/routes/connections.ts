// Social platform connections (GitHub, Google, Microsoft, Discord, Telegram, X, generic OIDC/OAuth2)

import { Hono } from "hono";
import type { Context } from "hono";
import {
  randomId,
  randomBase64url,
  sha256Hex,
  bufToBase64url,
} from "../lib/crypto";
import { getConfig, getJwtSecret } from "../lib/config";
import { getIp } from "../lib/clientIp";
import { geoJson, recordSessionIp } from "../lib/geo";
import { decryptSecret, encryptSecret } from "../lib/secretCrypto";
import {
  validateSiteInvite,
  claimSiteInvite,
  releaseSiteInvite,
} from "../lib/siteInvite";
import { requireAuth, optionalAuth } from "../middleware/auth";
import { signJWT } from "../lib/jwt";
import { setSessionCookie } from "../lib/cookies";
import {
  deliverUserEmailNotifications,
  notificationActorMetaFromHeaders,
} from "../lib/notifications";
import { proxyImageUrl } from "../lib/proxyImage";
import { loggedFetch } from "../lib/logger";
import { verifyAnyTotp } from "../lib/totp";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingState {
  type: "register" | "select";
  provider: string;
  providerUserId: string;
  providerEmail: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: number | null;
  profileData: Record<string, unknown>;
  // Invite token passed through from GET /:provider/begin (?invite=…) so that
  // invite-only mode can be enforced on the social/OAuth registration path,
  // the same way it is on the password path. Null for login flows and for
  // sign-ups made while invite-only mode is off.
  inviteToken?: string | null;
  users?: Array<{
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
  }>;
}
import type {
  OAuthSourceRow,
  SiteInviteRow,
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
}

const PROVIDER_DEFS: Record<string, ProviderDef> = {
  github: {
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userUrl: "https://api.github.com/user",
    scopes: "read:user user:email",
  },
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
    scopes: "openid email profile",
  },
  microsoft: {
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    userUrl: "https://graph.microsoft.com/v1.0/me",
    // offline_access is the Microsoft Identity Platform scope that
    // unlocks refresh_token issuance; without it the token endpoint
    // returns access_token only and any later /refresh call has nothing
    // to exchange.
    scopes: "openid email profile offline_access User.Read",
  },
  discord: {
    authUrl: "https://discord.com/api/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    userUrl: "https://discord.com/api/users/@me",
    scopes: "identify email",
  },
  // Telegram uses oauth.telegram.org — no token exchange, data arrives in callback params
  telegram: {
    authUrl: "https://oauth.telegram.org/auth",
    tokenUrl: "",
    userUrl: "",
    scopes: "",
  },
  // X (Twitter) OAuth 2.0:
  //   • PKCE is mandatory on every request (handled in /begin and /callback).
  //   • Token endpoint authenticates confidential clients via HTTP Basic
  //     (base64(client_id:client_secret)), NOT client_secret in the body.
  //   • offline.access is required to get a refresh_token.
  //   • /2/users/me only returns useful fields when user.fields is set, so
  //     the params travel as part of userUrl — the standard fetcher sends
  //     them through unchanged.
  //   • The v2 API never returns email; users register with the synthetic
  //     x_<id>@prism.local placeholder, same fallback as Telegram.
  x: {
    authUrl: "https://x.com/i/oauth2/authorize",
    tokenUrl: "https://api.twitter.com/2/oauth2/token",
    userUrl:
      "https://api.twitter.com/2/users/me?user.fields=profile_image_url,name,username",
    scopes: "users.read tweet.read offline.access",
  },
  // Generic providers — all URLs/scopes are configured per-source in oauth_sources table
  oidc: {
    authUrl: "",
    tokenUrl: "",
    userUrl: "",
    // offline_access is the standard OIDC scope that requests a refresh
    // token. Most identity providers honour it; the few that don't
    // simply ignore unknown scopes.
    scopes: "openid email profile offline_access",
  },
  oauth2: {
    authUrl: "",
    tokenUrl: "",
    userUrl: "",
    scopes: "",
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
  // When false, users logging in through this source must additionally
  // pass a TOTP challenge (if enrolled) before a session is issued.
  trusted: boolean;
}

// Pending "prove-you-still-hold-your-TOTP" state stashed in KV between the
// social flow succeeding and the user submitting a TOTP code. Kept as a
// distinct KV keyspace from the register/select PendingState because the
// shape and lifetime concerns differ.
interface Pending2faState {
  userId: string;
  slug: string;
  providerName: string;
}

/**
 * Look up an OAuth source by slug from the oauth_sources table.
 * Returns null if the slug is unknown, disabled, or misconfigured.
 */
async function resolveSource(
  env: Env,
  slug: string,
): Promise<ResolvedSource | null> {
  const row = await env.DB.prepare(
    "SELECT * FROM oauth_sources WHERE slug = ? AND enabled = 1",
  )
    .bind(slug)
    .first<OAuthSourceRow>();

  if (!row) return null;

  const def = PROVIDER_DEFS[row.provider];
  if (!def) return null; // unknown base provider type

  // For generic providers (oidc/oauth2), URLs are stored per-row
  const isGeneric = row.provider === "oidc" || row.provider === "oauth2";
  const authUrl = isGeneric ? (row.auth_url ?? "") : def.authUrl;
  const tokenUrl = isGeneric ? (row.token_url ?? "") : def.tokenUrl;
  const userUrl = isGeneric ? (row.userinfo_url ?? "") : def.userUrl;
  const scopes = row.scopes ?? def.scopes;

  if (isGeneric && (!authUrl || !tokenUrl || !userUrl)) return null;

  // Decrypt client_secret if it was encrypted at rest. No-op when
  // SECRETS_KEY is unbound or the value is plaintext.
  const clientSecret = (await decryptSecret(env, row.client_secret)) ?? "";

  return {
    slug: row.slug,
    provider: row.provider,
    name: row.name,
    clientId: row.client_id,
    clientSecret,
    authUrl,
    tokenUrl,
    userUrl,
    scopes,
    trusted: row.trusted !== 0,
  };
}

/**
 * True when the source is untrusted AND the user has TOTP enrolled — in
 * that case we must gate JWT issuance behind a TOTP challenge. Trusted
 * sources always return false (fast path). Untrusted sources for users
 * without TOTP also return false — TOTP is what we gate on, matching the
 * password login flow which likewise only step-ups when TOTP is enrolled.
 */
async function socialLoginNeedsTotp(
  env: Env,
  userId: string,
  source: ResolvedSource,
): Promise<boolean> {
  if (source.trusted) return false;
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM totp_authenticators WHERE user_id = ? AND enabled = 1",
  )
    .bind(userId)
    .first<{ n: number }>();
  return (row?.n ?? 0) > 0;
}

async function issue2faPending(
  env: Env,
  state: Pending2faState,
): Promise<string> {
  const pendingKey = `social:2fa:${randomBase64url(24)}`;
  await env.KV_CACHE.put(pendingKey, JSON.stringify(state), {
    expirationTtl: 600,
  });
  return pendingKey;
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
  const source = await resolveSource(c.env, slug);
  if (!source)
    return c.json({ error: "Unknown or unconfigured provider" }, 400);

  const nonce = randomBase64url(24);
  const mode = c.req.query("mode") ?? "login"; // 'login' | 'connect'
  // Optional invite token, carried through the whole OAuth round-trip so that
  // invite-only mode can be enforced when a social login results in a new
  // account. Ignored for connect mode and when invite-only mode is off.
  const inviteToken = c.req.query("invite") ?? null;

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

  // X (Twitter) requires PKCE on every authorization request — generate a
  // verifier here, send the SHA-256 challenge to the auth endpoint, and
  // stash the verifier alongside the state so /callback can replay it
  // during token exchange.
  let codeVerifier: string | null = null;
  if (source.provider === "x") {
    codeVerifier = randomBase64url(32); // 43 base64url chars — PKCE minimum
  }

  await c.env.KV_CACHE.put(
    `social:state:${nonce}`,
    JSON.stringify({
      slug,
      provider: source.provider,
      mode,
      userId,
      codeVerifier,
      inviteToken,
    }),
    { expirationTtl: 600 },
  );

  // ── Telegram: redirect to oauth.telegram.org ───────────────────────────────
  // Telegram sends auth results as a URL fragment (#tgAuthResult=BASE64_JSON),
  // not as query params. Fragments are never sent to the server, so return_to
  // must be a frontend URL. The frontend page reads the fragment and POSTs the
  // decoded data to POST /api/connections/:slug/tg-verify for server verification.
  if (source.provider === "telegram") {
    const returnTo = `${c.env.APP_URL}/auth/tg-callback?tg_nonce=${nonce}&tg_slug=${slug}`;
    const params = new URLSearchParams({
      bot_id: source.clientId,
      origin: c.env.APP_URL,
      embed: "0",
      request_access: "write",
      return_to: returnTo,
    });
    return c.json({ redirect: `${source.authUrl}?${params}` });
  }

  // ── Standard OAuth2: redirect to provider authorization endpoint ───────────
  const redirectUri = `${c.env.APP_URL}/api/connections/${slug}/callback`;
  const params = new URLSearchParams({
    client_id: source.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: source.scopes,
    state: nonce,
  });

  // Refresh-token plumbing is provider-specific:
  //   • Google issues a refresh_token only on the FIRST consent unless
  //     access_type=offline AND prompt=consent are present together —
  //     subsequent re-auths return access_token only.
  //   • Microsoft needs the offline_access scope (set in PROVIDER_DEFS)
  //     plus prompt=consent to refresh the consent grant; response_mode
  //     pins the callback to query string instead of fragment.
  //   • Discord returns a refresh_token with the auth-code grant, but
  //     when the user has already authorized the app it skips the
  //     consent screen and may omit refresh_token. Forcing prompt=consent
  //     guarantees we get one — without it the stored access token works
  //     once and every later refresh fails.
  if (source.provider === "google") {
    params.set("access_type", "offline");
    params.set("prompt", "consent");
  }
  if (source.provider === "microsoft") {
    params.set("response_mode", "query");
    params.set("prompt", "consent");
  }
  if (source.provider === "discord") {
    params.set("prompt", "consent");
  }
  if (source.provider === "x" && codeVerifier) {
    const challengeBuf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(codeVerifier),
    );
    params.set("code_challenge", bufToBase64url(challengeBuf));
    params.set("code_challenge_method", "S256");
  }

  return c.json({ redirect: `${source.authUrl}?${params}` });
});

// ─── Telegram verify (:provider/tg-verify) ───────────────────────────────────
// The frontend reads #tgAuthResult=BASE64_JSON from the URL fragment (which
// the server never sees) and POSTs the decoded data here for HMAC verification.

app.post("/:provider/tg-verify", async (c) => {
  const slug = c.req.param("provider") ?? "";

  const body = await c.req
    .json<{ nonce: string; tg_data: Record<string, string> }>()
    .catch(() => null);
  if (!body?.nonce || !body?.tg_data)
    return c.json({ error: "Invalid request body" }, 400);

  const config = await getConfig(c.env.DB);
  const source = await resolveSource(c.env, slug);
  if (!source || source.provider !== "telegram")
    return c.json({ error: "provider_not_configured" }, 400);

  const stateData = await c.env.KV_CACHE.get(`social:state:${body.nonce}`);
  if (!stateData) return c.json({ error: "invalid_state" }, 400);
  await c.env.KV_CACHE.delete(`social:state:${body.nonce}`);

  const { mode, userId, inviteToken } = JSON.parse(stateData) as {
    mode: string;
    userId: string | null;
    inviteToken?: string | null;
  };

  // Verify HMAC-SHA256(data_check_string, SHA256(bot_token))
  const tgData = body.tg_data;
  const telegramHash = tgData.hash;
  if (!telegramHash) return c.json({ error: "invalid_signature" }, 400);

  const checkParams = { ...tgData };
  delete checkParams.hash;
  const dataCheckString = Object.keys(checkParams)
    .sort()
    .map((k) => `${k}=${checkParams[k]}`)
    .join("\n");
  const enc = new TextEncoder();
  const secretKey = await crypto.subtle.digest(
    "SHA-256",
    enc.encode(source.clientSecret),
  );
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    secretKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    enc.encode(dataCheckString),
  );
  const expectedHash = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (expectedHash !== telegramHash)
    return c.json({ error: "invalid_signature" }, 400);

  // Reject stale auth (> 24 h)
  const authDate = parseInt(tgData.auth_date ?? "0", 10);
  if (Math.floor(Date.now() / 1000) - authDate > 86400)
    return c.json({ error: "auth_expired" }, 400);

  const profileData: Record<string, unknown> = {
    id: tgData.id ? parseInt(tgData.id, 10) : undefined,
    first_name: tgData.first_name,
    last_name: tgData.last_name,
    username: tgData.username,
    photo_url: tgData.photo_url,
    auth_date: authDate,
  };
  const providerUserId = String(tgData.id ?? "");
  if (!providerUserId) return c.json({ error: "no_user_id" }, 400);

  const now = Math.floor(Date.now() / 1000);

  if (mode === "connect" && userId) {
    const alreadyLinked = await c.env.DB.prepare(
      "SELECT id FROM social_connections WHERE user_id = ? AND provider = ? AND provider_user_id = ?",
    )
      .bind(userId, slug, providerUserId)
      .first();
    if (alreadyLinked) return c.json({ error: "already_connected" }, 409);

    await c.env.DB.prepare(
      "INSERT INTO social_connections (id, user_id, provider, provider_user_id, access_token, profile_data, connected_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        randomId(),
        userId,
        slug,
        providerUserId,
        null,
        JSON.stringify(profileData),
        now,
      )
      .run();

    c.executionCtx.waitUntil(
      deliverUserEmailNotifications(
        c.env,
        userId,
        "connection.added",
        {
          provider_name: source.name,
          ...notificationActorMetaFromHeaders(c.req.raw.headers),
        },
        c.env.APP_URL,
      ).catch(() => {}),
    );
    return c.json({ type: "connect" });
  }

  // Login mode
  const linkedRows = await c.env.DB.prepare(
    "SELECT u.* FROM users u JOIN social_connections sc ON sc.user_id = u.id WHERE sc.provider = ? AND sc.provider_user_id = ?",
  )
    .bind(slug, providerUserId)
    .all<UserRow>();

  const linkedUsers = linkedRows.results;

  if (linkedUsers.length === 0) {
    if (!config.allow_registration)
      return c.json({ error: "registration_disabled" }, 403);

    // Invite-only mode: reject early so the user sees the failure before the
    // confirm screen. /complete re-validates authoritatively. Telegram never
    // exposes an email, so email-bound invites can't match here — that's
    // intentional and consistent with /complete (providerEmail is null).
    if (config.invite_only) {
      const result = await validateSiteInvite(c.env, inviteToken, null);
      if (!result.ok) return c.json({ error: result.error }, result.status);
    }

    const pendingKey = `social:pending:${randomBase64url(24)}`;
    await c.env.KV_CACHE.put(
      pendingKey,
      JSON.stringify({
        type: "register",
        provider: slug,
        providerUserId,
        providerEmail: null,
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        profileData,
        inviteToken,
      } satisfies PendingState),
      { expirationTtl: 600 },
    );
    return c.json({ type: "register", pending_key: pendingKey });
  }

  if (linkedUsers.length === 1) {
    const user = linkedUsers[0];
    await c.env.DB.prepare(
      "UPDATE social_connections SET profile_data = ? WHERE user_id = ? AND provider = ? AND provider_user_id = ?",
    )
      .bind(JSON.stringify(profileData), user.id, slug, providerUserId)
      .run();

    await checkSocialVerifyExpiry(
      c.env.DB,
      user.id,
      config.social_verify_ttl_days,
    );

    if (await socialLoginNeedsTotp(c.env, user.id, source)) {
      const pendingKey = await issue2faPending(c.env, {
        userId: user.id,
        slug,
        providerName: source.name,
      });
      return c.json({ type: "2fa", pending_key: pendingKey });
    }

    c.executionCtx.waitUntil(
      deliverUserEmailNotifications(
        c.env,
        user.id,
        "connection.login",
        {
          provider_name: source.name,
          ...notificationActorMetaFromHeaders(c.req.raw.headers),
        },
        c.env.APP_URL,
      ).catch(() => {}),
    );
    return c.json({
      type: "login",
      token: await issueJWT(c, user),
    });
  }

  const pendingKey = `social:pending:${randomBase64url(24)}`;
  await c.env.KV_CACHE.put(
    pendingKey,
    JSON.stringify({
      type: "select",
      provider: slug,
      providerUserId,
      providerEmail: null,
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
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
  return c.json({ type: "select", pending_key: pendingKey });
});

// ─── Standard OAuth2 callback (:provider/callback) ───────────────────────────

app.get("/:provider/callback", async (c) => {
  const slug = c.req.param("provider") ?? "";
  const error = c.req.query("error");
  if (error)
    return c.redirect(
      `${c.env.APP_URL}/connections?error=${encodeURIComponent(error)}`,
    );

  const config = await getConfig(c.env.DB);
  const source = await resolveSource(c.env, slug);
  if (!source)
    return c.redirect(
      `${c.env.APP_URL}/connections?error=provider_not_configured`,
    );

  // ── Standard OAuth2 callback ─────────────────────────────────────────────────
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state)
    return c.redirect(`${c.env.APP_URL}/connections?error=missing_params`);

  const stateData = await c.env.KV_CACHE.get(`social:state:${state}`);
  if (!stateData)
    return c.redirect(`${c.env.APP_URL}/connections?error=invalid_state`);
  await c.env.KV_CACHE.delete(`social:state:${state}`);

  const { provider, mode, userId, codeVerifier, inviteToken } = JSON.parse(
    stateData,
  ) as {
    slug: string;
    provider: string;
    mode: string;
    userId: string | null;
    codeVerifier?: string | null;
    inviteToken?: string | null;
  };

  const redirectUri = `${c.env.APP_URL}/api/connections/${slug}/callback`;

  // X (Twitter) authenticates confidential clients on the token endpoint
  // with HTTP Basic (NOT client_secret in body) and requires the PKCE
  // verifier in the body. Build the request shape accordingly.
  const isX = provider === "x";
  const tokenHeaders: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  const tokenBody: Record<string, string> = {
    client_id: source.clientId,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  };
  if (isX) {
    tokenHeaders.Authorization = `Basic ${btoa(`${source.clientId}:${source.clientSecret}`)}`;
    if (!codeVerifier)
      return c.redirect(
        `${c.env.APP_URL}/connections?error=pkce_verifier_missing`,
      );
    tokenBody.code_verifier = codeVerifier;
  } else {
    tokenBody.client_secret = source.clientSecret;
  }

  // Exchange code for token
  let tokenData: Record<string, unknown>;
  try {
    const tokenRes = await loggedFetch(c.env, source.tokenUrl, {
      method: "POST",
      headers: tokenHeaders,
      body: new URLSearchParams(tokenBody),
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
  const refreshToken =
    typeof tokenData.refresh_token === "string"
      ? tokenData.refresh_token
      : null;

  // Fetch user profile
  let profileData: Record<string, unknown>;
  try {
    const userRes = await loggedFetch(c.env, source.userUrl, {
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

  // X (Twitter) v2 wraps the profile in a `data` envelope. Flatten it so
  // the rest of the system can treat the profile like any other provider.
  if (
    provider === "x" &&
    profileData.data &&
    typeof profileData.data === "object"
  ) {
    profileData = profileData.data as Record<string, unknown>;
  }

  // GitHub's /user response carries `email` only when the user has set their
  // primary as public, and it has no verified flag. Fetch /user/emails to
  // pick up the verified primary explicitly so extractProviderEmail can
  // gate on `email_verified`. Failure here is non-fatal — we just leave
  // the email unverified.
  if (provider === "github") {
    try {
      const emailsRes = await loggedFetch(
        c.env,
        "https://api.github.com/user/emails",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            "User-Agent": "Prism/1.0",
          },
        },
      );
      if (emailsRes.ok) {
        const emails = (await emailsRes.json()) as Array<{
          email: string;
          primary: boolean;
          verified: boolean;
        }>;
        const primary = emails.find((e) => e.primary && e.verified);
        if (primary) {
          profileData.email = primary.email;
          profileData.email_verified = true;
        } else {
          profileData.email_verified = false;
        }
      }
    } catch {
      // ignore — extractProviderEmail will refuse to trust an absent flag
    }
  }

  // `provider` is the base type (github/google/…); `slug` is the source identifier
  const providerUserId = extractProviderUserId(provider, profileData);
  const providerEmail = extractProviderEmail(provider, profileData);
  if (!providerUserId)
    return c.redirect(`${c.env.APP_URL}/connections?error=no_user_id`);

  const now = Math.floor(Date.now() / 1000);
  const expiresIn =
    typeof tokenData.expires_in === "number"
      ? tokenData.expires_in
      : typeof tokenData.expires_in === "string"
        ? Number(tokenData.expires_in)
        : null;
  const tokenExpiresAt =
    expiresIn && Number.isFinite(expiresIn) && expiresIn > 0
      ? now + Math.floor(expiresIn)
      : null;

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

    const storedAccess = await encryptSecret(c.env, accessToken);
    const storedRefresh = await encryptSecret(c.env, refreshToken);
    await c.env.DB.prepare(
      "INSERT INTO social_connections (id, user_id, provider, provider_user_id, access_token, refresh_token, token_expires_at, profile_data, connected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        randomId(),
        userId,
        slug,
        providerUserId,
        storedAccess,
        storedRefresh,
        tokenExpiresAt,
        JSON.stringify(profileData),
        now,
      )
      .run();

    // Auto-verify email if provider confirms the same address
    const connectingUser = await c.env.DB.prepare(
      "SELECT email, email_verified FROM users WHERE id = ?",
    )
      .bind(userId)
      .first<{ email: string; email_verified: number }>();
    if (connectingUser) {
      c.executionCtx.waitUntil(
        trySocialEmailVerify(
          c.env.DB,
          userId,
          connectingUser.email,
          connectingUser.email_verified,
          providerEmail,
          slug,
        ).catch(() => {}),
      );
    }

    c.executionCtx.waitUntil(
      deliverUserEmailNotifications(
        c.env,
        userId,
        "connection.added",
        {
          provider_name: source.name,
          ...notificationActorMetaFromHeaders(c.req.raw.headers),
        },
        c.env.APP_URL,
      ).catch(() => {}),
    );
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

    // Invite-only mode: reject early (before the confirm screen) if the
    // invite is missing/invalid. /complete re-validates authoritatively and
    // consumes the invite. Unlike Telegram, providerEmail may be present here,
    // so email-bound invites are matched against it.
    if (config.invite_only) {
      const result = await validateSiteInvite(
        c.env,
        inviteToken,
        providerEmail,
      );
      if (!result.ok)
        return c.redirect(`${c.env.APP_URL}/login?error=invite_required`);
    }

    const pendingKey = `social:pending:${randomBase64url(24)}`;
    await c.env.KV_CACHE.put(
      pendingKey,
      JSON.stringify({
        type: "register",
        provider: slug, // store slug so /complete can insert the right value
        providerUserId,
        providerEmail,
        accessToken,
        refreshToken,
        tokenExpiresAt,
        profileData,
        inviteToken,
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
    const storedAccess = await encryptSecret(c.env, accessToken);
    const storedRefresh = await encryptSecret(c.env, refreshToken);
    await c.env.DB.prepare(
      "UPDATE social_connections SET access_token = ?, refresh_token = ?, token_expires_at = ?, profile_data = ? WHERE user_id = ? AND provider = ? AND provider_user_id = ?",
    )
      .bind(
        storedAccess,
        storedRefresh,
        tokenExpiresAt,
        JSON.stringify(profileData),
        user.id,
        slug,
        providerUserId,
      )
      .run();

    // Auto-verify / refresh social verification / check TTL expiry
    await trySocialEmailVerify(
      c.env.DB,
      user.id,
      user.email,
      user.email_verified,
      providerEmail,
      slug,
    );
    await checkSocialVerifyExpiry(
      c.env.DB,
      user.id,
      config.social_verify_ttl_days,
    );

    // Untrusted-source gate: if the source is not fully trusted and the
    // user has TOTP enrolled, stash a pending 2FA state and bounce the
    // browser to /social-2fa. The connection.login email fires only after
    // TOTP passes, so an abandoned prompt doesn't spam the user.
    if (await socialLoginNeedsTotp(c.env, user.id, source)) {
      const pendingKey = await issue2faPending(c.env, {
        userId: user.id,
        slug,
        providerName: source.name,
      });
      return c.redirect(
        `${c.env.APP_URL}/social-2fa?key=${encodeURIComponent(pendingKey)}`,
      );
    }

    c.executionCtx.waitUntil(
      deliverUserEmailNotifications(
        c.env,
        user.id,
        "connection.login",
        {
          provider_name: source.name,
          ...notificationActorMetaFromHeaders(c.req.raw.headers),
        },
        c.env.APP_URL,
      ).catch(() => {}),
    );
    return c.redirect(
      `${c.env.APP_URL}/auth/callback?token=${encodeURIComponent(await issueJWT(c, user))}`,
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
      refreshToken,
      tokenExpiresAt,
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
  const source = await resolveSource(c.env, state.provider);
  const baseProvider = source?.provider ?? state.provider;

  return c.json({
    type: state.type,
    provider: state.provider, // slug (used for display / URL)
    provider_name: source?.name ?? state.provider,
    profile_name: extractDisplayName(baseProvider, state.profileData),
    profile_avatar: await proxyImageUrl(
      c.env.APP_URL,
      c.env.DB,
      extractProviderAvatar(baseProvider, state.profileData),
    ),
    suggested_username: extractUsername(
      baseProvider,
      state.profileData,
      state.providerEmail,
    ),
    suggested_display_name: extractDisplayName(baseProvider, state.profileData),
    users: state.users
      ? await Promise.all(
          state.users.map(
            async (u: {
              id: string;
              username: string;
              display_name: string;
              avatar_url: string | null;
            }) => ({
              ...u,
              avatar_url: await proxyImageUrl(
                c.env.APP_URL,
                c.env.DB,
                u.avatar_url,
              ),
              unproxied_avatar_url: u.avatar_url,
            }),
          ),
        )
      : undefined,
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
  const completeSource = await resolveSource(c.env, state.provider);
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

    const storedAccess = await encryptSecret(c.env, state.accessToken);
    const storedRefresh = await encryptSecret(c.env, state.refreshToken);
    await c.env.DB.prepare(
      "UPDATE social_connections SET access_token = ?, refresh_token = ?, token_expires_at = ?, profile_data = ? WHERE user_id = ? AND provider = ? AND provider_user_id = ?",
    )
      .bind(
        storedAccess,
        storedRefresh,
        state.tokenExpiresAt,
        JSON.stringify(state.profileData),
        user.id,
        state.provider,
        state.providerUserId,
      )
      .run();

    // Auto-verify / refresh social verification / check TTL expiry
    await trySocialEmailVerify(
      c.env.DB,
      user.id,
      user.email,
      user.email_verified,
      state.providerEmail,
      state.provider,
    );
    await checkSocialVerifyExpiry(
      c.env.DB,
      user.id,
      completeCfg.social_verify_ttl_days,
    );

    if (
      completeSource &&
      (await socialLoginNeedsTotp(c.env, user.id, completeSource))
    ) {
      const pendingKey = await issue2faPending(c.env, {
        userId: user.id,
        slug: state.provider,
        providerName: completeSource.name,
      });
      return c.json({ type: "2fa", pending_key: pendingKey });
    }

    c.executionCtx.waitUntil(
      deliverUserEmailNotifications(
        c.env,
        user.id,
        "connection.login",
        {
          provider_name: completeSource?.name ?? state.provider,
          ...notificationActorMetaFromHeaders(c.req.raw.headers),
        },
        c.env.APP_URL,
      ).catch(() => {}),
    );

    return c.json({
      token: await issueJWT(c, user),
      user: await userToProfile(c.env.APP_URL, c.env.DB, user),
    });
  }

  if (body.action === "register") {
    if (state.type !== "register")
      return c.json({ error: "Invalid action for this session" }, 400);

    const allowReg = await getConfig(c.env.DB).then(
      (cfg) => cfg.allow_registration,
    );
    if (!allowReg) return c.json({ error: "Registration is disabled" }, 403);

    // Authoritative invite-only enforcement for the social/OAuth path. This is
    // the single point where the account is actually created, so it must be
    // validated here regardless of the earlier (best-effort) checks in
    // /callback and /tg-verify. The invite is consumed only after the user row
    // is successfully inserted below, mirroring the password path in auth.ts.
    let usedInvite: SiteInviteRow | null = null;
    if (completeCfg.invite_only) {
      const result = await validateSiteInvite(
        c.env,
        state.inviteToken,
        state.providerEmail,
      );
      if (!result.ok) return c.json({ error: result.error }, result.status);
      usedInvite = result.invite;
    }

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
    // email_verified is anchored to whether the SOCIAL provider asserted
    // it — extractProviderEmail returns null when the provider didn't
    // confirm the address, in which case we fall back to the synthetic
    // placeholder and start the account at email_verified=0. Hard-coding
    // `1` here would let an attacker who set victim@example.com on a
    // fresh, unverified Discord account claim that address on Prism.
    const trustedEmail = state.providerEmail;
    // Take the invite use before the insert — see claimSiteInvite. Released
    // below if creating the account fails.
    if (usedInvite && !(await claimSiteInvite(c.env, usedInvite)))
      return c.json({ error: "Invite token has reached its usage limit" }, 403);
    try {
      await c.env.DB.prepare(
        `INSERT INTO users (id, email, username, display_name, role, email_verified, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'user', ?, 1, ?, ?)`,
      )
        .bind(
          newUserId,
          trustedEmail ??
            `${state.provider}_${state.providerUserId}@prism.local`,
          username,
          display_name,
          trustedEmail ? 1 : 0,
          now,
          now,
        )
        .run();
    } catch (err) {
      if (usedInvite) await releaseSiteInvite(c.env, usedInvite);
      throw err;
    }

    const storedAccess = await encryptSecret(c.env, state.accessToken);
    const storedRefresh = await encryptSecret(c.env, state.refreshToken);
    await c.env.DB.prepare(
      "INSERT INTO social_connections (id, user_id, provider, provider_user_id, access_token, refresh_token, token_expires_at, profile_data, connected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        randomId(),
        newUserId,
        state.provider,
        state.providerUserId,
        storedAccess,
        storedRefresh,
        state.tokenExpiresAt,
        JSON.stringify(state.profileData),
        now,
      )
      .run();

    const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
      .bind(newUserId)
      .first<UserRow>();
    if (!user) return c.json({ error: "Failed to create user" }, 500);

    return c.json({
      token: await issueJWT(c, user),
      user: await userToProfile(c.env.APP_URL, c.env.DB, user),
    });
  }

  return c.json({ error: "Invalid action" }, 400);
});

// ─── Untrusted-provider 2FA step (post-social-login TOTP gate) ───────────────
// A social login through a source with trusted=0 stashes a pending2fa state
// and bounces the browser here. The frontend fetches metadata for the prompt
// (which account, which provider) via GET /2fa/pending/:key and submits the
// TOTP code via POST /2fa/verify.

app.get("/2fa/pending/:key", async (c) => {
  const key = c.req.param("key");
  if (!key.startsWith("social:2fa:"))
    return c.json({ error: "Invalid or expired session" }, 404);
  const raw = await c.env.KV_CACHE.get(key);
  if (!raw) return c.json({ error: "Invalid or expired session" }, 404);
  const state = JSON.parse(raw) as Pending2faState;

  const user = await c.env.DB.prepare(
    "SELECT id, username, display_name, avatar_url FROM users WHERE id = ?",
  )
    .bind(state.userId)
    .first<Pick<UserRow, "id" | "username" | "display_name" | "avatar_url">>();
  if (!user) return c.json({ error: "Invalid or expired session" }, 404);

  return c.json({
    provider_name: state.providerName,
    user: {
      username: user.username,
      display_name: user.display_name,
      avatar_url: await proxyImageUrl(c.env.APP_URL, c.env.DB, user.avatar_url),
    },
  });
});

app.post("/2fa/verify", async (c) => {
  const body = await c.req
    .json<{ key: string; totp_code: string }>()
    .catch(() => null);
  if (!body?.key || !body?.totp_code)
    return c.json({ error: "Invalid request body" }, 400);
  if (!body.key.startsWith("social:2fa:"))
    return c.json({ error: "Invalid or expired session" }, 400);

  const raw = await c.env.KV_CACHE.get(body.key);
  if (!raw) return c.json({ error: "Invalid or expired session" }, 400);
  const state = JSON.parse(raw) as Pending2faState;

  const ok = await verifyAnyTotp(c.env, state.userId, body.totp_code);
  if (!ok) return c.json({ error: "Invalid TOTP code" }, 401);

  // Consume the pending key only after a successful verification — a bad
  // code leaves the key alive so the user can retry within the 10 minute
  // KV TTL without restarting the whole social round-trip.
  await c.env.KV_CACHE.delete(body.key);

  const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(state.userId)
    .first<UserRow>();
  if (!user) return c.json({ error: "User not found" }, 404);

  c.executionCtx.waitUntil(
    deliverUserEmailNotifications(
      c.env,
      user.id,
      "connection.login",
      {
        provider_name: state.providerName,
        ...notificationActorMetaFromHeaders(c.req.raw.headers),
      },
      c.env.APP_URL,
    ).catch(() => {}),
  );

  return c.json({
    token: await issueJWT(c, user),
    user: await userToProfile(c.env.APP_URL, c.env.DB, user),
  });
});

// Refresh profile data for a specific connection by ID
app.post("/:id/refresh", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const conn = await c.env.DB.prepare(
    "SELECT id, provider, provider_user_id, access_token, refresh_token, token_expires_at, connected_at FROM social_connections WHERE id = ? AND user_id = ?",
  )
    .bind(id, user.id)
    .first<
      Pick<
        SocialConnectionRow,
        | "id"
        | "provider"
        | "provider_user_id"
        | "access_token"
        | "refresh_token"
        | "token_expires_at"
        | "connected_at"
      >
    >();
  if (!conn) return c.json({ error: "Connection not found" }, 404);

  const source = await resolveSource(c.env, conn.provider);
  if (!source) return c.json({ error: "provider_not_configured" }, 400);
  if (source.provider === "telegram")
    return c.json({ error: "unsupported_refresh" }, 400);
  const fetchProfile = async (accessToken: string) => {
    const userRes = await loggedFetch(c.env, source.userUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "Prism/1.0",
      },
    });
    return userRes;
  };

  const refreshAccessToken = async () => {
    if (!conn.refresh_token) return null;
    const plainRefresh =
      (await decryptSecret(c.env, conn.refresh_token)) ?? conn.refresh_token;
    let tokenRes: Response;
    // X (Twitter) refresh uses the same HTTP Basic auth pattern as its
    // initial token exchange — secret in the Authorization header, not in
    // the body.
    const isX = source.provider === "x";
    const refreshHeaders: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    };
    const refreshBody: Record<string, string> = {
      client_id: source.clientId,
      grant_type: "refresh_token",
      refresh_token: plainRefresh,
    };
    if (isX) {
      refreshHeaders.Authorization = `Basic ${btoa(`${source.clientId}:${source.clientSecret}`)}`;
    } else {
      refreshBody.client_secret = source.clientSecret;
    }
    try {
      tokenRes = await loggedFetch(c.env, source.tokenUrl, {
        method: "POST",
        headers: refreshHeaders,
        body: new URLSearchParams(refreshBody),
      });
    } catch (err) {
      console.error("[connections] refresh token request threw:", err);
      return null;
    }
    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error(
        `[connections] refresh token failed ${tokenRes.status} for ${source.provider}: ${body}`,
      );
      return null;
    }
    const tokenJson = (await tokenRes.json()) as Record<string, unknown>;
    const nextAccessToken =
      typeof tokenJson.access_token === "string"
        ? tokenJson.access_token
        : null;
    if (!nextAccessToken) return null;
    const nextRefreshToken =
      typeof tokenJson.refresh_token === "string"
        ? tokenJson.refresh_token
        : plainRefresh;
    const nextExpiresIn =
      typeof tokenJson.expires_in === "number"
        ? tokenJson.expires_in
        : typeof tokenJson.expires_in === "string"
          ? Number(tokenJson.expires_in)
          : null;
    const now = Math.floor(Date.now() / 1000);
    const nextTokenExpiresAt =
      nextExpiresIn && Number.isFinite(nextExpiresIn) && nextExpiresIn > 0
        ? now + Math.floor(nextExpiresIn)
        : null;
    const storedNextAccess = await encryptSecret(c.env, nextAccessToken);
    const storedNextRefresh = await encryptSecret(c.env, nextRefreshToken);
    await c.env.DB.prepare(
      "UPDATE social_connections SET access_token = ?, refresh_token = ?, token_expires_at = ? WHERE id = ? AND user_id = ?",
    )
      .bind(
        storedNextAccess,
        storedNextRefresh,
        nextTokenExpiresAt,
        conn.id,
        user.id,
      )
      .run();
    return nextAccessToken;
  };

  if (!conn.access_token) return c.json({ error: "no_access_token" }, 400);
  const plainAccessToken =
    (await decryptSecret(c.env, conn.access_token)) ?? conn.access_token;

  let profileData: Record<string, unknown>;
  try {
    let profileRes = await fetchProfile(plainAccessToken);
    if (
      !profileRes.ok &&
      (profileRes.status === 401 || profileRes.status === 403)
    ) {
      const refreshedAccessToken = await refreshAccessToken();
      if (!refreshedAccessToken) {
        return c.json({ error: "reauthorization_required" }, 400);
      }
      profileRes = await fetchProfile(refreshedAccessToken);
    }
    if (!profileRes.ok) {
      const body = await profileRes.text();
      console.error(
        `[connections] refresh profile fetch ${profileRes.status} for ${source.provider}: ${body}`,
      );
      return c.json({ error: "profile_fetch_failed" }, 502);
    }
    profileData = (await profileRes.json()) as Record<string, unknown>;
  } catch (err) {
    console.error("[connections] refresh profile fetch threw:", err);
    return c.json({ error: "profile_fetch_failed" }, 502);
  }

  if (
    source.provider === "x" &&
    profileData.data &&
    typeof profileData.data === "object"
  ) {
    profileData = profileData.data as Record<string, unknown>;
  }

  const providerUserId = extractProviderUserId(source.provider, profileData);
  if (!providerUserId) return c.json({ error: "no_user_id" }, 502);
  if (providerUserId !== conn.provider_user_id)
    return c.json({ error: "account_mismatch" }, 409);

  await c.env.DB.prepare(
    "UPDATE social_connections SET profile_data = ? WHERE id = ? AND user_id = ?",
  )
    .bind(JSON.stringify(profileData), conn.id, user.id)
    .run();

  return c.json({
    connection: {
      id: conn.id,
      provider: conn.provider,
      provider_user_id: conn.provider_user_id,
      profile: profileData,
      connected_at: conn.connected_at,
    },
  });
});

// Disconnect a specific connection by ID
app.delete("/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  // Look up provider slug before deleting so we can include it in the notification
  const conn = await c.env.DB.prepare(
    "SELECT provider FROM social_connections WHERE id = ? AND user_id = ?",
  )
    .bind(id, user.id)
    .first<{ provider: string }>();
  if (!conn) return c.json({ error: "Connection not found" }, 404);

  await c.env.DB.prepare(
    "DELETE FROM social_connections WHERE id = ? AND user_id = ?",
  )
    .bind(id, user.id)
    .run();

  // Resolve provider name for the notification
  const source = await resolveSource(c.env, conn.provider);
  c.executionCtx.waitUntil(
    deliverUserEmailNotifications(
      c.env,
      user.id,
      "connection.removed",
      {
        provider_name: source?.name ?? conn.provider,
        ...notificationActorMetaFromHeaders(c.req.raw.headers),
      },
      c.env.APP_URL,
    ).catch(() => {}),
  );

  return c.json({ message: "Disconnected" });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Auto-verify a user's email if the social provider confirms the same address.
 * Checks TTL expiry for previously social-verified emails.
 */
async function trySocialEmailVerify(
  db: D1Database,
  userId: string,
  userEmail: string,
  userEmailVerified: number,
  providerEmail: string | null,
  providerSlug: string,
): Promise<void> {
  if (!providerEmail) return;
  if (userEmail.toLowerCase() !== providerEmail.toLowerCase()) return;

  const now = Math.floor(Date.now() / 1000);

  if (!userEmailVerified) {
    // Not yet verified — auto-verify via this provider
    await db
      .prepare(
        "UPDATE users SET email_verified = 1, email_verified_via = ?, email_verified_at = ?, email_verify_code = NULL, email_verify_token = NULL, updated_at = ? WHERE id = ?",
      )
      .bind(providerSlug, now, now, userId)
      .run();
    console.log(
      `[social-verify] Auto-verified email for user ${userId} via ${providerSlug}`,
    );
    return;
  }

  // Already verified — refresh social-verification timestamp if applicable
  const user = await db
    .prepare(
      "SELECT email_verified_via, email_verified_at FROM users WHERE id = ?",
    )
    .bind(userId)
    .first<{
      email_verified_via: string | null;
      email_verified_at: number | null;
    }>();

  if (user?.email_verified_via) {
    // Refresh the timestamp so the TTL resets
    await db
      .prepare(
        "UPDATE users SET email_verified_via = ?, email_verified_at = ?, updated_at = ? WHERE id = ?",
      )
      .bind(providerSlug, now, now, userId)
      .run();
  }
}

/**
 * Check if a social-verified email has expired past the configured TTL.
 * If so, mark it as unverified. Called during login flows.
 */
async function checkSocialVerifyExpiry(
  db: D1Database,
  userId: string,
  socialVerifyTtlDays: number,
): Promise<void> {
  if (socialVerifyTtlDays <= 0) return; // 0 = never expire

  const user = await db
    .prepare(
      "SELECT email_verified, email_verified_via, email_verified_at FROM users WHERE id = ?",
    )
    .bind(userId)
    .first<{
      email_verified: number;
      email_verified_via: string | null;
      email_verified_at: number | null;
    }>();

  if (!user || !user.email_verified || !user.email_verified_via) return;

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = (user.email_verified_at ?? 0) + socialVerifyTtlDays * 86400;
  if (now > expiresAt) {
    await db
      .prepare(
        "UPDATE users SET email_verified = 0, email_verified_via = NULL, email_verified_at = NULL, updated_at = ? WHERE id = ?",
      )
      .bind(now, userId)
      .run();
    console.log(
      `[social-verify] Expired social verification for user ${userId} (verified via ${user.email_verified_via}, TTL ${socialVerifyTtlDays}d)`,
    );
  }
}

function extractProviderUserId(
  provider: string,
  profile: Record<string, unknown>,
): string | null {
  switch (provider) {
    case "github":
    case "microsoft":
    case "discord":
    case "telegram":
    case "x":
      return String(profile.id ?? "");
    case "google":
    case "oidc":
      return String(profile.sub ?? "");
    default:
      // oauth2 and unknown — try sub first (OIDC-style), then id
      return String(profile.sub ?? profile.id ?? "");
  }
}

/**
 * Pull a TRUSTED email out of the provider's profile response. "Trusted"
 * means the provider has confirmed the user controls that mailbox — we
 * use this email to mark `users.email_verified=1` and to assert
 * `email_verified=true` in OIDC id_tokens, so an unverified provider
 * email here would let an attacker who set the field on a junk Discord/
 * GitHub/etc. account claim someone else's address on Prism.
 *
 * Each branch must check the provider's own verified flag:
 *   • discord — `verified: true` on the user object
 *   • google / generic OIDC — `email_verified: true` claim
 *   • microsoft graph — no per-email flag, treat as unverified
 *   • github — `/user` returns `email` only when it's the public primary;
 *     callers fetch `/user/emails` separately and pass the verified-primary
 *     address through `profile.email` if and only if `verified=true`
 *   • telegram — never provides email
 *
 * Returns null when the provider didn't confirm the address. Callers
 * fall back to the synthetic `${provider}_${id}@prism.local` placeholder
 * and leave `email_verified=0`.
 */
function extractProviderEmail(
  provider: string,
  profile: Record<string, unknown>,
): string | null {
  // X (Twitter) v2 API never exposes email — treat the same as Telegram.
  if (provider === "telegram" || provider === "x") return null;
  const email = typeof profile.email === "string" ? profile.email : null;

  switch (provider) {
    case "discord":
      return profile.verified === true ? email : null;
    case "google":
    case "oidc":
      return profile.email_verified === true ? email : null;
    case "github":
      // The connection callback explicitly hits /user/emails and only puts a
      // verified-primary into profile.email; if that wasn't done (e.g. a
      // legacy profile cached without the extra fetch), refuse to trust it.
      return profile.email_verified === true ? email : null;
    case "microsoft":
      // Graph has no per-email confirmation — Outlook/Azure-AD addresses
      // are administratively assigned, but personal accounts can carry an
      // unverified `mail` field. Treat all as unverified.
      return null;
    default:
      return null;
  }
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
    case "telegram": {
      const parts = [profile.first_name as string, profile.last_name as string]
        .filter(Boolean)
        .join(" ");
      return parts || (profile.username as string) || "User";
    }
    case "x":
      return (profile.name as string) || (profile.username as string) || "User";
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
  } else if (
    provider === "discord" ||
    provider === "telegram" ||
    provider === "x"
  ) {
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
    case "telegram":
      return (profile.photo_url as string) ?? null;
    case "x":
      return (profile.profile_image_url as string) ?? null;
    default:
      // oauth2 and unknown — try common field names
      return (
        (profile.picture as string) ?? (profile.avatar_url as string) ?? null
      );
  }
}

async function issueJWT(
  c: Context<AppEnv>,
  user: UserRow,
  ttlSeconds = 30 * 24 * 60 * 60,
): Promise<string> {
  const db = c.env.DB;
  const sessionId = randomId(32);
  const now = Math.floor(Date.now() / 1000);
  const token = await signJWT(
    {
      sub: user.id,
      role: user.role,
      email: user.email,
      username: user.username,
      display_name: user.display_name,
      avatar_url: await proxyImageUrl(c.env.APP_URL, db, user.avatar_url),
      unproxied_avatar_url: user.avatar_url,
      email_verified: user.email_verified === 1,
      sessionId,
    },
    await getJwtSecret(c.env.KV_SESSIONS),
    ttlSeconds,
  );
  const hash = await sha256Hex(token);
  await db
    .prepare(
      "INSERT INTO sessions (id, user_id, token_hash, user_agent, ip_address, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      sessionId,
      user.id,
      hash,
      c.req.header("User-Agent") ?? null,
      c.req.header("CF-Connecting-IP") ??
        c.req.header("X-Forwarded-For") ??
        "unknown",
      now + ttlSeconds,
      now,
    )
    .run();
  // Seed the session's IP history with the login IP + geolocation (same as the
  // password-login path in issueSession) so the security page has a location
  // immediately, not only after the next authenticated request.
  c.executionCtx.waitUntil(
    recordSessionIp(c.env.DB, sessionId, getIp(c), geoJson(c), now).catch(
      () => undefined,
    ),
  );
  // Set the session cookie on this response. For redirect responses (social
  // OAuth callback flow) the cookie travels with the redirect and the
  // /auth/callback page reads it on the follow-up request.
  setSessionCookie(c, token, ttlSeconds);
  return token;
}

async function userToProfile(baseUrl: string, db: D1Database, user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    display_name: user.display_name,
    avatar_url: await proxyImageUrl(baseUrl, db, user.avatar_url),
    unproxied_avatar_url: user.avatar_url,
    role: user.role,
    email_verified: user.email_verified === 1,
  };
}

export default app;
