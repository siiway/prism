// Personal Access Tokens: /api/user/tokens — listing, creating and revoking
// the signed-in user's PATs.

import { guardCapability } from "../lib/userCapabilities";
import { Hono } from "hono";
import { randomId, randomBase64url } from "../lib/crypto";
import {
  deliverUserEmailNotifications,
  notificationActorMetaFromHeaders,
} from "../lib/notifications";
import { readPage, likePattern } from "../lib/pagination";
import { hashSecret } from "../lib/secretCrypto";
import type { Variables } from "../types";
import { USER_GRANTABLE_SCOPES } from "../../shared/scopes";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

// ─── Personal Access Tokens ───────────────────────────────────────────────────

const VALID_PAT_SCOPES = new Set(USER_GRANTABLE_SCOPES);

// GET /api/user/tokens — list own PATs
app.get("/tokens", async (c) => {
  const user = c.get("user");
  const { page, limit, offset } = readPage(
    c.req.query("page"),
    c.req.query("limit"),
    20,
  );
  const query = c.req.query("q")?.trim() ?? "";

  const where = query
    ? "user_id = ? AND LOWER(name) LIKE LOWER(?) ESCAPE '\\'"
    : "user_id = ?";
  const args: unknown[] = query ? [user.id, likePattern(query)] : [user.id];

  const [rows, countRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, name, scopes, expires_at, last_used_at, created_at
       FROM personal_access_tokens
       WHERE ${where}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(...args, limit, offset)
      .all<{
        id: string;
        name: string;
        scopes: string;
        expires_at: number | null;
        last_used_at: number | null;
        created_at: number;
      }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM personal_access_tokens WHERE ${where}`,
    )
      .bind(...args)
      .first<{ n: number }>(),
  ]);

  return c.json({
    tokens: rows.results.map((r) => ({
      ...r,
      scopes: JSON.parse(r.scopes) as string[],
    })),
    total: countRow?.n ?? 0,
    page,
    limit,
  });
});

// POST /api/user/tokens — create a PAT
app.post("/tokens", async (c) => {
  const user = c.get("user");

  const capErr = await guardCapability(c.env.DB, user.id, "pat:create");
  if (capErr) return c.json({ error: capErr }, 403);

  const body = await c.req.json<{
    name: string;
    scopes: string[];
    expires_in_days?: number;
  }>();

  if (!body.name?.trim())
    return c.json({ error: "field_required", params: { field: "name" } }, 400);
  if (!Array.isArray(body.scopes) || body.scopes.length === 0)
    return c.json(
      { error: "field_required", params: { field: "scopes" } },
      400,
    );

  const scopes = body.scopes.filter((s) => VALID_PAT_SCOPES.has(s));
  if (scopes.length === 0) return c.json({ error: "scopes_invalid" }, 400);

  const id = randomId();
  const token = `prism_pat_${randomBase64url(48)}`;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = body.expires_in_days
    ? now + body.expires_in_days * 86400
    : null;

  // Token is shown to the user once and never re-displayed; storing the
  // HMAC-keyed hash means a leak of the D1 row never gives bearer access.
  // Plaintext fallback (when SECRETS_KEY isn't bound) is still wrapped
  // by hashSecret which short-circuits to a no-op.
  const storedToken = await hashSecret(c.env, token);
  await c.env.DB.prepare(
    `INSERT INTO personal_access_tokens (id, user_id, name, token, scopes, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      user.id,
      body.name.trim(),
      storedToken,
      JSON.stringify(scopes),
      expiresAt,
      now,
    )
    .run();

  c.executionCtx.waitUntil(
    deliverUserEmailNotifications(
      c.env,
      user.id,
      "token.created",
      {
        name: body.name.trim(),
        scopes,
        ...notificationActorMetaFromHeaders(c.req.raw.headers),
      },
      c.env.APP_URL,
    ).catch(() => {}),
  );

  return c.json(
    {
      id,
      name: body.name.trim(),
      token,
      scopes,
      expires_at: expiresAt,
      created_at: now,
    },
    201,
  );
});

// DELETE /api/user/tokens/:id — revoke a PAT
app.delete("/tokens/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const row = await c.env.DB.prepare(
    "SELECT id, name FROM personal_access_tokens WHERE id = ? AND user_id = ?",
  )
    .bind(id, user.id)
    .first<{ id: string; name: string }>();

  if (!row) return c.json({ error: "token_not_found" }, 404);

  await c.env.DB.prepare("DELETE FROM personal_access_tokens WHERE id = ?")
    .bind(id)
    .run();

  c.executionCtx.waitUntil(
    deliverUserEmailNotifications(
      c.env,
      user.id,
      "token.revoked",
      {
        name: row.name,
        ...notificationActorMetaFromHeaders(c.req.raw.headers),
      },
      c.env.APP_URL,
    ).catch(() => {}),
  );

  return c.json({ ok: true });
});

export default app;
