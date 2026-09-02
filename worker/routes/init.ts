// Init route: check if the platform is initialized, create first admin

import { Hono } from "hono";
import { isInitialized, setConfigValue, getJwtSecret } from "../lib/config";
import { hashPassword } from "../lib/crypto";
import { randomId } from "../lib/crypto";
import { getIp } from "../lib/clientIp";
import { geoJson, recordSessionIp } from "../lib/geo";
import { signJWT } from "../lib/jwt";
import { setSessionCookie } from "../lib/cookies";

const app = new Hono<{ Bindings: Env }>();

// GET /api/init/status — is the platform ready?
app.get("/status", async (c) => {
  const initialized = await isInitialized(c.env.DB);
  return c.json({ initialized });
});

// POST /api/init — create the first admin account
app.post("/", async (c) => {
  const initialized = await isInitialized(c.env.DB);
  if (initialized) {
    return c.json({ error: "Platform already initialized" }, 409);
  }

  const body = await c.req.json<{
    email: string;
    username: string;
    password: string;
    display_name?: string;
    site_name?: string;
  }>();

  if (!body.email || !body.username || !body.password) {
    return c.json({ error: "email, username and password are required" }, 400);
  }
  if (body.password.length < 8) {
    return c.json({ error: "Password must be at least 8 characters" }, 400);
  }

  const userId = randomId();
  const passwordHash = await hashPassword(body.password);
  const now = Math.floor(Date.now() / 1000);

  // The isInitialized() check above is a fast path, not a guarantee: two
  // requests arriving together both read "not initialized" and both go on to
  // create an admin. The INSERT therefore carries the condition itself —
  // SQLite evaluates the NOT EXISTS as part of the statement, so exactly one
  // of the racing requests inserts a row and the other sees changes === 0.
  let created: D1Result;
  try {
    created = await c.env.DB.prepare(
      `INSERT INTO users (id, email, username, password_hash, display_name, role, email_verified, is_active, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, 'admin', 1, 1, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM users WHERE role = 'admin' AND kind = 'user'
        )`,
    )
      .bind(
        userId,
        body.email.toLowerCase().trim(),
        body.username.toLowerCase().trim(),
        passwordHash,
        body.display_name ?? body.username,
        now,
        now,
      )
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("UNIQUE")) {
      return c.json({ error: "Email or username already taken" }, 409);
    }
    throw err;
  }
  if (created.meta.changes !== 1) {
    return c.json({ error: "Platform already initialized" }, 409);
  }

  // Mark initialized and optionally set site name
  await setConfigValue(c.env.DB, "initialized", true);
  if (body.site_name) {
    await setConfigValue(c.env.DB, "site_name", body.site_name);
  }

  // Issue a session in the HttpOnly cookie.
  const sessionId = randomId(32);
  const sessionTtl = 30 * 24 * 60 * 60;
  const jwtSecret = await getJwtSecret(c.env.KV_SESSIONS);
  const token = await signJWT(
    {
      sub: userId,
      role: "admin",
      email: body.email.toLowerCase().trim(),
      username: body.username.toLowerCase().trim(),
      display_name: body.display_name ?? body.username,
      avatar_url: null,
      email_verified: true,
      sessionId,
    },
    jwtSecret,
    sessionTtl,
  );

  // Store session record
  const tokenHash = await sha256(token);
  await c.env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, user_agent, ip_address, expires_at, created_at, amr) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      sessionId,
      userId,
      tokenHash,
      c.req.header("User-Agent") ?? null,
      c.req.header("CF-Connecting-IP") ??
        c.req.header("X-Forwarded-For") ??
        "unknown",
      now + sessionTtl,
      now,
      JSON.stringify(["pwd"]),
    )
    .run();

  // Seed IP history + geolocation for the bootstrap admin's first session.
  c.executionCtx.waitUntil(
    recordSessionIp(c.env.DB, sessionId, getIp(c), geoJson(c), now).catch(
      () => undefined,
    ),
  );

  setSessionCookie(c, token, sessionTtl);

  return c.json(
    {
      user: {
        id: userId,
        email: body.email.toLowerCase().trim(),
        username: body.username.toLowerCase().trim(),
        display_name: body.display_name ?? body.username,
        avatar_url: null,
        unproxied_avatar_url: null,
        role: "admin",
        email_verified: true,
      },
    },
    201,
  );
});

async function sha256(str: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(str),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default app;
