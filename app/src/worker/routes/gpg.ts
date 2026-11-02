// GPG key management routes (authenticated)

import { guardCapability } from "../lib/userCapabilities";
import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { addGpgKeys } from "../lib/gpg";
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

// ─── Add key(s) ───────────────────────────────────────────────────────────────
// A paste holding several public keys is split; each key gets its own row.

app.post("/", async (c) => {
  const user = c.get("user");

  const capErr = await guardCapability(c.env.DB, user.id, "gpg:manage");
  if (capErr) return c.json({ error: capErr }, 403);

  const body = await c.req.json<{ public_key: string; name?: string }>();

  if (!body.public_key || typeof body.public_key !== "string") {
    return c.json(
      { error: "field_required", params: { field: "public_key" } },
      400,
    );
  }

  const result = await addGpgKeys(
    c.env.DB,
    user.id,
    body.public_key,
    body.name,
  );
  if (!result.ok) return c.json({ error: result.error }, result.status);
  const { keys, added, skipped } = result;
  return c.json({ keys, added, skipped });
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
  if (!result.meta.changes) return c.json({ error: "key_not_found" }, 404);
  return c.json({ ok: true });
});

export default app;
