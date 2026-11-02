// Init route: check if the platform is initialized, create first admin

import { Hono } from "hono";
import { isInitialized, setConfigValue } from "../lib/config";
import { hashPassword, randomId } from "../lib/crypto";
import { issueSession } from "../lib/session";
import { toSessionUser } from "../lib/sessionUser";
import type { UserRow, Variables } from "../types";
import { PASSWORD_MIN_LENGTH } from "../../shared/limits";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /api/init/status — is the platform ready?
app.get("/status", async (c) => {
  const initialized = await isInitialized(c.env.DB);
  return c.json({ initialized });
});

// POST /api/init — create the first admin account
app.post("/", async (c) => {
  const initialized = await isInitialized(c.env.DB);
  if (initialized) {
    return c.json({ error: "already_initialized" }, 409);
  }

  const body = await c.req.json<{
    email: string;
    username: string;
    password: string;
    display_name?: string;
    site_name?: string;
  }>();

  if (!body.email || !body.username || !body.password) {
    return c.json(
      {
        error: "fields_required",
        params: { fields: "email, username, password" },
      },
      400,
    );
  }
  if (body.password.length < PASSWORD_MIN_LENGTH) {
    return c.json({ error: "password_too_short" }, 400);
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
      return c.json({ error: "email_or_username_taken" }, 409);
    }
    throw err;
  }
  if (created.meta.changes !== 1) {
    return c.json({ error: "already_initialized" }, 409);
  }

  // Mark initialized and optionally set site name
  await setConfigValue(c.env.DB, "initialized", true);
  if (body.site_name) {
    await setConfigValue(c.env.DB, "site_name", body.site_name);
  }

  const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(userId)
    .first<UserRow>();
  if (!user) return c.json({ error: "user_create_failed" }, 500);

  // The bootstrap admin's first session (30 days).
  await issueSession(c, user, 30 * 24 * 60 * 60, ["pwd"]);
  return c.json(
    { user: await toSessionUser(c.env.APP_URL, c.env.DB, user) },
    201,
  );
});

export default app;
