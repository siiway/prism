// Authentication middleware

import type { Context, MiddlewareHandler, Next } from "hono";
import { verifyJWT } from "../lib/jwt";
import { getJwtSecret } from "../lib/config";
import type { Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };

export async function requireAuth(c: Context<AppEnv>, next: Next) {
  // An earlier middleware may have authenticated this request via an alternate
  // scheme (e.g. app client credentials). Don't clobber that.
  if (c.get("user") || c.get("appSelfAuth")) return await next();

  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : c.req.header("X-Session-Token");

  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const secret = await getJwtSecret(c.env.KV_SESSIONS);
    const payload = await verifyJWT(token, secret);

    const session = await c.env.DB.prepare(
      "SELECT s.id, u.is_active FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ?",
    )
      .bind(payload.sessionId)
      .first<{ id: string; is_active: number }>();

    if (!session || !session.is_active) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    c.set("user", {
      id: payload.sub,
      email: payload.email as string,
      username: payload.username as string,
      display_name: payload.display_name as string,
      avatar_url: (payload.avatar_url as string) ?? null,
      role: payload.role,
      email_verified: payload.email_verified as boolean,
    });
    c.set("sessionId", payload.sessionId);
    await next();
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }
}

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : c.req.header("X-Session-Token");

  if (!token) return c.json({ error: "Unauthorized" }, 401);

  try {
    const secret = await getJwtSecret(c.env.KV_SESSIONS);
    const payload = await verifyJWT(token, secret);
    if (payload.role !== "admin") return c.json({ error: "Forbidden" }, 403);

    const session = await c.env.DB.prepare(
      "SELECT s.id, u.is_active FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ?",
    )
      .bind(payload.sessionId)
      .first<{ id: string; is_active: number }>();

    if (!session || !session.is_active) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    c.set("user", {
      id: payload.sub,
      email: payload.email as string,
      username: payload.username as string,
      display_name: payload.display_name as string,
      avatar_url: (payload.avatar_url as string) ?? null,
      role: payload.role,
      email_verified: payload.email_verified as boolean,
    });
    c.set("sessionId", payload.sessionId);
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
    const pat = await c.env.DB.prepare(
      "SELECT user_id, scopes, expires_at FROM personal_access_tokens WHERE token = ?",
    )
      .bind(raw)
      .first<{ user_id: string; scopes: string; expires_at: number | null }>();
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
      "SELECT id, email, username, display_name, avatar_url, role, email_verified, is_active FROM users WHERE id = ?",
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
        "UPDATE personal_access_tokens SET last_used_at = ? WHERE token = ?",
      )
        .bind(now, raw)
        .run()
        .then(() => undefined)
        .catch(() => undefined),
    );

    await next();
  };
}

export async function optionalAuth(c: Context<AppEnv>, next: Next) {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : c.req.header("X-Session-Token");

  if (token) {
    try {
      const secret = await getJwtSecret(c.env.KV_SESSIONS);
      const payload = await verifyJWT(token, secret);

      const session = await c.env.DB.prepare(
        "SELECT s.id, u.is_active FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ?",
      )
        .bind(payload.sessionId)
        .first<{ id: string; is_active: number }>();

      if (session && session.is_active) {
        c.set("user", {
          id: payload.sub,
          email: payload.email as string,
          username: payload.username as string,
          display_name: payload.display_name as string,
          avatar_url: (payload.avatar_url as string) ?? null,
          role: payload.role,
          email_verified: payload.email_verified as boolean,
        });
        c.set("sessionId", payload.sessionId);
      }
    } catch {
      // ignore invalid tokens for optional auth
    }
  }
  await next();
}
