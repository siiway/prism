// Admin routes: site config, user management, app moderation, audit log

import { Hono } from "hono";
import { getConfig, setConfigValues } from "../lib/config";
import { sendEmail } from "../lib/email";
import { requireAdmin } from "../middleware/auth";
import type { AuditLogRow, OAuthAppRow, UserRow, Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

app.use("*", requireAdmin);

// ─── Site configuration ───────────────────────────────────────────────────────

app.get("/config", async (c) => {
  const config = await getConfig(c.env.DB);
  // Strip secret keys from response
  const safeConfig = {
    ...config,
    captcha_secret_key: "***",
    github_client_secret: "***",
    google_client_secret: "***",
    microsoft_client_secret: "***",
    discord_client_secret: "***",
    email_api_key: "***",
  };
  return c.json({ config: safeConfig });
});

app.patch("/config", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();

  // Whitelist of settable keys
  const allowed = new Set([
    "site_name",
    "site_description",
    "site_icon_url",
    "allow_registration",
    "require_email_verification",
    "captcha_provider",
    "captcha_site_key",
    "captcha_secret_key",
    "pow_difficulty",
    "domain_reverify_days",
    "session_ttl_days",
    "access_token_ttl_minutes",
    "refresh_token_ttl_days",
    "github_client_id",
    "github_client_secret",
    "google_client_id",
    "google_client_secret",
    "microsoft_client_id",
    "microsoft_client_secret",
    "discord_client_id",
    "discord_client_secret",
    "email_provider",
    "email_api_key",
    "email_from",
    "custom_css",
    "accent_color",
  ]);

  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (allowed.has(k)) updates[k] = v;
  }

  await setConfigValues(c.env.DB, updates);

  await logAudit(
    c.env.DB,
    c.get("user").id,
    "admin.config.update",
    "site_config",
    null,
    updates,
    getIp(c),
  );
  return c.json({ message: "Config updated", updated: Object.keys(updates) });
});

// ─── User management ──────────────────────────────────────────────────────────

app.get("/users", async (c) => {
  const page = parseInt(c.req.query("page") ?? "1");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20"), 100);
  const offset = (page - 1) * limit;
  const search = c.req.query("search") ?? "";

  const whereClause = search
    ? "WHERE u.email LIKE ? OR u.username LIKE ? OR u.display_name LIKE ?"
    : "";
  const searchParam = `%${search}%`;
  const params = search ? [searchParam, searchParam, searchParam] : [];

  const [usersResult, countResult] = await Promise.all([
    c.env.DB.prepare(
      `SELECT u.id, u.email, u.username, u.display_name, u.role, u.email_verified, u.is_active, u.created_at,
              (SELECT COUNT(*) FROM oauth_apps WHERE owner_id = u.id) as app_count
       FROM users u ${whereClause} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(...params, limit, offset)
      .all(),
    c.env.DB.prepare(`SELECT COUNT(*) as n FROM users u ${whereClause}`)
      .bind(...params)
      .first<{ n: number }>(),
  ]);

  return c.json({
    users: usersResult.results,
    total: countResult?.n ?? 0,
    page,
    limit,
  });
});

app.get("/users/:id", async (c) => {
  const id = c.req.param("id");
  const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(id)
    .first<UserRow>();
  if (!user) return c.json({ error: "User not found" }, 404);

  const [apps, connections, sessions] = await Promise.all([
    c.env.DB.prepare(
      "SELECT id, name, client_id, is_active, created_at FROM oauth_apps WHERE owner_id = ?",
    )
      .bind(id)
      .all(),
    c.env.DB.prepare(
      "SELECT provider, connected_at FROM social_connections WHERE user_id = ?",
    )
      .bind(id)
      .all(),
    c.env.DB.prepare(
      "SELECT id, user_agent, ip_address, created_at, expires_at FROM sessions WHERE user_id = ?",
    )
      .bind(id)
      .all(),
  ]);

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
      role: user.role,
      email_verified: user.email_verified === 1,
      is_active: user.is_active === 1,
      created_at: user.created_at,
    },
    apps: apps.results,
    connections: connections.results,
    sessions: sessions.results,
  });
});

// Update user (role, active status, etc.)
app.patch("/users/:id", async (c) => {
  const admin = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json<{
    role?: "admin" | "user";
    is_active?: boolean;
    email_verified?: boolean;
  }>();

  const user = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?")
    .bind(id)
    .first();
  if (!user) return c.json({ error: "User not found" }, 404);

  if (body.role === "user" && id === admin.id) {
    return c.json({ error: "You cannot demote yourself from admin" }, 403);
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.role !== undefined && ["admin", "user"].includes(body.role)) {
    updates.push("role = ?");
    values.push(body.role);
  }
  if (body.is_active !== undefined) {
    updates.push("is_active = ?");
    values.push(body.is_active ? 1 : 0);
  }
  if (body.email_verified !== undefined) {
    updates.push("email_verified = ?");
    values.push(body.email_verified ? 1 : 0);
  }
  if (updates.length === 0) return c.json({ error: "Nothing to update" }, 400);

  updates.push("updated_at = ?");
  values.push(Math.floor(Date.now() / 1000), id);

  await c.env.DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  await logAudit(
    c.env.DB,
    admin.id,
    "admin.user.update",
    "user",
    id,
    body,
    getIp(c),
  );
  return c.json({ message: "User updated" });
});

// Delete user
app.delete("/users/:id", async (c) => {
  const admin = c.get("user");
  const id = c.req.param("id");
  if (id === admin.id) return c.json({ error: "Cannot delete yourself" }, 400);

  const user = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?")
    .bind(id)
    .first();
  if (!user) return c.json({ error: "User not found" }, 404);

  await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
  await logAudit(
    c.env.DB,
    admin.id,
    "admin.user.delete",
    "user",
    id,
    {},
    getIp(c),
  );
  return c.json({ message: "User deleted" });
});

// Terminate all sessions for a user
app.delete("/users/:id/sessions", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?")
    .bind(id)
    .run();
  return c.json({ message: "Sessions terminated" });
});

// ─── App moderation ───────────────────────────────────────────────────────────

app.get("/apps", async (c) => {
  const page = parseInt(c.req.query("page") ?? "1");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20"), 100);
  const offset = (page - 1) * limit;

  const [apps, count] = await Promise.all([
    c.env.DB.prepare(
      `SELECT a.*, u.username as owner_username
       FROM oauth_apps a JOIN users u ON u.id = a.owner_id
       ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(limit, offset)
      .all<OAuthAppRow & { owner_username: string }>(),
    c.env.DB.prepare("SELECT COUNT(*) as n FROM oauth_apps").first<{
      n: number;
    }>(),
  ]);

  return c.json({ apps: apps.results, total: count?.n ?? 0, page, limit });
});

app.patch("/apps/:id", async (c) => {
  const admin = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json<{
    is_verified?: boolean;
    is_active?: boolean;
  }>();

  const app = await c.env.DB.prepare("SELECT id FROM oauth_apps WHERE id = ?")
    .bind(id)
    .first();
  if (!app) return c.json({ error: "App not found" }, 404);

  const updates: string[] = [];
  const values: unknown[] = [];
  if (body.is_verified !== undefined) {
    updates.push("is_verified = ?");
    values.push(body.is_verified ? 1 : 0);
  }
  if (body.is_active !== undefined) {
    updates.push("is_active = ?");
    values.push(body.is_active ? 1 : 0);
  }
  if (updates.length === 0) return c.json({ error: "Nothing to update" }, 400);

  updates.push("updated_at = ?");
  values.push(Math.floor(Date.now() / 1000), id);

  await c.env.DB.prepare(
    `UPDATE oauth_apps SET ${updates.join(", ")} WHERE id = ?`,
  )
    .bind(...values)
    .run();
  await logAudit(
    c.env.DB,
    admin.id,
    "admin.app.update",
    "oauth_app",
    id,
    body,
    getIp(c),
  );
  return c.json({ message: "App updated" });
});

// ─── Test email ───────────────────────────────────────────────────────────────

app.post("/test-email", async (c) => {
  const config = await getConfig(c.env.DB);
  if (config.email_provider === "none") {
    return c.json({ error: "Email provider is not configured" }, 400);
  }
  const admin = c.get("user");
  try {
    await sendEmail(
      {
        to: admin.email,
        subject: "Prism — Test Email",
        html: '<div style="font-family:sans-serif"><h2>Test Email</h2><p>This is a test email from your Prism instance. Email is working correctly!</p></div>',
        text: "This is a test email from your Prism instance. Email is working correctly!",
      },
      {
        provider: config.email_provider as "resend" | "mailchannels",
        from: config.email_from,
        apiKey: config.email_api_key,
      },
    );
    return c.json({ message: `Test email sent to ${admin.email}` });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Failed to send email" },
      500,
    );
  }
});

// ─── Reset everything ─────────────────────────────────────────────────────────

app.post("/reset", async (c) => {
  const body = await c.req.json<{ confirm?: string }>().catch(() => ({}));
  if (body.confirm !== "RESET_EVERYTHING") {
    return c.json({ error: "Missing confirmation" }, 400);
  }

  // Delete all data in reverse dependency order
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM oauth_tokens"),
    c.env.DB.prepare("DELETE FROM oauth_codes"),
    c.env.DB.prepare("DELETE FROM oauth_consents"),
    c.env.DB.prepare("DELETE FROM sessions"),
    c.env.DB.prepare("DELETE FROM totp_secrets"),
    c.env.DB.prepare("DELETE FROM passkeys"),
    c.env.DB.prepare("DELETE FROM social_connections"),
    c.env.DB.prepare("DELETE FROM domains"),
    c.env.DB.prepare("DELETE FROM audit_log"),
    c.env.DB.prepare("DELETE FROM oauth_apps"),
    c.env.DB.prepare("DELETE FROM users"),
    c.env.DB.prepare("DELETE FROM site_config"),
  ]);

  // Rotate JWT secret so all existing tokens become invalid
  await c.env.KV_SESSIONS.delete("system:jwt_secret");

  return c.json({ message: "Platform reset complete" });
});

// ─── Statistics ───────────────────────────────────────────────────────────────

app.get("/stats", async (c) => {
  const [userCount, appCount, domainCount, tokenCount] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as n FROM users").first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as n FROM oauth_apps").first<{
      n: number;
    }>(),
    c.env.DB.prepare(
      "SELECT COUNT(*) as n FROM domains WHERE verified = 1",
    ).first<{ n: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(*) as n FROM oauth_tokens WHERE expires_at > ?",
    )
      .bind(Math.floor(Date.now() / 1000))
      .first<{ n: number }>(),
  ]);
  return c.json({
    users: userCount?.n ?? 0,
    apps: appCount?.n ?? 0,
    verified_domains: domainCount?.n ?? 0,
    active_tokens: tokenCount?.n ?? 0,
  });
});

// ─── Audit log ────────────────────────────────────────────────────────────────

app.get("/audit-log", async (c) => {
  const page = parseInt(c.req.query("page") ?? "1");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50"), 200);
  const offset = (page - 1) * limit;

  const rows = await c.env.DB.prepare(
    `SELECT al.*, u.username FROM audit_log al
     LEFT JOIN users u ON u.id = al.user_id
     ORDER BY al.created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(limit, offset)
    .all<AuditLogRow & { username: string | null }>();

  const count = await c.env.DB.prepare(
    "SELECT COUNT(*) as n FROM audit_log",
  ).first<{ n: number }>();
  return c.json({ logs: rows.results, total: count?.n ?? 0, page, limit });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function logAudit(
  db: D1Database,
  userId: string,
  action: string,
  resourceType: string | null,
  resourceId: string | null,
  metadata: unknown,
  ip: string,
) {
  const { randomId } = await import("../lib/crypto");
  await db
    .prepare(
      "INSERT INTO audit_log (id, user_id, action, resource_type, resource_id, metadata, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      randomId(),
      userId,
      action,
      resourceType,
      resourceId,
      JSON.stringify(metadata),
      ip,
      Math.floor(Date.now() / 1000),
    )
    .run();
}

function getIp(c: {
  req: { header: (h: string) => string | undefined };
}): string {
  return c.req.header("CF-Connecting-IP") ?? "unknown";
}

export default app;
