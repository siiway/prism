// User profile routes

import { Hono } from "hono";
import { hashPassword, verifyPassword } from "../lib/crypto";
import { requireAuth } from "../middleware/auth";
import { validateImageUrl } from "../lib/imageValidation";
import type { UserRow, Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

app.use("*", requireAuth);

// Get own profile
app.get("/me", async (c) => {
  const user = c.get("user");
  const row = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(user.id)
    .first<UserRow>();
  if (!row) return c.json({ error: "User not found" }, 404);

  const totp = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM totp_authenticators WHERE user_id = ? AND enabled = 1",
  )
    .bind(user.id)
    .first<{ n: number }>();
  const passkeyCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as n FROM passkeys WHERE user_id = ?",
  )
    .bind(user.id)
    .first<{ n: number }>();

  return c.json({
    user: safeUser(row),
    totp_enabled: (totp?.n ?? 0) > 0,
    passkey_count: passkeyCount?.n ?? 0,
  });
});

// Update profile
app.patch("/me", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    display_name?: string;
    avatar_url?: string;
  }>();

  const now = Math.floor(Date.now() / 1000);
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.display_name !== undefined) {
    if (body.display_name.length < 1 || body.display_name.length > 64)
      return c.json({ error: "display_name must be 1-64 characters" }, 400);
    updates.push("display_name = ?");
    values.push(body.display_name);
  }
  if (body.avatar_url !== undefined) {
    if (body.avatar_url && !body.avatar_url.startsWith("/api/assets/")) {
      const imgErr = await validateImageUrl(body.avatar_url);
      if (imgErr) return c.json({ error: `avatar_url: ${imgErr}` }, 400);
    }
    updates.push("avatar_url = ?");
    values.push(body.avatar_url || null);
  }

  if (updates.length === 0) return c.json({ error: "Nothing to update" }, 400);

  updates.push("updated_at = ?");
  values.push(now, user.id);

  await c.env.DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const row = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(user.id)
    .first<UserRow>();
  return c.json({ user: safeUser(row!) });
});

// Change password
app.post("/me/change-password", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    current_password: string;
    new_password: string;
  }>();

  const row = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(user.id)
    .first<UserRow>();
  if (!row) return c.json({ error: "User not found" }, 404);

  if (row.password_hash) {
    if (!body.current_password)
      return c.json({ error: "current_password required" }, 400);
    const ok = await verifyPassword(body.current_password, row.password_hash);
    if (!ok) return c.json({ error: "Invalid current password" }, 401);
  }

  if (!body.new_password || body.new_password.length < 8)
    return c.json({ error: "New password must be at least 8 characters" }, 400);

  const hash = await hashPassword(body.new_password);
  await c.env.DB.prepare(
    "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
  )
    .bind(hash, Math.floor(Date.now() / 1000), user.id)
    .run();

  return c.json({ message: "Password updated" });
});

// Upload avatar to R2
app.post("/me/avatar", async (c) => {
  if (!c.env.R2_ASSETS)
    return c.json(
      { error: "File uploads are not enabled on this instance" },
      503,
    );

  const r2 = c.env.R2_ASSETS;
  const user = c.get("user");
  const formData = await c.req.formData();
  const file = formData.get("avatar") as unknown as File | null;

  if (!file) return c.json({ error: "avatar file required" }, 400);
  if (file.size > 2 * 1024 * 1024)
    return c.json({ error: "Avatar must be < 2MB" }, 400);
  if (
    !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)
  )
    return c.json({ error: "Invalid file type" }, 400);

  const ext = file.type.split("/")[1];
  const key = `avatars/${user.id}.${ext}`;
  await r2.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  });

  const avatarUrl = `/api/assets/${key}`;
  await c.env.DB.prepare(
    "UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?",
  )
    .bind(avatarUrl, Math.floor(Date.now() / 1000), user.id)
    .run();

  return c.json({ avatar_url: avatarUrl });
});

// Serve R2 assets
app.get("/assets/*", async (c) => {
  if (!c.env.R2_ASSETS) return c.json({ error: "Not found" }, 404);
  const r2 = c.env.R2_ASSETS;
  const key = c.req.path.replace("/api/assets/", "");
  const obj = await r2.get(key);
  if (!obj) return c.json({ error: "Not found" }, 404);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Cache-Control", "public, max-age=86400");
  return new Response(obj.body, { headers });
});

// Delete account
app.delete("/me", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ password?: string; confirm: string }>();

  if (body.confirm !== "DELETE")
    return c.json(
      { error: 'Confirm deletion by sending confirm="DELETE"' },
      400,
    );

  const row = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(user.id)
    .first<UserRow>();
  if (!row) return c.json({ error: "User not found" }, 404);

  if (row.password_hash) {
    if (!body.password) return c.json({ error: "password required" }, 400);
    const ok = await verifyPassword(body.password, row.password_hash);
    if (!ok) return c.json({ error: "Invalid password" }, 401);
  }

  await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();
  return c.json({ message: "Account deleted" });
});

function safeUser(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    role: row.role,
    email_verified: row.email_verified === 1,
    created_at: row.created_at,
  };
}

export default app;
