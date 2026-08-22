// Authentication middleware

import type { Context, MiddlewareHandler, Next } from "hono";
import { verifyJWT } from "../lib/jwt";
import { getJwtSecret } from "../lib/config";
import { readSessionCookie } from "../lib/cookies";
import { hashLookupCandidate } from "../lib/secretCrypto";
import { getIp } from "../lib/clientIp";
import { geoJson, recordSessionIp } from "../lib/geo";
import type { AuthUser, Variables } from "../types";

// Fire-and-forget: append the request's IP + Cloudflare geolocation to the
// session's history so the security page can show where a session has been
// used from. Wrapped by the caller in waitUntil; never blocks the request.
function trackSessionIp(c: Context<AppEnv>, sessionId: string): void {
  const ip = getIp(c);
  const geo = geoJson(c);
  const now = Math.floor(Date.now() / 1000);
  c.executionCtx.waitUntil(
    recordSessionIp(c.env.DB, sessionId, ip, geo, now).catch(() => undefined),
  );
}

type AppEnv = { Bindings: Env; Variables: Variables };

// Session token can come from one of three places, in priority order:
//   1. Authorization: Bearer <jwt>  (CLI, scripts, original SPA flow)
//   2. X-Session-Token: <jwt>       (legacy header)
//   3. prism_session cookie         (SSR-friendly, set on login/register)
//
// PATs (`prism_pat_…`) never go through this — they're handled by `tryPatAuth`
// before this middleware runs.
function readSessionToken(c: Context<AppEnv>): string | null {
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const t = authHeader.slice(7);
    // PATs use a different middleware; ignore them here.
    if (!t.startsWith("prism_pat_")) return t;
  }
  const xst = c.req.header("X-Session-Token");
  if (xst) return xst;
  return readSessionCookie(c);
}

/**
 * Resolve a session token to the user it authenticates, or null when the
 * token, the session or the account is unusable.
 *
 * The JWT proves only that this session was issued to this user; every claim
 * baked into it is a snapshot from login time and cannot be revoked before it
 * expires. So everything the server makes an authorization decision on — the
 * role, whether the account is still active, whether the address is verified
 * — is read from the users row on each request. A demotion then takes effect
 * on the very next request instead of whenever the token happens to lapse.
 *
 * The remaining claims are display-only and stay on the token; avatar_url in
 * particular is the proxied URL, which the users row does not carry.
 */
async function loadSession(
  c: Context<AppEnv>,
  token: string,
): Promise<{ user: AuthUser; sessionId: string } | null> {
  const secret = await getJwtSecret(c.env.KV_SESSIONS);
  const payload = await verifyJWT(token, secret);

  const row = await c.env.DB.prepare(
    `SELECT s.id AS session_id, u.role, u.email_verified, u.is_active
       FROM sessions s
       JOIN users u ON s.user_id = u.id
      WHERE s.id = ? AND u.kind = 'user' AND s.expires_at > ?`,
  )
    .bind(payload.sessionId, Math.floor(Date.now() / 1000))
    .first<{
      session_id: string;
      role: "admin" | "user";
      email_verified: number;
      is_active: number;
    }>();

  if (!row || !row.is_active) return null;

  return {
    sessionId: row.session_id,
    user: {
      id: payload.sub,
      email: payload.email as string,
      username: payload.username as string,
      display_name: payload.display_name as string,
      avatar_url: (payload.avatar_url as string) ?? null,
      role: row.role,
      email_verified: row.email_verified === 1,
    },
  };
}

export async function requireAuth(c: Context<AppEnv>, next: Next) {
  // An earlier middleware may have authenticated this request via an alternate
  // scheme (e.g. app client credentials). Don't clobber that.
  if (c.get("user") || c.get("appSelfAuth")) return await next();

  const token = readSessionToken(c);

  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const session = await loadSession(c, token);
    if (!session) return c.json({ error: "Unauthorized" }, 401);

    c.set("user", session.user);
    c.set("sessionId", session.sessionId);
    trackSessionIp(c, session.sessionId);
    await next();
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }
}

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = readSessionToken(c);

  if (!token) return c.json({ error: "Unauthorized" }, 401);

  try {
    const session = await loadSession(c, token);
    if (!session) return c.json({ error: "Unauthorized" }, 401);

    // The role as it stands right now, not the one the token was minted with:
    // an admin who has since been demoted loses access here, immediately.
    if (session.user.role !== "admin")
      return c.json({ error: "Forbidden" }, 403);

    c.set("user", session.user);
    c.set("sessionId", session.sessionId);
    trackSessionIp(c, session.sessionId);
    await next();
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }
};

/**
 * Middleware factory: accept a Personal Access Token (Bearer prism_pat_…) as an
 * alternative to a session JWT. The PAT must carry the scope appropriate to the
 * request method (read for GET/HEAD, write otherwise). Sets `c.user` from the
 * PAT's owner and lets the route proceed.
 *
 * If the Bearer token is absent or not a PAT, this middleware is a no-op so a
 * subsequent `requireAuth` can still validate a session token.
 *
 * Pattern: register before `requireAuth` for any route group whose dashboard
 * endpoints should also be reachable via PAT.
 */
export function tryPatAuth(scopes: {
  read: string;
  write: string;
}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.get("user") || c.get("appSelfAuth")) return await next();

    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return await next();
    const raw = authHeader.slice(7);
    if (!raw.startsWith("prism_pat_")) return await next();

    const now = Math.floor(Date.now() / 1000);
    // The token column may be plaintext (legacy) or HMAC-keyed hash
    // (post-migration). Look up under both forms so PATs issued before
    // SECRETS_KEY was wired up keep working until the admin migrate runs.
    const lookupHash = await hashLookupCandidate(c.env, raw);
    if (!lookupHash) return c.json({ error: "Unauthorized" }, 401);
    const pat = await c.env.DB.prepare(
      "SELECT id, user_id, scopes, expires_at FROM personal_access_tokens WHERE token = ? OR token = ?",
    )
      .bind(raw, lookupHash)
      .first<{
        id: string;
        user_id: string;
        scopes: string;
        expires_at: number | null;
      }>();
    if (!pat) return c.json({ error: "Unauthorized" }, 401);
    if (pat.expires_at !== null && pat.expires_at < now)
      return c.json({ error: "Token expired" }, 401);

    const tokenScopes = JSON.parse(pat.scopes) as string[];
    const required =
      c.req.method === "GET" || c.req.method === "HEAD"
        ? scopes.read
        : scopes.write;
    if (!tokenScopes.includes(required))
      return c.json({ error: "insufficient_scope" }, 403);

    const user = await c.env.DB.prepare(
      "SELECT id, email, username, display_name, avatar_url, role, email_verified, is_active FROM users WHERE id = ? AND kind = 'user'",
    )
      .bind(pat.user_id)
      .first<{
        id: string;
        email: string;
        username: string;
        display_name: string;
        avatar_url: string | null;
        role: "admin" | "user";
        email_verified: number;
        is_active: number;
      }>();
    if (!user || !user.is_active) return c.json({ error: "Unauthorized" }, 401);

    c.set("user", {
      id: user.id,
      email: user.email,
      username: user.username,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
      role: user.role,
      email_verified: user.email_verified === 1,
    });

    // Best-effort: bump last-used timestamp; never block the request on this
    c.executionCtx.waitUntil(
      c.env.DB.prepare(
        "UPDATE personal_access_tokens SET last_used_at = ? WHERE id = ?",
      )
        .bind(now, pat.id)
        .run()
        .then(() => undefined)
        .catch(() => undefined),
    );

    await next();
  };
}

export async function optionalAuth(c: Context<AppEnv>, next: Next) {
  const token = readSessionToken(c);

  if (token) {
    try {
      const session = await loadSession(c, token);
      if (session) {
        c.set("user", session.user);
        c.set("sessionId", session.sessionId);
        trackSessionIp(c, session.sessionId);
      }
    } catch {
      // ignore invalid tokens for optional auth
    }
  }
  await next();
}
