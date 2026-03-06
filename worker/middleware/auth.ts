// Authentication middleware

import type { Context, MiddlewareHandler, Next } from "hono";
import { verifyJWT } from "../lib/jwt";
import { getJwtSecret } from "../lib/config";
import type { Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };

export async function requireAuth(c: Context<AppEnv>, next: Next) {
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

export async function optionalAuth(c: Context<AppEnv>, next: Next) {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : c.req.header("X-Session-Token");

  if (token) {
    try {
      const secret = await getJwtSecret(c.env.KV_SESSIONS);
      const payload = await verifyJWT(token, secret);
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
    } catch {
      // ignore invalid tokens for optional auth
    }
  }
  await next();
}
