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
import type {
  AuditLogRow,
  OAuthAppRow,
  OAuthSourceRow,
  SiteInviteRow,
  TeamRow,
  UserRow,
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
    "email_api_key",
    "email_from",
    "smtp_host",
    "smtp_port",
    "smtp_secure",
    "smtp_user",
    "smtp_password",
    "custom_css",
    "accent_color",
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

// ─── Reset everything ─────────────────────────────────────────────────────────

app.post("/reset", async (c) => {
  const body = await c.req
    .json<{ confirm?: string }>()
    .catch(() => ({}) as { confirm?: string });
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
    c.env.DB.prepare("DELETE FROM teams"),
    c.env.DB.prepare("DELETE FROM users"),
    c.env.DB.prepare("DELETE FROM site_config"),
  ]);

  // Rotate JWT secret so all existing tokens become invalid
  await c.env.KV_SESSIONS.delete("system:jwt_secret");

  return c.json({ message: "Platform reset complete" });
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
  );
  return c.json({ message: "Deleted" });
});

function getIp(c: {
  req: { header: (h: string) => string | undefined };
}): string {
  return c.req.header("CF-Connecting-IP") ?? "unknown";
}

export default app;
