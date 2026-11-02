// GPG key management routes (authenticated)

import { guardCapability } from "../lib/userCapabilities";
import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { randomId } from "../lib/crypto";
import { parseArmoredPublicKeys } from "../lib/gpg";
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
// A single paste may contain several public keys (multiple armored blocks
// and/or one block exporting several keys). Each parsed key is stored as
// its own row; duplicates (within the paste or already registered) are
// skipped and reported.

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

  let parsed: Awaited<ReturnType<typeof parseArmoredPublicKeys>>;
  try {
    parsed = await parseArmoredPublicKeys(body.public_key);
  } catch {
    return c.json({ error: "pgp_key_invalid" }, 400);
  }
  if (parsed.length === 0) {
    return c.json({ error: "pgp_key_invalid" }, 400);
  }

  // Dedupe within the submission by fingerprint
  const seen = new Set<string>();
  const unique = parsed.filter((k) => {
    if (seen.has(k.fingerprint)) return false;
    seen.add(k.fingerprint);
    return true;
  });

  const { results: existingRows } = await c.env.DB.prepare(
    "SELECT fingerprint FROM user_gpg_keys WHERE user_id = ?",
  )
    .bind(user.id)
    .all<{ fingerprint: string }>();
  const existing = new Set(existingRows.map((r) => r.fingerprint));

  const toAdd = unique.filter((k) => !existing.has(k.fingerprint));
  const skipped = unique.length - toAdd.length;
  if (toAdd.length === 0) return c.json({ error: "key_exists" }, 409);

  const now = Math.floor(Date.now() / 1000);
  const baseName = body.name?.trim();
  const added: Array<{
    id: string;
    fingerprint: string;
    key_id: string;
    name: string;
    created_at: number;
    last_used_at: null;
  }> = [];
  const stmts = toAdd.map((k, i) => {
    // A user-supplied name applies as-is to a single key; with several
    // keys it gets a #n suffix so rows stay distinguishable.
    const name = (
      baseName
        ? toAdd.length === 1
          ? baseName
          : `${baseName} #${i + 1}`
        : k.uids[0] || k.keyId
    ).slice(0, 128);
    const id = randomId(16);
    added.push({
      id,
      fingerprint: k.fingerprint,
      key_id: k.keyId,
      name,
      created_at: now,
      last_used_at: null,
    });
    return c.env.DB.prepare(
      "INSERT INTO user_gpg_keys (id, user_id, fingerprint, key_id, name, public_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, user.id, k.fingerprint, k.keyId, name, k.armored, now);
  });
  await c.env.DB.batch(stmts);

  return c.json({ keys: added, added: added.length, skipped });
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
