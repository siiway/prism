// Init route: check if the platform is initialized, create first admin

import { Hono } from "hono";
import { isInitialized, setConfigValue, getJwtSecret } from "../lib/config";
import { hashPassword } from "../lib/crypto";
import { randomId } from "../lib/crypto";
import { signJWT } from "../lib/jwt";

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

  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO users (id, email, username, password_hash, display_name, role, email_verified, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'admin', 1, 1, ?, ?)`,
      ).bind(
        userId,
        body.email.toLowerCase().trim(),
        body.username.toLowerCase().trim(),
        passwordHash,
        body.display_name ?? body.username,
        now,
        now,
      ),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("UNIQUE")) {
      return c.json({ error: "Email or username already taken" }, 409);
    }
    throw err;
  }

  // Mark initialized and optionally set site name
  await setConfigValue(c.env.DB, "initialized", true);
  if (body.site_name) {
    await setConfigValue(c.env.DB, "site_name", body.site_name);
  }

  // Issue a session token
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
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(sessionId, userId, tokenHash, now + sessionTtl, now)
    .run();

  return c.json(
    {
      token,
      user: {
        id: userId,
        email: body.email,
        username: body.username,
        role: "admin",
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
