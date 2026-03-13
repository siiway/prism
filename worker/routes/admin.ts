// Admin routes: site config, user management, app moderation, audit log

import { Hono } from "hono";
import { getConfig, setConfigValues } from "../lib/config";
import { sendEmail } from "../lib/email";
import { requireAdmin } from "../middleware/auth";
import { validateImageUrl } from "../lib/imageValidation";
import {
  buildVerifiedDomainsMap,
  buildVerifiedTeamDomainsMap,
  computeVerified,
} from "../lib/domainVerify";
import { inviteEmailTemplate } from "../lib/email";
import { randomBase64url, randomId } from "../lib/crypto";
import { hashBackupCodes } from "../lib/totp";
import { deliverAdminWebhooks, hmacSign } from "../lib/webhooks";
import type {
  AuditLogRow,
  LoginErrorRow,
  OAuthAppRow,
  OAuthSourceRow,
  SiteInviteRow,
  TeamRow,
  UserRow,
  WebhookDeliveryRow,
  WebhookRow,
  Variables,
} from "../types";

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
    smtp_password: "***",
    imap_password: "***",
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
    "invite_only",
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
    "email_verify_methods",
    "email_receive_host",
    "email_receive_provider",
    "imap_host",
    "imap_port",
    "imap_secure",
    "imap_user",
    "imap_password",
    "email_api_key",
    "email_from",
    "smtp_host",
    "smtp_port",
    "smtp_secure",
    "smtp_user",
    "smtp_password",
    "custom_css",
    "accent_color",
    "login_error_retention_days",
    "social_verify_ttl_days",
    "allow_alt_email_login",
    "ipv6_rate_limit_prefix",
    "gpg_challenge_prefix",
  ]);

  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (allowed.has(k)) updates[k] = v;
  }

  if (updates.site_icon_url && typeof updates.site_icon_url === "string") {
    const imgErr = await validateImageUrl(updates.site_icon_url);
    if (imgErr) return c.json({ error: `site_icon_url: ${imgErr}` }, 400);
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
    c.executionCtx,
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

  if (body.is_active === false && id === admin.id) {
    return c.json({ error: "You cannot disable yourself" }, 403);
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
    c.executionCtx,
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
    c.executionCtx,
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

  const ownerIds = apps.results.map((a) => a.owner_id);
  const teamIds = apps.results
    .map((a) => a.team_id)
    .filter(Boolean) as string[];
  const [domainsMap, teamDomainsMap] = await Promise.all([
    buildVerifiedDomainsMap(c.env.DB, ownerIds),
    buildVerifiedTeamDomainsMap(c.env.DB, teamIds),
  ]);

  return c.json({
    apps: apps.results.map((a) => {
      const ownerDomains = domainsMap.get(a.owner_id) ?? new Set<string>();
      const teamDomains =
        teamDomainsMap.get(a.team_id ?? "") ?? new Set<string>();
      const merged = new Set([...ownerDomains, ...teamDomains]);
      return {
        ...a,
        is_verified: computeVerified(merged, a.website_url, a.redirect_uris),
      };
    }),
    total: count?.n ?? 0,
    page,
    limit,
  });
});

app.patch("/apps/:id", async (c) => {
  const admin = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json<{
    is_active?: boolean;
    is_official?: boolean;
    is_first_party?: boolean;
  }>();

  const app = await c.env.DB.prepare("SELECT id FROM oauth_apps WHERE id = ?")
    .bind(id)
    .first();
  if (!app) return c.json({ error: "App not found" }, 404);

  const updates: string[] = [];
  const values: unknown[] = [];
  if (body.is_active !== undefined) {
    updates.push("is_active = ?");
    values.push(body.is_active ? 1 : 0);
  }
  if (body.is_official !== undefined) {
    updates.push("is_official = ?");
    values.push(body.is_official ? 1 : 0);
  }
  if (body.is_first_party !== undefined) {
    updates.push("is_first_party = ?");
    values.push(body.is_first_party ? 1 : 0);
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
    c.executionCtx,
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
        provider: config.email_provider as "resend" | "mailchannels" | "smtp",
        from: config.email_from,
        apiKey: config.email_api_key,
        smtpHost: config.smtp_host,
        smtpPort: config.smtp_port,
        smtpSecure: config.smtp_secure,
        smtpUser: config.smtp_user,
        smtpPassword: config.smtp_password,
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

// ─── Test email receiving ─────────────────────────────────────────────────────

app.post("/test-email-receiving", async (c) => {
  const config = await getConfig(c.env.DB);

  if (config.email_receive_provider === "none") {
    return c.json({ error: "Receive provider is not configured" }, 400);
  }
  if (config.email_provider === "none") {
    return c.json(
      { error: "Email send provider is required to send the test email" },
      400,
    );
  }

  const testCode = randomId(12);

  // Determine the target address and subject based on receive provider
  let toAddress: string;
  let subject: string;

  if (config.email_receive_provider === "imap") {
    if (!config.imap_user) {
      return c.json({ error: "IMAP username is not configured" }, 400);
    }
    toAddress = config.imap_user;
    subject = testCode;
  } else {
    // Cloudflare Email Workers
    const emailHost =
      config.email_receive_host || new URL(c.env.APP_URL).hostname;
    toAddress = `verify-${testCode}@${emailHost}`;
    subject = `Prism — Email Receive Test`;
  }

  // Store in KV so the handler/poller can validate it
  await c.env.KV_CACHE.put(`email-receive-test:${testCode}`, "1", {
    expirationTtl: 300,
  });

  try {
    await sendEmail(
      {
        to: toAddress,
        subject,
        html: `<div style="font-family:sans-serif"><h2>Email Receive Test</h2><p>Test code: <strong>${testCode}</strong></p><p>If the receive pipeline is working, this will be picked up automatically.</p></div>`,
        text: `Email Receive Test\n\nTest code: ${testCode}\n\nIf the receive pipeline is working, this will be picked up automatically.`,
      },
      {
        provider: config.email_provider as "resend" | "mailchannels" | "smtp",
        from: config.email_from,
        apiKey: config.email_api_key,
        smtpHost: config.smtp_host,
        smtpPort: config.smtp_port,
        smtpSecure: config.smtp_secure,
        smtpUser: config.smtp_user,
        smtpPassword: config.smtp_password,
      },
    );

    return c.json({
      message: `Test email sent to ${toAddress}`,
      address: toAddress,
    });
  } catch (err) {
    return c.json(
      {
        error: err instanceof Error ? err.message : "Failed to send test email",
      },
      500,
    );
  }
});

// ─── Reset everything ─────────────────────────────────────────────────────────

app.post("/reset", async (c) => {
  const body = await c.req
    .json<{ confirm?: string }>()
    .catch(() => ({}) as { confirm?: string });
  if (body.confirm !== "RESET_EVERYTHING") {
    return c.json({ error: "Missing confirmation" }, 400);
  }

  // Delete all data in reverse dependency order (leaves first)
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM webhook_deliveries"),
    c.env.DB.prepare("DELETE FROM webhooks"),
    c.env.DB.prepare("DELETE FROM oauth_tokens"),
    c.env.DB.prepare("DELETE FROM oauth_codes"),
    c.env.DB.prepare("DELETE FROM oauth_consents"),
    c.env.DB.prepare("DELETE FROM personal_access_tokens"),
    c.env.DB.prepare("DELETE FROM sessions"),
    c.env.DB.prepare("DELETE FROM totp_authenticators"),
    c.env.DB.prepare("DELETE FROM totp_secrets"),
    c.env.DB.prepare("DELETE FROM user_totp_recovery"),
    c.env.DB.prepare("DELETE FROM passkeys"),
    c.env.DB.prepare("DELETE FROM social_connections"),
    c.env.DB.prepare("DELETE FROM user_emails"),
    c.env.DB.prepare("DELETE FROM user_notification_prefs"),
    c.env.DB.prepare("DELETE FROM user_gpg_keys"),
    c.env.DB.prepare("DELETE FROM login_errors"),
    c.env.DB.prepare("DELETE FROM domains"),
    c.env.DB.prepare("DELETE FROM audit_log"),
    c.env.DB.prepare("DELETE FROM team_invites"),
    c.env.DB.prepare("DELETE FROM team_members"),
    c.env.DB.prepare("DELETE FROM oauth_apps"),
    c.env.DB.prepare("DELETE FROM teams"),
    c.env.DB.prepare("DELETE FROM site_invites"),
    c.env.DB.prepare("DELETE FROM oauth_sources"),
    c.env.DB.prepare("DELETE FROM users"),
    c.env.DB.prepare("DELETE FROM site_config"),
  ]);

  // Flush both KV namespaces (paginated to handle > 1000 keys)
  const flushKv = async (kv: KVNamespace) => {
    let cursor: string | undefined;
    do {
      const result = await kv.list({ cursor });
      await Promise.all(result.keys.map((k) => kv.delete(k.name)));
      cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);
  };
  await Promise.all([flushKv(c.env.KV_SESSIONS), flushKv(c.env.KV_CACHE)]);

  return c.json({ message: "Platform reset complete" });
});

// ─── Migrate recovery codes to hashed format ──────────────────────────────────

app.post("/migrate-recovery-codes", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT user_id, backup_codes FROM user_totp_recovery",
  ).all<{ user_id: string; backup_codes: string }>();

  const now = Math.floor(Date.now() / 1000);
  let migrated = 0;
  const stmts = [];

  for (const row of rows.results) {
    const codes = JSON.parse(row.backup_codes) as string[];
    if (codes.every((c) => c.startsWith("$sha256$"))) continue; // already hashed

    const hashed = await hashBackupCodes(codes);
    stmts.push(
      c.env.DB.prepare(
        "UPDATE user_totp_recovery SET backup_codes = ?, updated_at = ? WHERE user_id = ?",
      ).bind(JSON.stringify(hashed), now, row.user_id),
    );
    migrated++;
  }

  if (stmts.length > 0) await c.env.DB.batch(stmts);

  return c.json({ migrated });
});

// ─── Team administration ──────────────────────────────────────────────────────

app.get("/teams", async (c) => {
  const page = parseInt(c.req.query("page") ?? "1");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20"), 100);
  const offset = (page - 1) * limit;

  const [teams, count] = await Promise.all([
    c.env.DB.prepare(
      `SELECT t.*,
              (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count,
              (SELECT COUNT(*) FROM oauth_apps WHERE team_id = t.id) as app_count,
              (SELECT u.username FROM team_members tm JOIN users u ON u.id = tm.user_id
               WHERE tm.team_id = t.id AND tm.role = 'owner' LIMIT 1) as owner_username
       FROM teams t ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(limit, offset)
      .all<
        TeamRow & {
          member_count: number;
          app_count: number;
          owner_username: string | null;
        }
      >(),
    c.env.DB.prepare("SELECT COUNT(*) as n FROM teams").first<{ n: number }>(),
  ]);

  return c.json({ teams: teams.results, total: count?.n ?? 0, page, limit });
});

app.delete("/teams/:id", async (c) => {
  const admin = c.get("user");
  const id = c.req.param("id");

  const team = await c.env.DB.prepare("SELECT id FROM teams WHERE id = ?")
    .bind(id)
    .first();
  if (!team) return c.json({ error: "Team not found" }, 404);

  // Disown team apps before deleting
  await c.env.DB.prepare(
    "UPDATE oauth_apps SET team_id = NULL WHERE team_id = ?",
  )
    .bind(id)
    .run();
  await c.env.DB.prepare("DELETE FROM teams WHERE id = ?").bind(id).run();

  await logAudit(
    c.env.DB,
    admin.id,
    "admin.team.delete",
    "team",
    id,
    {},
    getIp(c),
    c.executionCtx,
  );
  return c.json({ message: "Team deleted" });
});

// ─── Statistics ───────────────────────────────────────────────────────────────

app.get("/stats", async (c) => {
  const [userCount, appCount, teamCount, domainCount, tokenCount] =
    await Promise.all([
      c.env.DB.prepare("SELECT COUNT(*) as n FROM users").first<{
        n: number;
      }>(),
      c.env.DB.prepare("SELECT COUNT(*) as n FROM oauth_apps").first<{
        n: number;
      }>(),
      c.env.DB.prepare("SELECT COUNT(*) as n FROM teams").first<{
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
    teams: teamCount?.n ?? 0,
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

// ─── Login error log ──────────────────────────────────────────────────────────

app.get("/login-errors", async (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1"));
  const limit = Math.min(
    Math.max(1, parseInt(c.req.query("limit") ?? "50")),
    200,
  );
  const offset = (page - 1) * limit;
  const qCode = c.req.query("error_code") ?? "";
  const qIdentifier = c.req.query("identifier") ?? "";
  const qIp = c.req.query("ip") ?? "";

  // Lazy cleanup: purge expired records in the background
  const config = await getConfig(c.env.DB);
  const retentionDays = config.login_error_retention_days ?? 30;
  if (retentionDays > 0) {
    const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 86400;
    c.executionCtx.waitUntil(
      c.env.DB.prepare("DELETE FROM login_errors WHERE created_at < ?")
        .bind(cutoff)
        .run()
        .catch(() => {}),
    );
  }

  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (qCode) {
    conditions.push("error_code = ?");
    params.push(qCode);
  }
  if (qIdentifier) {
    conditions.push("identifier LIKE ?");
    params.push(`%${qIdentifier}%`);
  }
  if (qIp) {
    conditions.push("ip_address LIKE ?");
    params.push(`%${qIp}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [rows, count] = await Promise.all([
    c.env.DB.prepare(
      `SELECT * FROM login_errors ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(...params, limit, offset)
      .all<LoginErrorRow>(),
    c.env.DB.prepare(`SELECT COUNT(*) as n FROM login_errors ${where}`)
      .bind(...params)
      .first<{ n: number }>(),
  ]);

  return c.json({ errors: rows.results, total: count?.n ?? 0, page, limit });
});

// ─── Request logs ─────────────────────────────────────────────────────────────

app.get("/request-logs", async (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1"));
  const limit = Math.min(
    Math.max(1, parseInt(c.req.query("limit") ?? "50")),
    200,
  );
  const offset = (page - 1) * limit;
  const qMethod = c.req.query("method") ?? "";
  const qPath = c.req.query("path") ?? "";
  const qStatus = c.req.query("status") ?? "";
  const qUserId = c.req.query("user_id") ?? "";

  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (qMethod) {
    conditions.push("method = ?");
    params.push(qMethod.toUpperCase());
  }
  if (qPath) {
    conditions.push("path LIKE ?");
    params.push(`%${qPath}%`);
  }
  if (qStatus) {
    const s = parseInt(qStatus);
    if (!isNaN(s)) {
      if (s === 200) {
        conditions.push("status >= 200 AND status < 300");
      } else if (s === 400) {
        conditions.push("status >= 400 AND status < 500");
      } else if (s === 500) {
        conditions.push("status >= 500");
      } else {
        conditions.push("status = ?");
        params.push(s);
      }
    }
  }
  if (qUserId) {
    conditions.push("user_id = ?");
    params.push(qUserId);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [rows, count] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, method, path, status, duration_ms, ip_address, user_agent, user_id, created_at FROM request_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(...params, limit, offset)
      .all<{
        id: string;
        method: string;
        path: string;
        status: number;
        duration_ms: number;
        ip_address: string | null;
        user_agent: string | null;
        user_id: string | null;
        created_at: number;
      }>(),
    c.env.DB.prepare(`SELECT COUNT(*) as n FROM request_logs ${where}`)
      .bind(...params)
      .first<{ n: number }>(),
  ]);

  return c.json({ logs: rows.results, total: count?.n ?? 0, page, limit });
});

app.get("/request-logs/:id/details", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT details FROM request_logs WHERE id = ?",
  )
    .bind(c.req.param("id"))
    .first<{ details: string | null }>();
  if (!row) return c.json({ error: "Not found" }, 404);
  try {
    return c.json({ details: row.details ? JSON.parse(row.details) : null });
  } catch {
    return c.json({ details: null });
  }
});

// ─── Debug config (logging toggle + spectate user) ────────────────────────────

app.delete("/request-logs", async (c) => {
  await c.env.DB.prepare("DELETE FROM request_logs").run();
  return c.json({ ok: true });
});

app.delete("/request-logs/spectate", async (c) => {
  await c.env.DB.prepare(
    "DELETE FROM request_logs WHERE details IS NOT NULL",
  ).run();
  return c.json({ ok: true });
});

app.get("/debug", async (c) => {
  const [enabled, spectateUserId, spectatePath] = await Promise.all([
    c.env.KV_SESSIONS.get("system:request_logging_enabled"),
    c.env.KV_SESSIONS.get("system:spectate_user_id"),
    c.env.KV_SESSIONS.get("system:spectate_path"),
  ]);
  return c.json({
    logging_enabled: enabled === "true",
    spectate_user_id: spectateUserId ?? null,
    spectate_path: spectatePath ?? null,
  });
});

app.post("/debug", async (c) => {
  const body = await c.req.json<{
    logging_enabled?: boolean;
    spectate_user_id?: string | null;
    spectate_path?: string | null;
  }>();

  await Promise.all([
    body.logging_enabled !== undefined
      ? c.env.KV_SESSIONS.put(
          "system:request_logging_enabled",
          body.logging_enabled ? "true" : "false",
        )
      : Promise.resolve(),
    "spectate_user_id" in body
      ? body.spectate_user_id
        ? c.env.KV_SESSIONS.put(
            "system:spectate_user_id",
            body.spectate_user_id,
          )
        : c.env.KV_SESSIONS.delete("system:spectate_user_id")
      : Promise.resolve(),
    "spectate_path" in body
      ? body.spectate_path
        ? c.env.KV_SESSIONS.put("system:spectate_path", body.spectate_path)
        : c.env.KV_SESSIONS.delete("system:spectate_path")
      : Promise.resolve(),
  ]);

  return c.json({ ok: true });
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
  ctx: ExecutionContext,
) {
  const now = Math.floor(Date.now() / 1000);
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
      now,
    )
    .run();
  // Fire webhooks subscribed to this event — best-effort, non-blocking
  ctx.waitUntil(
    deliverAdminWebhooks(db, action, {
      user_id: userId,
      resource_type: resourceType,
      resource_id: resourceId,
      metadata,
      ip,
      timestamp: now,
    }).catch(() => {}),
  );
}

// ─── Site Invites ─────────────────────────────────────────────────────────────

// List all invites
app.get("/invites", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT i.*, u.username AS created_by_username
     FROM site_invites i
     LEFT JOIN users u ON u.id = i.created_by
     ORDER BY i.created_at DESC`,
  ).all<SiteInviteRow & { created_by_username: string | null }>();
  return c.json({ invites: results });
});

// Create invite (optionally send email)
app.post("/invites", async (c) => {
  const admin = c.get("user");
  const body = await c.req.json<{
    email?: string;
    note?: string;
    max_uses?: number;
    expires_in_days?: number;
    send_email?: boolean;
  }>();

  const config = await getConfig(c.env.DB);
  const now = Math.floor(Date.now() / 1000);
  const id = randomId();
  const token = randomBase64url(24);
  const expiresAt = body.expires_in_days
    ? now + body.expires_in_days * 86400
    : null;

  await c.env.DB.prepare(
    `INSERT INTO site_invites (id, token, email, note, max_uses, use_count, created_by, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  )
    .bind(
      id,
      token,
      body.email?.toLowerCase().trim() ?? null,
      body.note ?? null,
      body.max_uses ?? null,
      admin.id,
      expiresAt,
      now,
    )
    .run();

  const inviteUrl = `${c.env.APP_URL}/register?invite=${token}`;

  if (body.send_email && body.email && config.email_provider !== "none") {
    const tmpl = inviteEmailTemplate(config.site_name, inviteUrl, body.note);
    await sendEmail(
      {
        to: body.email,
        subject: `You've been invited to ${config.site_name}`,
        ...tmpl,
      },
      {
        provider: config.email_provider,
        from: config.email_from,
        apiKey: config.email_api_key,
        smtpHost: config.smtp_host,
        smtpPort: config.smtp_port,
        smtpSecure: config.smtp_secure,
        smtpUser: config.smtp_user,
        smtpPassword: config.smtp_password,
      },
    );
  }

  await logAudit(
    c.env.DB,
    admin.id,
    "invite.create",
    "site_invite",
    id,
    { email: body.email ?? null },
    getIp(c),
    c.executionCtx,
  );

  return c.json({ invite: { id, token, invite_url: inviteUrl } }, 201);
});

// Revoke (delete) invite
app.delete("/invites/:id", async (c) => {
  const admin = c.get("user");
  const { id } = c.req.param();

  const invite = await c.env.DB.prepare(
    "SELECT id FROM site_invites WHERE id = ?",
  )
    .bind(id)
    .first<{ id: string }>();
  if (!invite) return c.json({ error: "Invite not found" }, 404);

  await c.env.DB.prepare("DELETE FROM site_invites WHERE id = ?")
    .bind(id)
    .run();

  await logAudit(
    c.env.DB,
    admin.id,
    "invite.revoke",
    "site_invite",
    id,
    {},
    getIp(c),
    c.executionCtx,
  );

  return c.json({ message: "Invite revoked" });
});

// ─── OAuth Sources ─────────────────────────────────────────────────────────────

const VALID_PROVIDERS = new Set([
  "github",
  "google",
  "microsoft",
  "discord",
  "oidc",
  "oauth2",
]);
const GENERIC_PROVIDERS = new Set(["oidc", "oauth2"]);

const LEGACY_PROVIDER_KEYS = [
  { slug: "github", provider: "github", name: "GitHub" },
  { slug: "google", provider: "google", name: "Google" },
  { slug: "microsoft", provider: "microsoft", name: "Microsoft" },
  { slug: "discord", provider: "discord", name: "Discord" },
] as const;

app.get("/oauth-sources", async (c) => {
  const [{ results }, config] = await Promise.all([
    c.env.DB.prepare(
      "SELECT id, slug, provider, name, enabled, created_at, auth_url, token_url, userinfo_url, scopes, issuer_url FROM oauth_sources ORDER BY created_at ASC",
    ).all<Omit<OAuthSourceRow, "client_id" | "client_secret">>(),
    getConfig(c.env.DB),
  ]);

  const existingSlugs = new Set(results.map((r) => r.slug));
  const cfg = config as unknown as Record<string, unknown>;
  const legacy_providers = LEGACY_PROVIDER_KEYS.filter(
    (p) => !!cfg[`${p.slug}_client_id`] && !existingSlugs.has(p.slug),
  ).map((p) => p.slug);

  return c.json({ sources: results, legacy_providers });
});

// ─── OIDC Discovery ───────────────────────────────────────────────────────────

app.get("/oauth-sources/discover", async (c) => {
  const issuer = c.req.query("issuer");
  if (!issuer) return c.json({ error: "issuer query parameter required" }, 400);

  let issuerUrl: URL;
  try {
    issuerUrl = new URL(issuer);
    if (issuerUrl.protocol !== "https:") throw new Error("HTTPS required");
  } catch {
    return c.json(
      { error: "Invalid issuer URL — must be a valid HTTPS URL" },
      400,
    );
  }

  // Canonical discovery document path per OpenID Connect Discovery 1.0
  const base = issuer.replace(/\/$/, "");
  const discoveryUrl = `${base}/.well-known/openid-configuration`;

  let doc: Record<string, unknown>;
  try {
    const res = await fetch(discoveryUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok)
      return c.json(
        { error: `Discovery endpoint returned HTTP ${res.status}` },
        502,
      );
    doc = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    return c.json(
      {
        error: `Failed to fetch discovery document: ${err instanceof Error ? err.message : String(err)}`,
      },
      502,
    );
  }

  const auth_url = doc.authorization_endpoint as string | undefined;
  const token_url = doc.token_endpoint as string | undefined;
  const userinfo_url = doc.userinfo_endpoint as string | undefined;

  if (!auth_url || !token_url || !userinfo_url)
    return c.json(
      {
        error:
          "Discovery document missing required endpoints (authorization_endpoint, token_endpoint, userinfo_endpoint)",
      },
      422,
    );

  return c.json({ auth_url, token_url, userinfo_url });
});

// ─── Migrate legacy site_config OAuth credentials to oauth_sources ─────────────

app.post("/oauth-sources/migrate", async (c) => {
  const config = await getConfig(c.env.DB);
  const migrated: string[] = [];
  const skipped: string[] = [];

  const cfg = config as unknown as Record<string, unknown>;
  for (const { slug, provider, name } of LEGACY_PROVIDER_KEYS) {
    const clientId = cfg[`${slug}_client_id`] as string;
    const clientSecret = cfg[`${slug}_client_secret`] as string;

    if (!clientId) continue;

    const existing = await c.env.DB.prepare(
      "SELECT id FROM oauth_sources WHERE slug = ?",
    )
      .bind(slug)
      .first();

    if (existing) {
      skipped.push(slug);
      continue;
    }

    const id = randomId();
    const now = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare(
      "INSERT INTO oauth_sources (id, slug, provider, name, client_id, client_secret, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
    )
      .bind(id, slug, provider, name, clientId, clientSecret ?? "", now)
      .run();

    migrated.push(slug);
  }

  return c.json({ migrated, skipped });
});

app.post("/oauth-sources", async (c) => {
  const admin = c.get("user");
  const body = await c.req.json<{
    slug: string;
    provider: string;
    name: string;
    client_id: string;
    client_secret: string;
    auth_url?: string;
    token_url?: string;
    userinfo_url?: string;
    scopes?: string;
    issuer_url?: string;
  }>();

  if (
    !body.slug ||
    !body.provider ||
    !body.name ||
    !body.client_id ||
    !body.client_secret
  )
    return c.json(
      {
        error: "slug, provider, name, client_id and client_secret are required",
      },
      400,
    );

  if (!VALID_PROVIDERS.has(body.provider))
    return c.json(
      {
        error: `Invalid provider. Must be one of: ${[...VALID_PROVIDERS].join(", ")}`,
      },
      400,
    );

  if (!/^[a-z0-9-]{1,64}$/.test(body.slug))
    return c.json(
      {
        error: "slug must be 1-64 lowercase alphanumeric characters or hyphens",
      },
      400,
    );

  if (GENERIC_PROVIDERS.has(body.provider)) {
    if (!body.auth_url || !body.token_url || !body.userinfo_url)
      return c.json(
        {
          error:
            "auth_url, token_url and userinfo_url are required for generic providers",
        },
        400,
      );
  }

  const id = randomId();
  const now = Math.floor(Date.now() / 1000);

  try {
    await c.env.DB.prepare(
      "INSERT INTO oauth_sources (id, slug, provider, name, client_id, client_secret, enabled, created_at, auth_url, token_url, userinfo_url, scopes, issuer_url) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        id,
        body.slug,
        body.provider,
        body.name,
        body.client_id,
        body.client_secret,
        now,
        body.auth_url ?? null,
        body.token_url ?? null,
        body.userinfo_url ?? null,
        body.scopes ?? null,
        body.issuer_url ?? null,
      )
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("UNIQUE"))
      return c.json({ error: "A source with this slug already exists" }, 409);
    throw err;
  }

  await logAudit(
    c.env.DB,
    admin.id,
    "oauth_source.create",
    "oauth_source",
    id,
    { slug: body.slug, provider: body.provider },
    getIp(c),
    c.executionCtx,
  );
  return c.json(
    {
      source: {
        id,
        slug: body.slug,
        provider: body.provider,
        name: body.name,
        enabled: 1,
      },
    },
    201,
  );
});

app.patch("/oauth-sources/:id", async (c) => {
  const admin = c.get("user");
  const { id } = c.req.param();

  const existing = await c.env.DB.prepare(
    "SELECT id FROM oauth_sources WHERE id = ?",
  )
    .bind(id)
    .first();
  if (!existing) return c.json({ error: "Source not found" }, 404);

  const body = await c.req.json<{
    name?: string;
    client_id?: string;
    client_secret?: string;
    enabled?: boolean;
    auth_url?: string;
    token_url?: string;
    userinfo_url?: string;
    scopes?: string;
    issuer_url?: string;
  }>();

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.name !== undefined) {
    sets.push("name = ?");
    vals.push(body.name);
  }
  if (body.client_id !== undefined) {
    sets.push("client_id = ?");
    vals.push(body.client_id);
  }
  if (body.client_secret !== undefined) {
    sets.push("client_secret = ?");
    vals.push(body.client_secret);
  }
  if (body.enabled !== undefined) {
    sets.push("enabled = ?");
    vals.push(body.enabled ? 1 : 0);
  }
  if (body.auth_url !== undefined) {
    sets.push("auth_url = ?");
    vals.push(body.auth_url || null);
  }
  if (body.token_url !== undefined) {
    sets.push("token_url = ?");
    vals.push(body.token_url || null);
  }
  if (body.userinfo_url !== undefined) {
    sets.push("userinfo_url = ?");
    vals.push(body.userinfo_url || null);
  }
  if (body.scopes !== undefined) {
    sets.push("scopes = ?");
    vals.push(body.scopes || null);
  }
  if (body.issuer_url !== undefined) {
    sets.push("issuer_url = ?");
    vals.push(body.issuer_url || null);
  }

  if (!sets.length) return c.json({ error: "Nothing to update" }, 400);

  vals.push(id);
  await c.env.DB.prepare(
    `UPDATE oauth_sources SET ${sets.join(", ")} WHERE id = ?`,
  )
    .bind(...vals)
    .run();

  await logAudit(
    c.env.DB,
    admin.id,
    "oauth_source.update",
    "oauth_source",
    id,
    {},
    getIp(c),
    c.executionCtx,
  );
  return c.json({ message: "Updated" });
});

app.delete("/oauth-sources/:id", async (c) => {
  const admin = c.get("user");
  const { id } = c.req.param();

  const existing = await c.env.DB.prepare(
    "SELECT slug FROM oauth_sources WHERE id = ?",
  )
    .bind(id)
    .first<{ slug: string }>();
  if (!existing) return c.json({ error: "Source not found" }, 404);

  await c.env.DB.prepare("DELETE FROM oauth_sources WHERE id = ?")
    .bind(id)
    .run();
  await logAudit(
    c.env.DB,
    admin.id,
    "oauth_source.delete",
    "oauth_source",
    id,
    { slug: existing.slug },
    getIp(c),
    c.executionCtx,
  );
  return c.json({ message: "Deleted" });
});

function getIp(c: {
  req: { header: (h: string) => string | undefined };
}): string {
  return c.req.header("CF-Connecting-IP") ?? "unknown";
}

// ─── Webhooks ────────────────────────────────────────────────────────────────

// Events that can be subscribed to (mirrors audit log actions + wildcard)
const ALL_WEBHOOK_EVENTS = [
  "*",
  "admin.config.update",
  "admin.user.update",
  "admin.user.delete",
  "admin.app.update",
  "admin.team.delete",
  "invite.create",
  "invite.revoke",
  "oauth_source.create",
  "oauth_source.update",
  "oauth_source.delete",
  "webhook.create",
  "webhook.update",
  "webhook.delete",
] as const;

// List all webhooks (secret omitted)
app.get("/webhooks", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, url, events, is_active, created_at, updated_at FROM webhooks WHERE user_id IS NULL ORDER BY created_at DESC",
  ).all<Omit<WebhookRow, "secret" | "created_by">>();
  return c.json({ webhooks: results });
});

// Create a webhook
app.post("/webhooks", async (c) => {
  const body = await c.req.json<{
    name: string;
    url: string;
    secret?: string;
    events: string[];
  }>();

  if (!body.name?.trim() || !body.url?.trim())
    return c.json({ error: "name and url are required" }, 400);

  try {
    new URL(body.url);
  } catch {
    return c.json({ error: "Invalid URL" }, 400);
  }

  const events = Array.isArray(body.events)
    ? body.events.filter((e) =>
        (ALL_WEBHOOK_EVENTS as readonly string[]).includes(e),
      )
    : [];
  const secret = body.secret?.trim() || randomBase64url(32);
  const now = Math.floor(Date.now() / 1000);
  const id = randomId();

  await c.env.DB.prepare(
    "INSERT INTO webhooks (id, name, url, secret, events, is_active, user_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, NULL, ?, ?, ?)",
  )
    .bind(
      id,
      body.name.trim(),
      body.url.trim(),
      secret,
      JSON.stringify(events),
      c.get("user").id,
      now,
      now,
    )
    .run();

  await logAudit(
    c.env.DB,
    c.get("user").id,
    "webhook.create",
    "webhook",
    id,
    { name: body.name, url: body.url },
    getIp(c),
    c.executionCtx,
  );

  return c.json(
    {
      webhook: {
        id,
        name: body.name,
        url: body.url,
        secret,
        events,
        is_active: 1,
        created_at: now,
      },
    },
    201,
  );
});

// Get one webhook (secret omitted)
app.get("/webhooks/:id", async (c) => {
  const wh = await c.env.DB.prepare(
    "SELECT id, name, url, events, is_active, created_at, updated_at FROM webhooks WHERE id = ? AND user_id IS NULL",
  )
    .bind(c.req.param("id"))
    .first<Omit<WebhookRow, "secret" | "created_by">>();
  if (!wh) return c.json({ error: "Not found" }, 404);
  return c.json({ webhook: wh });
});

// Update a webhook
app.patch("/webhooks/:id", async (c) => {
  const existing = await c.env.DB.prepare(
    "SELECT id FROM webhooks WHERE id = ? AND user_id IS NULL",
  )
    .bind(c.req.param("id"))
    .first();
  if (!existing) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json<{
    name?: string;
    url?: string;
    secret?: string;
    events?: string[];
    is_active?: boolean;
  }>();

  const sets: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    sets.push("name = ?");
    values.push(body.name.trim());
  }
  if (body.url !== undefined) {
    try {
      new URL(body.url);
    } catch {
      return c.json({ error: "Invalid URL" }, 400);
    }
    sets.push("url = ?");
    values.push(body.url.trim());
  }
  if (body.secret !== undefined) {
    sets.push("secret = ?");
    values.push(body.secret);
  }
  if (body.events !== undefined) {
    const filtered = body.events.filter((e) =>
      (ALL_WEBHOOK_EVENTS as readonly string[]).includes(e),
    );
    sets.push("events = ?");
    values.push(JSON.stringify(filtered));
  }
  if (body.is_active !== undefined) {
    sets.push("is_active = ?");
    values.push(body.is_active ? 1 : 0);
  }

  if (!sets.length) return c.json({ error: "Nothing to update" }, 400);

  sets.push("updated_at = ?");
  values.push(Math.floor(Date.now() / 1000));
  values.push(c.req.param("id"));

  await c.env.DB.prepare(`UPDATE webhooks SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  await logAudit(
    c.env.DB,
    c.get("user").id,
    "webhook.update",
    "webhook",
    c.req.param("id"),
    body,
    getIp(c),
    c.executionCtx,
  );

  return c.json({ message: "Updated" });
});

// Delete a webhook
app.delete("/webhooks/:id", async (c) => {
  const wh = await c.env.DB.prepare(
    "SELECT id FROM webhooks WHERE id = ? AND user_id IS NULL",
  )
    .bind(c.req.param("id"))
    .first();
  if (!wh) return c.json({ error: "Not found" }, 404);

  await c.env.DB.prepare("DELETE FROM webhooks WHERE id = ?")
    .bind(c.req.param("id"))
    .run();

  await logAudit(
    c.env.DB,
    c.get("user").id,
    "webhook.delete",
    "webhook",
    c.req.param("id"),
    {},
    getIp(c),
    c.executionCtx,
  );
  return c.json({ message: "Deleted" });
});

// Send a test ping to a webhook, record the delivery
app.post("/webhooks/:id/test", async (c) => {
  const wh = await c.env.DB.prepare(
    "SELECT id, url, secret FROM webhooks WHERE id = ? AND user_id IS NULL",
  )
    .bind(c.req.param("id"))
    .first<Pick<WebhookRow, "id" | "url" | "secret">>();
  if (!wh) return c.json({ error: "Not found" }, 404);

  const now = Math.floor(Date.now() / 1000);
  const deliveryId = randomId();
  const payload = JSON.stringify({
    event: "webhook.test",
    timestamp: now,
    data: { message: "Test delivery from Prism" },
  });

  const sig = await hmacSign(wh.secret, payload);
  let status: number | null = null;
  let response: string | null = null;
  let success = false;

  try {
    const res = await fetch(wh.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Prism-Event": "webhook.test",
        "X-Prism-Signature": `sha256=${sig}`,
        "X-Prism-Delivery": deliveryId,
      },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    response = (await res.text()).slice(0, 512);
    success = status >= 200 && status < 300;
  } catch (err) {
    response = String(err).slice(0, 512);
  }

  await c.env.DB.prepare(
    "INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload, response_status, response_body, success, delivered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      deliveryId,
      wh.id,
      "webhook.test",
      payload,
      status,
      response,
      success ? 1 : 0,
      now,
    )
    .run();

  return c.json({ success, status, response });
});

// List recent deliveries for a webhook
app.get("/webhooks/:id/deliveries", async (c) => {
  const wh = await c.env.DB.prepare(
    "SELECT id FROM webhooks WHERE id = ? AND user_id IS NULL",
  )
    .bind(c.req.param("id"))
    .first();
  if (!wh) return c.json({ error: "Not found" }, 404);

  const { results } = await c.env.DB.prepare(
    "SELECT id, event_type, response_status, success, delivered_at FROM webhook_deliveries WHERE webhook_id = ? ORDER BY delivered_at DESC LIMIT 50",
  )
    .bind(c.req.param("id"))
    .all<
      Pick<
        WebhookDeliveryRow,
        "id" | "event_type" | "response_status" | "success" | "delivered_at"
      >
    >();

  return c.json({ deliveries: results });
});

// Get full payload for a specific delivery
app.get("/webhooks/:id/deliveries/:deliveryId", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT id, event_type, payload, response_status, response_body, success, delivered_at FROM webhook_deliveries WHERE id = ? AND webhook_id = ?",
  )
    .bind(c.req.param("deliveryId"), c.req.param("id"))
    .first<Omit<WebhookDeliveryRow, "webhook_id">>();
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ delivery: row });
});

export default app;
