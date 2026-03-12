// GPG key management routes (authenticated)

import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { randomId } from "../lib/crypto";
import { parseArmoredPublicKey } from "../lib/gpg";
import type { GpgKeyRow, Variables } from "../types";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", requireAuth);

// ─── List keys ────────────────────────────────────────────────────────────────

app.get("/", async (c) => {
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    "SELECT id, fingerprint, key_id, name, created_at, last_used_at FROM user_gpg_keys WHERE user_id = ? ORDER BY created_at ASC",
  )
    .bind(user.id)
    .all<Omit<GpgKeyRow, "user_id" | "public_key">>();
  return c.json({ keys: results });
});

// ─── Add key ──────────────────────────────────────────────────────────────────

app.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ public_key: string; name?: string }>();

  if (!body.public_key || typeof body.public_key !== "string") {
    return c.json({ error: "public_key is required" }, 400);
  }

  let parsed: Awaited<ReturnType<typeof parseArmoredPublicKey>>;
  try {
    parsed = await parseArmoredPublicKey(body.public_key);
  } catch {
    return c.json({ error: "Invalid PGP public key" }, 400);
  }

  const name = (body.name?.trim() || parsed.uids[0] || parsed.keyId).slice(
    0,
    128,
  );

  const existing = await c.env.DB.prepare(
    "SELECT id FROM user_gpg_keys WHERE user_id = ? AND fingerprint = ?",
  )
    .bind(user.id, parsed.fingerprint)
    .first();
  if (existing) return c.json({ error: "Key already added" }, 409);

  const id = randomId(16);
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    "INSERT INTO user_gpg_keys (id, user_id, fingerprint, key_id, name, public_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      user.id,
      parsed.fingerprint,
      parsed.keyId,
      name,
      body.public_key.trim(),
      now,
    )
    .run();

  return c.json({
    id,
    fingerprint: parsed.fingerprint,
    key_id: parsed.keyId,
    name,
    created_at: now,
    last_used_at: null,
  });
});

// ─── Delete key ───────────────────────────────────────────────────────────────

app.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const result = await c.env.DB.prepare(
    "DELETE FROM user_gpg_keys WHERE id = ? AND user_id = ?",
  )
    .bind(id, user.id)
    .run();
  if (!result.meta.changes) return c.json({ error: "Key not found" }, 404);
  return c.json({ message: "Key removed" });
});

export default app;
