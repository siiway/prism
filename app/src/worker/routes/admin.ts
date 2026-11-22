// Admin routes: site config, user management, app moderation, audit log

import { Hono, type Context } from "hono";
import {
  samlOverrideValue,
  samlOwnerSetting,
} from "../lib/saml/serviceProviders";
import { getConfig } from "../lib/config";
import { emailInUse } from "../lib/accountEmails";
import {
  ADMIN_CONFIG_KEYS,
  auditableConfigUpdates,
  prepareConfigUpdates,
  saveConfigUpdates,
} from "../lib/adminConfig";
import { hashLookupCandidate } from "../lib/secretCrypto";
import { sendEmail } from "../lib/email";
import { hashBackupCodes } from "../lib/totp";
import { requireAdmin } from "../middleware/auth";
import { validateImageUrl } from "../lib/imageValidation";
import { readPage, likePattern } from "../lib/pagination";
import {
  collectReferencedImageUrls,
  forgetImageProxyMapping,
  proxyImageUrl,
  registerImageProxyMapping,
  sweepOrphanedImageProxyMappings,
} from "../lib/proxyImage";
import {
  buildVerifiedDomainsMap,
  buildVerifiedTeamDomainsMap,
  computeVerified,
} from "../lib/domainVerify";
import { randomId } from "../lib/crypto";

import {
  PLATFORM_AUDIT,
  auditAdmin,
  auditRequestAction,
  recordAccountDeletion,
  auditRequestMeta,
} from "../lib/audit";
import {
  dissolveTeam,
  teamUserSyntheticEmail,
  teamUserSyntheticUsername,
} from "../lib/teams";
import type {
  LoginErrorRow,
  OAuthAppRow,
  TeamRow,
  UserRow,
  Variables,
} from "../types";
import { isUserLocked, isTeamLocked } from "../lib/lockdown";
import {
  hasLiveRestrictedAccounts,
  parseInviteRegistrationExemptions,
} from "../lib/userCapabilities";

import adminDbRoutes from "./admin-db";
import adminKvRoutes from "./admin-kv";
import adminMaintenanceRoutes from "./admin-maintenance";
import adminOpsRoutes from "./admin-ops";
import { adminRoutes as adminNoticeRoutes } from "./notices";
import { adminRoutes as adminLegalRoutes } from "./legal";
import adminUserRoutes from "./admin-users";
import adminSecretsRoutes from "./admin-secrets";
import adminResetRoutes from "./admin-reset";
import adminInviteRoutes from "./admin-invites";
import adminSourceRoutes from "./admin-sources";
import type { ImageProxyResourceType } from "../../shared/codes";
import { displayNameError } from "../lib/displayName";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

app.use("*", requireAdmin);

// Direct database access — schema browser, row editor and SQL console.
// Mounted here so it inherits requireAdmin rather than re-deriving it.
app.route("/db", adminDbRoutes);
// The same window onto KV.
app.route("/kv", adminKvRoutes);
// Instance-wide operations: mass revocation, site-wide domains, application
// transfer, lifting an account restriction. Registered before the concrete
// routes below so its /domains and /apps/:id/transfer paths resolve; the
// deeper /users/:id/* routes it adds sit alongside adminUserRoutes.
app.route("/", adminOpsRoutes);
// The scheduled jobs, runnable on demand.
app.route("/maintenance", adminMaintenanceRoutes);
// Notice board authoring. The reader half is mounted at /api/notices with
// optional auth, since public notices exist for people who cannot sign in.
app.route("/notices", adminNoticeRoutes);
// Legal page authoring (Privacy Policy, Terms of Service). The reader half is
// mounted at /api/legal — the pages are public.
app.route("/legal", adminLegalRoutes);

// ─── Site configuration ───────────────────────────────────────────────────────

app.get("/config", async (c) => {
  const config = await getConfig(c.env.DB);
  // Strip secret keys from response
  const safeConfig = {
    ...config,
    captcha_secret_key: "***",
    turnstile_china_secret_key: "***",
    turnstile_secret_key: "***",
    hcaptcha_secret_key: "***",
    recaptcha_secret_key: "***",
    geetest_captcha_key: "***",
    cap_secret_key: "***",
    github_client_secret: "***",
    google_client_secret: "***",
    microsoft_client_secret: "***",
    discord_client_secret: "***",
    discord_bot_token: config.discord_bot_token ? "***" : "",
    github_readme_token: config.github_readme_token ? "***" : "",
    email_api_key: "***",
    smtp_password: "***",
    imap_password: "***",
  };
  return c.json({ config: safeConfig });
});

app.patch("/config", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();

  const prepared = await prepareConfigUpdates(body, (k) =>
    ADMIN_CONFIG_KEYS.has(k),
  );
  if ("refused" in prepared) return c.json(prepared.refused, 400);
  const { updates } = prepared;
  await saveConfigUpdates(c.env, updates);

  auditAdmin(
    c,
    "admin.config.update",
    "site_config",
    null,
    auditableConfigUpdates(updates),
  );
  return c.json({ updated: Object.keys(updates) });
});

app.route("/", adminSecretsRoutes);

// ─── User management ──────────────────────────────────────────────────────────

app.get("/users", async (c) => {
  const { page, limit, offset } = readPage(
    c.req.query("page"),
    c.req.query("limit"),
    20,
    100,
  );
  const search = c.req.query("search") ?? "";

  // Hide synthetic team-user rows from the user list — they're surfaced
  // through the dedicated teams admin page.
  const whereClause = search
    ? `WHERE u.kind = 'user' AND (u.email LIKE ? ESCAPE '\\'
                                  OR u.username LIKE ? ESCAPE '\\'
                                  OR u.display_name LIKE ? ESCAPE '\\')`
    : "WHERE u.kind = 'user'";
  const searchParam = likePattern(search);
  const params = search ? [searchParam, searchParam, searchParam] : [];

  const [usersResult, countResult] = await Promise.all([
    c.env.DB.prepare(
      `SELECT u.id, u.email, u.username, u.display_name, u.avatar_url, u.role, u.email_verified, u.is_active, u.created_at,
              (SELECT COUNT(*) FROM oauth_apps WHERE owner_id = u.id AND team_id IS NULL) as app_count
       FROM users u ${whereClause} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(...params, limit, offset)
      .all(),
    c.env.DB.prepare(`SELECT COUNT(*) as n FROM users u ${whereClause}`)
      .bind(...params)
      .first<{ n: number }>(),
  ]);

  const users = await Promise.all(
    usersResult.results.map(async (user) => ({
      ...user,
      avatar_url: await proxyImageUrl(
        c.env.APP_URL,
        c.env.DB,
        typeof user.avatar_url === "string" ? user.avatar_url : null,
      ),
    })),
  );

  return c.json({
    users,
    total: countResult?.n ?? 0,
    page,
    limit,
  });
});

app.get("/users/:id", async (c) => {
  const id = c.req.param("id");
  const user = await c.env.DB.prepare(
    "SELECT * FROM users WHERE id = ? AND kind = 'user'",
  )
    .bind(id)
    .first<UserRow>();
  if (!user) return c.json({ error: "user_not_found" }, 404);

  const [apps, connections, sessions] = await Promise.all([
    c.env.DB.prepare(
      "SELECT id, name, client_id, is_active, created_at FROM oauth_apps WHERE owner_id = ? AND team_id IS NULL",
    )
      .bind(id)
      .all(),
    c.env.DB.prepare(
      "SELECT provider, connected_at FROM social_connections WHERE user_id = ?",
    )
      .bind(id)
      .all(),
    c.env.DB.prepare(
      "SELECT id, user_agent, ip_address, created_at, expires_at FROM sessions WHERE user_id = ? AND expires_at > ?",
    )
      .bind(id, Math.floor(Date.now() / 1000))
      .all(),
  ]);

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      display_name: user.display_name,
      avatar_url: await proxyImageUrl(c.env.APP_URL, c.env.DB, user.avatar_url),
      unproxied_avatar_url: user.avatar_url,
      role: user.role,
      email_verified: user.email_verified === 1,
      is_active: user.is_active === 1,
      created_at: user.created_at,
      // Restriction state. The account page needs it to decide whether to
      // offer "lift the restriction" at all — a button that only ever
      // returns 400 for most accounts is worse than no button.
      origin_team_id: user.origin_team_id,
      origin_join_completed: user.origin_join_completed === 1,
      converted_at: user.converted_at,
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
    // Identity fields. The self-serve API has no path to any of these —
    // username is fixed at registration and the primary address moves only
    // by promoting a verified alternate — so an operator fixing a typo made
    // during sign-up had nowhere to go but the database.
    username?: string;
    email?: string;
    display_name?: string;
    avatar_url?: string | null;
  }>();

  const user = await c.env.DB.prepare(
    "SELECT id, username FROM users WHERE id = ?",
  )
    .bind(id)
    .first<{ id: string; username: string }>();
  if (!user) return c.json({ error: "user_not_found" }, 404);

  if (body.role === "user" && id === admin.id) {
    return c.json({ error: "cannot_demote_self" }, 403);
  }

  // Any falsy is_active disables (the write is `is_active ? 1 : 0`).
  if (body.is_active !== undefined && !body.is_active && id === admin.id) {
    return c.json({ error: "cannot_disable_self" }, 403);
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  let newEmail: string | null = null;

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
  if (body.username !== undefined) {
    // Same shape the registration endpoint enforces — an admin-set username
    // that registration would have rejected is still a broken username.
    const username = body.username.toLowerCase().trim();
    if (!/^[a-z0-9_.-]{2,32}$/.test(username))
      return c.json({ error: "username_invalid" }, 400);
    updates.push("username = ?");
    values.push(username);
  }
  if (body.email !== undefined) {
    const email = body.email.toLowerCase().trim();
    if (!email.includes("@") || email.length > 254)
      return c.json({ error: "email_invalid" }, 400);
    if (await emailInUse(c.env.DB, email, id))
      return c.json({ error: "email_or_username_taken" }, 409);
    updates.push("email = ?");
    values.push(email);
    newEmail = email;
    // Changing the address invalidates whatever proved the old one. The
    // admin can mark the new one verified in the same request, or from the
    // user's email list — but it must not inherit the old verdict silently.
    // One of the user's own alternates keeps the proof it already has.
    if (body.email_verified === undefined) {
      const own = await c.env.DB.prepare(
        "SELECT verified, verified_via, verified_at FROM user_emails WHERE user_id = ? AND email = ?",
      )
        .bind(id, email)
        .first<{
          verified: number;
          verified_via: string | null;
          verified_at: number | null;
        }>();
      updates.push(
        "email_verified = ?",
        "email_verified_via = ?",
        "email_verified_at = ?",
      );
      values.push(
        own?.verified ? 1 : 0,
        own?.verified ? own.verified_via : null,
        own?.verified ? own.verified_at : null,
      );
    }
    updates.push("email_verify_token = ?", "email_verify_code = ?");
    values.push(null, null);
  }
  if (body.display_name !== undefined) {
    const nameErr = displayNameError(body.display_name);
    if (nameErr) return c.json(nameErr, 400);
    updates.push("display_name = ?");
    values.push(body.display_name.trim());
  }
  if (body.avatar_url !== undefined) {
    if (body.avatar_url && !body.avatar_url.startsWith("/api/assets/")) {
      const imgErr = await validateImageUrl(body.avatar_url);
      if (imgErr) return c.json(imgErr, 400);
    }
    updates.push("avatar_url = ?");
    values.push(body.avatar_url || null);
  }
  if (updates.length === 0) return c.json({ error: "nothing_to_update" }, 400);

  // What was changed, for the audit log: never the raw body, which can carry
  // ignored values and keys of the caller's choosing. Each column pushed
  // above has its value at the same index.
  const applied = Object.fromEntries(
    updates
      .map((u, i) => [u.replace(" = ?", ""), values[i]] as const)
      .filter(([k]) => k !== "email_verify_token" && k !== "email_verify_code"),
  );

  updates.push("updated_at = ?");
  values.push(Math.floor(Date.now() / 1000), id);

  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE users SET ${updates.join(", ")} WHERE id = ?`,
      ).bind(...values),
      // One of the user's own alternates made primary stops being an
      // alternate, or they would hold the address twice and a later swap
      // back would fail.
      ...(newEmail
        ? [
            c.env.DB.prepare(
              "DELETE FROM user_emails WHERE user_id = ? AND email = ?",
            ).bind(id, newEmail),
          ]
        : []),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("UNIQUE"))
      return c.json({ error: "email_or_username_taken" }, 409);
    throw err;
  }

  auditAdmin(c, "admin.user.update", "user", id, applied, user.username);
  return c.json({ ok: true });
});

// Delete user
app.delete("/users/:id", async (c) => {
  const admin = c.get("user");
  const id = c.req.param("id");
  if (id === admin.id) return c.json({ error: "cannot_delete_self" }, 400);

  const user = await c.env.DB.prepare(
    "SELECT id, username FROM users WHERE id = ?",
  )
    .bind(id)
    .first<{ id: string; username: string }>();
  if (!user) return c.json({ error: "user_not_found" }, 404);

  if (isUserLocked(c.env, user.username)) {
    return c.json({ error: "user_locked" }, 403);
  }

  // Before the delete, so the team fan-out can still read memberships.
  // This also reaches team owners, which the platform-scope auditAdmin below
  // does not — webhook delivery matches on (scope, scope_id).
  await recordAccountDeletion(
    c.env,
    c.executionCtx,
    { id: user.id, username: user.username },
    {
      actorId: admin.id,
      actorName: admin.username,
      cause: "admin",
      ...auditRequestMeta(c),
    },
  );

  await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
  // A deleted user typically takes their avatar plus every README image
  // out of circulation in one shot — sweep so the proxy stops serving
  // them right away instead of waiting for the next cron tick.
  c.executionCtx.waitUntil(
    sweepOrphanedImageProxyMappings(c.env.DB).catch(() => {}),
  );
  auditAdmin(c, "admin.user.delete", "user", id, {}, user.username);
  return c.json({ ok: true });
});

// Terminate all sessions for a user
app.delete("/users/:id/sessions", async (c) => {
  const id = c.req.param("id");
  const target = await c.env.DB.prepare(
    "SELECT username FROM users WHERE id = ? AND kind = 'user'",
  )
    .bind(id)
    .first<{ username: string }>();
  if (!target) return c.json({ error: "user_not_found" }, 404);
  const result = await c.env.DB.prepare(
    "DELETE FROM sessions WHERE user_id = ?",
  )
    .bind(id)
    .run();
  auditRequestAction(
    c,
    {
      action: "admin.user.sessions_terminate",
      resourceType: "user",
      resourceId: id,
      resourceName: target.username,
      metadata: { site_admin: true, revoked: result.meta.changes ?? 0 },
    },
    [PLATFORM_AUDIT, { scope: "user", scopeId: id }],
  );
  return c.json({ ok: true });
});

// Per-account credential, factor, token and address management — the `/me`
// surface addressed by user id. Mounted *after* the routes above so `/users`,
// `/users/:id` and `/users/:id/sessions` keep their handlers here and only
// the deeper paths fall through.
app.route("/users", adminUserRoutes);

// ─── App moderation ───────────────────────────────────────────────────────────

app.get("/apps", async (c) => {
  const { page, limit, offset } = readPage(
    c.req.query("page"),
    c.req.query("limit"),
    20,
    100,
  );
  const search = c.req.query("search") ?? "";

  // Match on the fields the admin table shows: app name, client id, owning
  // user's username, and (for team-owned apps) the team name.
  const whereClause = search
    ? `WHERE a.name LIKE ? ESCAPE '\\'
              OR a.client_id LIKE ? ESCAPE '\\'
              OR u.username LIKE ? ESCAPE '\\'
              OR t.name LIKE ? ESCAPE '\\'`
    : "";
  const searchParam = likePattern(search);
  const params = search
    ? [searchParam, searchParam, searchParam, searchParam]
    : [];

  const [apps, count] = await Promise.all([
    c.env.DB.prepare(
      `SELECT a.*,
              u.username as owner_username,
              t.name as team_name,
              t.avatar_url as team_avatar_url
       FROM oauth_apps a
       LEFT JOIN users u ON u.id = a.owner_id
       LEFT JOIN teams t ON t.id = a.team_id
       ${whereClause}
       ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(...params, limit, offset)
      .all<
        OAuthAppRow & {
          owner_username: string | null;
          team_name: string | null;
          team_avatar_url: string | null;
        }
      >(),
    c.env.DB.prepare(
      `SELECT COUNT(*) as n FROM oauth_apps a
         LEFT JOIN users u ON u.id = a.owner_id
         LEFT JOIN teams t ON t.id = a.team_id
         ${whereClause}`,
    )
      .bind(...params)
      .first<{
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
    apps: await Promise.all(
      apps.results.map(async (a) => {
        const ownerDomains = domainsMap.get(a.owner_id) ?? new Set<string>();
        const teamDomains =
          teamDomainsMap.get(a.team_id ?? "") ?? new Set<string>();
        const merged = new Set([...ownerDomains, ...teamDomains]);
        // App credentials are write-only even for site administrators. Do not
        // expose either legacy plaintext or encrypted-at-rest values.
        const {
          client_secret: clientSecret,
          registration_access_token: registrationAccessToken,
          ...appWithoutSecrets
        } = a;
        return {
          ...appWithoutSecrets,
          has_client_secret: clientSecret.length > 0,
          has_registration_access_token: registrationAccessToken !== null,
          icon_url: await proxyImageUrl(c.env.APP_URL, c.env.DB, a.icon_url),
          unproxied_icon_url: a.icon_url,
          team_avatar_url: await proxyImageUrl(
            c.env.APP_URL,
            c.env.DB,
            a.team_avatar_url,
          ),
          is_verified: computeVerified(merged, a.website_url, a.redirect_uris),
        };
      }),
    ),
    total: count?.n ?? 0,
    page,
    limit,
  });
});

app.patch("/apps/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    is_active?: boolean;
    is_official?: boolean;
    is_first_party?: boolean;
  }>();

  const app = await c.env.DB.prepare(
    "SELECT id, name, owner_id, team_id FROM oauth_apps WHERE id = ?",
  )
    .bind(id)
    .first<{
      id: string;
      name: string;
      owner_id: string;
      team_id: string | null;
    }>();
  if (!app) return c.json({ error: "app_not_found" }, 404);

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
  if (updates.length === 0) return c.json({ error: "nothing_to_update" }, 400);

  updates.push("updated_at = ?");
  values.push(Math.floor(Date.now() / 1000), id);

  await c.env.DB.prepare(
    `UPDATE oauth_apps SET ${updates.join(", ")} WHERE id = ?`,
  )
    .bind(...values)
    .run();
  auditRequestAction(
    c,
    {
      action: "admin.app.update",
      resourceType: "app",
      resourceId: id,
      resourceName: app.name,
      metadata: { ...body, site_admin: true },
    },
    [
      PLATFORM_AUDIT,
      app.team_id
        ? { scope: "team", scopeId: app.team_id }
        : { scope: "user", scopeId: app.owner_id },
    ],
  );
  return c.json({ ok: true });
});

// ─── Test email ───────────────────────────────────────────────────────────────

// The site name is admin-set but still goes into HTML.
function escapeEmailHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

app.post("/test-email", async (c) => {
  const config = await getConfig(c.env.DB);
  if (config.email_provider === "none") {
    return c.json({ error: "email_not_configured" }, 400);
  }
  const admin = c.get("user");
  try {
    await sendEmail(
      c.env,
      {
        to: admin.email,
        subject: `${config.site_name} — Test Email`,
        html: `<div style="font-family:sans-serif"><h2>Test Email</h2><p>This is a test email from ${escapeEmailHtml(config.site_name)}. Email is working correctly!</p></div>`,
        text: `This is a test email from ${config.site_name}. Email is working correctly!`,
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
    return c.json({ ok: true });
  } catch (err) {
    return c.json(
      {
        error: "email_send_failed",
        params: { detail: err instanceof Error ? err.message : String(err) },
      },
      500,
    );
  }
});

// ─── Test email receiving ─────────────────────────────────────────────────────

app.post("/test-email-receiving", async (c) => {
  const config = await getConfig(c.env.DB);

  if (config.email_receive_provider === "none") {
    return c.json({ error: "receive_not_configured" }, 400);
  }
  if (config.email_provider === "none") {
    return c.json({ error: "email_not_configured" }, 400);
  }

  const testCode = randomId(12);

  // Determine the target address and subject based on receive provider
  let toAddress: string;
  let subject: string;

  if (config.email_receive_provider === "imap") {
    if (!config.imap_user) {
      return c.json({ error: "imap_not_configured" }, 400);
    }
    toAddress = config.imap_user;
    subject = testCode;
  } else {
    // Cloudflare Email Workers
    const emailHost =
      config.email_receive_host || new URL(c.env.APP_URL).hostname;
    toAddress = `verify-${testCode}@${emailHost}`;
    subject = `${config.site_name} — Email Receive Test`;
  }

  // Store in KV so the handler/poller can validate it
  await c.env.KV_CACHE.put(`email-receive-test:${testCode}`, "1", {
    expirationTtl: 300,
  });

  try {
    await sendEmail(
      c.env,
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
      address: toAddress,
    });
  } catch (err) {
    return c.json(
      {
        error: "email_send_failed",
        params: { detail: err instanceof Error ? err.message : String(err) },
      },
      500,
    );
  }
});

app.route("/", adminResetRoutes);

// ─── Migrate teams to the unified user model ─────────────────────────────────
//
// Backfills the kind='team' user rows that mirror existing teams, and
// re-points oauth_apps.owner_id at those team-user rows for any app
// already attached to a team. Without this step legacy rows would still
// show the original creator as owner everywhere owner_id is joined to
// users (admin panel, profile pages, OAuth APIs). Idempotent — safe to
// run repeatedly as new teams are created.

app.get("/teams-as-users-status", async (c) => {
  const [teamsRow, mirroredRow, appsRow, appsAlignedRow] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM teams").first<{ n: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM users u JOIN teams t ON t.id = u.id WHERE u.kind = 'team'",
    ).first<{ n: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM oauth_apps WHERE team_id IS NOT NULL",
    ).first<{ n: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM oauth_apps WHERE team_id IS NOT NULL AND owner_id = team_id",
    ).first<{ n: number }>(),
  ]);
  return c.json({
    teams_total: teamsRow?.n ?? 0,
    teams_mirrored: mirroredRow?.n ?? 0,
    team_apps_total: appsRow?.n ?? 0,
    team_apps_aligned: appsAlignedRow?.n ?? 0,
  });
});

app.post("/migrate-teams-as-users", async (c) => {
  const now = Math.floor(Date.now() / 1000);

  // 1. Synthesize the team-user row for every team that doesn't have one.
  const teams = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.avatar_url, t.created_at, t.updated_at
     FROM teams t
     LEFT JOIN users u ON u.id = t.id AND u.kind = 'team'
     WHERE u.id IS NULL`,
  ).all<{
    id: string;
    name: string;
    avatar_url: string | null;
    created_at: number;
    updated_at: number;
  }>();

  let teamsMirrored = 0;
  for (const t of teams.results) {
    await c.env.DB.prepare(
      `INSERT INTO users
        (id, email, username, password_hash, display_name, avatar_url,
         role, kind, email_verified, is_active, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, 'user', 'team', 0, 1, ?, ?)`,
    )
      .bind(
        t.id,
        teamUserSyntheticEmail(t.id),
        teamUserSyntheticUsername(t.id),
        t.name,
        t.avatar_url,
        t.created_at,
        t.updated_at,
      )
      .run();
    teamsMirrored++;
  }

  // 2. Re-point owner_id at the team-user for every team-attached app
  //    that still references the original creator.
  const appUpdate = await c.env.DB.prepare(
    "UPDATE oauth_apps SET owner_id = team_id, updated_at = ? WHERE team_id IS NOT NULL AND owner_id != team_id",
  )
    .bind(now)
    .run();
  const appsRealigned = appUpdate.meta?.changes ?? 0;

  auditAdmin(c, "admin.migrate_teams_as_users", "users", null, {
    teams_mirrored: teamsMirrored,
    apps_realigned: appsRealigned,
  });

  return c.json({
    teams_mirrored: teamsMirrored,
    apps_realigned: appsRealigned,
  });
});

// ─── Backfill image proxy mappings ───────────────────────────────────────────
//
// Before migration 0043 the image proxy fetched whatever URL came in on the
// querystring (any HTTPS host). The new design only proxies URLs registered
// in image_proxy_mappings. This endpoint walks every column / blob where an
// external image URL might live and registers it, so existing avatars/icons
// keep loading after the cutover. Idempotent — run it again any time you
// add new tables that hold image URLs.

app.get("/image-proxy-status", async (c) => {
  const urls = await collectReferencedImageUrls(c.env.DB);
  const mapped = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM image_proxy_mappings",
  ).first<{ n: number }>();
  const cached = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes), 0) AS bytes FROM avatar_proxy_cache WHERE expires_at > ?",
  )
    .bind(Math.floor(Date.now() / 1000))
    .first<{ n: number; bytes: number }>()
    .catch(() => null);
  const config = await getConfig(c.env.DB);
  return c.json({
    discovered: urls.size,
    mapped: mapped?.n ?? 0,
    cached: cached?.n ?? 0,
    cached_bytes: cached?.bytes ?? 0,
    cache_mode: config.avatar_proxy_cache_mode,
    images_binding: !!c.env.IMAGES,
  });
});

app.post("/migrate-image-proxy", async (c) => {
  const urls = await collectReferencedImageUrls(c.env.DB);
  let registered = 0;
  for (const url of urls) {
    await registerImageProxyMapping(c.env.DB, url);
    registered++;
  }
  auditAdmin(c, "admin.migrate_image_proxy", "image_proxy_mappings", null, {
    registered,
  });
  return c.json({ registered });
});

// Manual orphan sweep — same job the cron runs, exposed here so admins
// don't have to wait for the next tick after a big cleanup.
app.post("/sweep-image-proxy", async (c) => {
  const { deleted } = await sweepOrphanedImageProxyMappings(c.env.DB);
  auditAdmin(c, "admin.sweep_image_proxy", "image_proxy_mappings", null, {
    deleted,
  });
  return c.json({ deleted });
});

// ─── Manage image proxy mappings ─────────────────────────────────────────────
//
// Lists every (id, url, created_by) row in image_proxy_mappings so admins
// can see which URLs the proxy is currently willing to serve and remove any
// that look abusive (e.g. someone pasted a tracking pixel into a README to
// log viewers). Joins users for the human-readable creator name; `q`
// matches the URL substring case-insensitively.

app.get("/image-proxy", async (c) => {
  const { page, limit, offset } = readPage(
    c.req.query("page"),
    c.req.query("limit"),
    50,
    100,
  );
  const q = (c.req.query("q") ?? "").trim();
  const createdBy = (c.req.query("created_by") ?? "").trim();

  const where: string[] = [];
  const binds: unknown[] = [];
  if (q) {
    where.push("LOWER(m.url) LIKE ? ESCAPE '\\'");
    binds.push(likePattern(q.toLowerCase()));
  }
  if (createdBy) {
    if (createdBy === "system") {
      where.push("m.created_by IS NULL");
    } else {
      where.push("m.created_by = ?");
      binds.push(createdBy);
    }
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const [rows, count] = await Promise.all([
    c.env.DB.prepare(
      `SELECT m.id, m.url, m.created_by, m.created_at,
              u.username AS created_by_username,
              u.display_name AS created_by_display_name
       FROM image_proxy_mappings m
       LEFT JOIN users u ON u.id = m.created_by
       ${whereSql}
       ORDER BY m.created_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(...binds, limit, offset)
      .all<{
        id: string;
        url: string;
        created_by: string | null;
        created_at: number;
        created_by_username: string | null;
        created_by_display_name: string | null;
      }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM image_proxy_mappings m ${whereSql}`,
    )
      .bind(...binds)
      .first<{ n: number }>(),
  ]);

  const resources = await c.env.DB.prepare(
    `SELECT avatar_url AS url, 'user' AS type, id, display_name AS name FROM users WHERE avatar_url IS NOT NULL
     UNION ALL SELECT avatar_url, 'team', id, name FROM teams WHERE avatar_url IS NOT NULL
     UNION ALL SELECT icon_url, 'app', id, name FROM oauth_apps WHERE icon_url IS NOT NULL
     UNION ALL SELECT icon_url, 'oauth_source', id, name FROM oauth_sources WHERE icon_url IS NOT NULL`,
  ).all<{
    url: string;
    type: ImageProxyResourceType;
    id: string;
    name: string;
  }>();
  const byUrl = new Map<
    string,
    Array<{ type: ImageProxyResourceType; id: string; name: string }>
  >();
  for (const resource of resources.results) {
    const list = byUrl.get(resource.url) ?? [];
    list.push({ type: resource.type, id: resource.id, name: resource.name });
    byUrl.set(resource.url, list);
  }

  return c.json({
    mappings: rows.results.map((row) => ({
      ...row,
      resources: byUrl.get(row.url) ?? [],
    })),
    total: count?.n ?? 0,
    page,
    limit,
  });
});

app.delete("/image-proxy/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f]{32}$/.test(id)) {
    return c.json({ error: "field_invalid", params: { field: "id" } }, 400);
  }
  const existing = await c.env.DB.prepare(
    "SELECT id, url FROM image_proxy_mappings WHERE id = ?",
  )
    .bind(id)
    .first<{ id: string; url: string }>();
  if (!existing) return c.json({ error: "mapping_not_found" }, 404);

  await c.env.DB.prepare("DELETE FROM image_proxy_mappings WHERE id = ?")
    .bind(id)
    .run();
  forgetImageProxyMapping(existing.url);
  auditAdmin(c, "admin.image_proxy.delete", "image_proxy_mappings", id, {
    url: existing.url,
  });
  return c.json({ ok: true });
});

// ─── Migrate recovery codes to hashed format ──────────────────────────────────

app.get("/migrate-recovery-codes-status", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT backup_codes FROM user_totp_recovery",
  ).all<{ backup_codes: string }>();

  let total = 0;
  let unmigrated = 0;
  for (const row of rows.results) {
    total++;
    try {
      const codes = JSON.parse(row.backup_codes) as string[];
      if (!codes.every((c) => c.startsWith("$sha256$"))) unmigrated++;
    } catch {
      unmigrated++;
    }
  }

  return c.json({ total, unmigrated });
});

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
  const { page, limit, offset } = readPage(
    c.req.query("page"),
    c.req.query("limit"),
    20,
    100,
  );
  const search = c.req.query("search") ?? "";

  // Teams with a site-admin setting for invite sign-up: the grant, or an
  // override of the site default for converting.
  const filter = c.req.query("filter");

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (search) {
    conditions.push(
      "(t.name LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')",
    );
    const searchParam = likePattern(search);
    params.push(searchParam, searchParam);
  }
  if (filter === "invite_signup")
    conditions.push("t.invite_registration_granted = 1");
  else if (filter === "convert")
    conditions.push("t.invite_registration_allow_convert IS NOT NULL");
  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const [teams, count] = await Promise.all([
    c.env.DB.prepare(
      `SELECT t.*,
              (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count,
              (SELECT COUNT(*) FROM oauth_apps WHERE team_id = t.id) as app_count,
              (SELECT u.username FROM team_members tm JOIN users u ON u.id = tm.user_id
               WHERE tm.team_id = t.id AND tm.role = 'owner' LIMIT 1) as owner_username
       FROM teams t ${whereClause} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(...params, limit, offset)
      .all<
        TeamRow & {
          member_count: number;
          app_count: number;
          owner_username: string | null;
        }
      >(),
    c.env.DB.prepare(`SELECT COUNT(*) as n FROM teams t ${whereClause}`)
      .bind(...params)
      .first<{ n: number }>(),
  ]);

  return c.json({
    teams: await Promise.all(
      teams.results.map(async (t) => ({
        ...t,
        avatar_url: await proxyImageUrl(c.env.APP_URL, c.env.DB, t.avatar_url),
        unproxied_avatar_url: t.avatar_url,
        // Parsed rather than raw JSON so the admin UI can toggle it without
        // knowing the storage format. Tolerant, because this runs for every
        // row in the listing and one malformed blob must not 500 the page.
        invite_registration_exemptions: parseInviteRegistrationExemptions(
          t.invite_registration_exemptions,
        ),
      })),
    ),
    total: count?.n ?? 0,
    page,
    limit,
  });
});

app.delete("/teams/:id", async (c) => {
  const admin = c.get("user");
  const id = c.req.param("id");

  const team = await c.env.DB.prepare("SELECT id, name FROM teams WHERE id = ?")
    .bind(id)
    .first<{ id: string; name: string }>();
  if (!team) return c.json({ error: "team_not_found" }, 404);

  if (isTeamLocked(c.env, team.name)) {
    return c.json({ error: "team_locked" }, 403);
  }

  // A team that minted accounts cannot be torn down in one request: those
  // accounts have to go with it, and there may be thousands. Stage it
  // instead — POST /teams/:id/dissolve deactivates them immediately and the
  // reaper clears them over subsequent ticks.
  if (await hasLiveRestrictedAccounts(c.env.DB, id))
    return c.json(
      {
        error: "team_needs_staged_dissolution",
        staged_endpoint: `/api/admin/teams/${id}/dissolve`,
      },
      409,
    );

  await dissolveTeam(c.env.DB, id, admin.id);

  // Dissolving a team takes its avatar and all of its apps' icons out
  // of circulation — sweep so the proxy stops serving those URLs now.
  c.executionCtx.waitUntil(
    sweepOrphanedImageProxyMappings(c.env.DB).catch(() => {}),
  );

  auditAdmin(c, "admin.team.delete", "team", id, {}, team.name);
  return c.json({ ok: true });
});

// ─── SAML overrides (site-admin controls) ───────────────────────────────────

// Overrides of the saml_enabled site setting, for one owner (a user, or a
// team's user row) or one app: allowed, stopped, or null to follow the level
// above. GET also says what null currently means. Stopping keeps the apps'
// SAML settings.

/** The override in a PATCH body, or a 400. */
async function readSamlOverride(
  c: Context<AppEnv>,
): Promise<{ override: boolean | null } | { error: Response }> {
  const body = await c.req
    .json<{ override?: unknown }>()
    .catch(() => ({}) as { override?: unknown });
  return body.override === null || typeof body.override === "boolean"
    ? { override: body.override }
    : {
        error: c.json(
          { error: "field_must_be_boolean", params: { field: "override" } },
          400,
        ),
      };
}

const storedOverride = (v: boolean | null) => (v === null ? null : v ? 1 : 0);

app.get("/users/:id/saml", async (c) => {
  const id = c.req.param("id");
  const user = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?")
    .bind(id)
    .first();
  if (!user) return c.json({ error: "user_not_found" }, 404);
  return c.json(await samlOwnerSetting(c.env.DB, id));
});

app.patch("/users/:id/saml", async (c) => {
  const id = c.req.param("id");
  const user = await c.env.DB.prepare(
    "SELECT username, display_name, kind FROM users WHERE id = ?",
  )
    .bind(id)
    .first<{ username: string; display_name: string; kind: string }>();
  if (!user) return c.json({ error: "user_not_found" }, 404);
  const read = await readSamlOverride(c);
  if ("error" in read) return read.error;
  const { override } = read;

  await c.env.DB.prepare(
    "UPDATE users SET saml_override = ?, updated_at = ? WHERE id = ?",
  )
    .bind(storedOverride(override), Math.floor(Date.now() / 1000), id)
    .run();
  // A team's row is the team, so it goes on the team's log too.
  const isTeam = user.kind === "team";
  auditAdmin(
    c,
    isTeam ? "admin.team.saml" : "admin.user.saml",
    isTeam ? "team" : "user",
    id,
    { override },
    isTeam ? user.display_name : user.username,
  );
  return c.json(await samlOwnerSetting(c.env.DB, id));
});

/** An app's override, and what it follows without one. */
async function appSamlSetting(
  db: D1Database,
  row: { owner_id: string; saml_override?: number | null },
) {
  const owner = await samlOwnerSetting(db, row.owner_id);
  return {
    override: samlOverrideValue(row.saml_override),
    inherited: owner.override ?? owner.inherited,
  };
}

app.get("/apps/:id/saml", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT owner_id, saml_override FROM oauth_apps WHERE id = ?",
  )
    .bind(c.req.param("id"))
    .first<{ owner_id: string; saml_override: number | null }>();
  if (!row) return c.json({ error: "app_not_found" }, 404);
  return c.json(await appSamlSetting(c.env.DB, row));
});

app.patch("/apps/:id/saml", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT name, owner_id FROM oauth_apps WHERE id = ?",
  )
    .bind(id)
    .first<{ name: string; owner_id: string }>();
  if (!row) return c.json({ error: "app_not_found" }, 404);
  const read = await readSamlOverride(c);
  if ("error" in read) return read.error;
  const { override } = read;

  const stored = storedOverride(override);
  await c.env.DB.prepare(
    "UPDATE oauth_apps SET saml_override = ?, updated_at = ? WHERE id = ?",
  )
    .bind(stored, Math.floor(Date.now() / 1000), id)
    .run();
  auditAdmin(c, "admin.app.saml", "app", id, { override }, row.name);
  return c.json(
    await appSamlSetting(c.env.DB, { ...row, saml_override: stored }),
  );
});

// ─── Invite registration (site-admin controls) ───────────────────────────────

// Grant or revoke a team's permission to mint accounts through invite links,
// and set which site-level registration requirements its invite path may
// skip. Deliberately admin-only: the grant is the one switch, and a team
// owner able to set it for themselves would make every owner a registrar.
app.patch("/teams/:id/invite-registration", async (c) => {
  const id = c.req.param("id");

  const team = await c.env.DB.prepare("SELECT id, name FROM teams WHERE id = ?")
    .bind(id)
    .first<{ id: string; name: string }>();
  if (!team) return c.json({ error: "team_not_found" }, 404);

  const body = await c.req.json<{
    granted?: boolean;
    exemptions?: { email_verification?: boolean };
    /** true / false overrides the site default; null goes back to it. */
    allow_convert?: boolean | null;
  }>();

  const updates: string[] = ["updated_at = ?"];
  const values: unknown[] = [Math.floor(Date.now() / 1000)];

  if (body.granted !== undefined) {
    updates.push("invite_registration_granted = ?");
    values.push(body.granted ? 1 : 0);
  }
  if (body.exemptions !== undefined) {
    // Only email verification is exemptible. Captcha, proof-of-work and every
    // rate limit are structural anti-abuse measures rather than costs to be
    // traded away, so they have no representation here.
    const cleaned: { email_verification?: boolean } = {};
    if (typeof body.exemptions?.email_verification === "boolean")
      cleaned.email_verification = body.exemptions.email_verification;
    updates.push("invite_registration_exemptions = ?");
    values.push(Object.keys(cleaned).length ? JSON.stringify(cleaned) : null);
  }

  if (body.allow_convert !== undefined) {
    if (body.allow_convert !== null && typeof body.allow_convert !== "boolean")
      return c.json(
        { error: "field_must_be_boolean", params: { field: "allow_convert" } },
        400,
      );
    updates.push("invite_registration_allow_convert = ?");
    values.push(
      body.allow_convert === null ? null : body.allow_convert ? 1 : 0,
    );
  }

  values.push(id);
  await c.env.DB.prepare(`UPDATE teams SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  auditAdmin(
    c,
    "admin.team.invite_registration",
    "team",
    id,
    {
      granted: body.granted,
      exemptions: body.exemptions,
      allow_convert: body.allow_convert,
    },
    team.name,
  );

  const updated = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ?")
    .bind(id)
    .first<TeamRow>();
  return c.json({
    invite_registration_granted: updated?.invite_registration_granted === 1,
    invite_registration_allow_convert:
      updated?.invite_registration_allow_convert == null
        ? null
        : updated.invite_registration_allow_convert === 1,
    invite_registration_exemptions: parseInviteRegistrationExemptions(
      updated?.invite_registration_exemptions ?? null,
    ),
  });
});

// Stage one of dissolving a team that minted accounts.
//
// Deactivation is a single UPDATE regardless of how many accounts there are,
// so it completes in this request and every one of them loses dashboard
// access at once. Deletion happens in the reaper after the grace period,
// which also leaves a window to undo a mistake.
app.post("/teams/:id/dissolve", async (c) => {
  const id = c.req.param("id");

  const team = await c.env.DB.prepare("SELECT id, name FROM teams WHERE id = ?")
    .bind(id)
    .first<{ id: string; name: string }>();
  if (!team) return c.json({ error: "team_not_found" }, 404);
  if (isTeamLocked(c.env, team.name))
    return c.json({ error: "team_locked" }, 403);

  const body = await c.req
    .json<{ confirm?: string }>()
    .catch(() => ({}) as { confirm?: string });
  if (body.confirm !== team.name)
    return c.json({ error: "confirm_team_name" }, 400);

  const now = Math.floor(Date.now() / 1000);
  const doomed = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE origin_team_id = ? AND converted_at IS NULL",
  )
    .bind(id)
    .first<{ n: number }>();

  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE teams SET dissolving_at = ? WHERE id = ?").bind(
      now,
      id,
    ),
    // Converted accounts are untouched — they are ordinary accounts now and
    // may own unrelated teams and apps.
    c.env.DB.prepare(
      "UPDATE users SET is_active = 0, updated_at = ? WHERE origin_team_id = ? AND converted_at IS NULL",
    ).bind(now, id),
  ]);

  auditAdmin(
    c,
    "admin.team.dissolve_started",
    "team",
    id,
    { deactivated_accounts: doomed?.n ?? 0 },
    team.name,
  );

  return c.json({
    deactivated_accounts: doomed?.n ?? 0,
  });
});

// Cancel a staged dissolution before the reaper gets to it.
app.post("/teams/:id/dissolve/cancel", async (c) => {
  const id = c.req.param("id");

  const team = await c.env.DB.prepare("SELECT id, name FROM teams WHERE id = ?")
    .bind(id)
    .first<{ id: string; name: string }>();
  if (!team) return c.json({ error: "team_not_found" }, 404);

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE teams SET dissolving_at = NULL WHERE id = ? AND dissolving_at IS NOT NULL",
    ).bind(id),
    c.env.DB.prepare(
      "UPDATE users SET is_active = 1, updated_at = ? WHERE origin_team_id = ? AND converted_at IS NULL",
    ).bind(now, id),
  ]);

  auditAdmin(c, "admin.team.dissolve_cancelled", "team", id, {}, team.name);
  return c.json({ ok: true });
});

// Accounts a given team (or a given invite) produced — the query an operator
// needs when a link leaks and the damage has to be scoped.
app.get("/restricted-users", async (c) => {
  const teamId = c.req.query("team_id");
  const inviteToken = c.req.query("invite_token");
  if (!teamId && !inviteToken)
    return c.json({ error: "team_or_invite_required" }, 400);

  const where: string[] = ["u.origin_team_id IS NOT NULL"];
  const args: unknown[] = [];
  if (teamId) {
    where.push("u.origin_team_id = ?");
    args.push(teamId);
  }
  if (inviteToken) {
    // Stored hashed, same as the invite token itself.
    const lookup = await hashLookupCandidate(c.env, inviteToken);
    where.push("u.origin_invite_token IN (?, ?)");
    args.push(inviteToken, lookup ?? inviteToken);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.email, u.is_active, u.created_at,
            u.origin_team_id, u.origin_join_completed, u.converted_at
       FROM users u
      WHERE ${where.join(" AND ")}
      ORDER BY u.created_at DESC
      LIMIT 500`,
  )
    .bind(...args)
    .all();

  return c.json({ users: results });
});

// ─── Statistics ───────────────────────────────────────────────────────────────

app.get("/stats", async (c) => {
  const now = Math.floor(Date.now() / 1000);
  const since = now - 29 * 86400;
  const [userCount, appCount, teamCount, domainCount, tokenCount, trendRows] =
    await Promise.all([
      c.env.DB.prepare(
        "SELECT COUNT(*) as n FROM users WHERE kind = 'user'",
      ).first<{
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
        .bind(now)
        .first<{ n: number }>(),
      c.env.DB.prepare(
        `SELECT kind, day, COUNT(*) AS n FROM (
           SELECT 'users' AS kind, (created_at / 86400) * 86400 AS day
             FROM users WHERE kind = 'user' AND created_at >= ?
           UNION ALL
           SELECT 'teams', (created_at / 86400) * 86400
             FROM teams WHERE created_at >= ?
           UNION ALL
           SELECT 'apps', (created_at / 86400) * 86400
             FROM oauth_apps WHERE created_at >= ?
           UNION ALL
           SELECT 'verified_domains', (verified_at / 86400) * 86400
             FROM domains WHERE verified = 1 AND verified_at >= ?
         ) GROUP BY kind, day ORDER BY day`,
      )
        .bind(since, since, since, since)
        .all<{ kind: string; day: number; n: number }>(),
    ]);

  const firstDay = Math.floor(since / 86400) * 86400;
  const trends: Record<string, number[]> = {
    users: Array(30).fill(0),
    teams: Array(30).fill(0),
    apps: Array(30).fill(0),
    verified_domains: Array(30).fill(0),
  };
  for (const row of trendRows.results) {
    const index = Math.floor((row.day - firstDay) / 86400);
    if (index >= 0 && index < 30 && trends[row.kind]) {
      trends[row.kind][index] = row.n;
    }
  }

  // Older installations may not have the image proxy migration yet. Omit the
  // proxy metric rather than turning the entire overview into an error state.
  const proxyCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as n FROM image_proxy_mappings",
  )
    .first<{ n: number }>()
    .catch(() => null);
  return c.json({
    users: userCount?.n ?? 0,
    apps: appCount?.n ?? 0,
    teams: teamCount?.n ?? 0,
    verified_domains: domainCount?.n ?? 0,
    active_tokens: tokenCount?.n ?? 0,
    ...(proxyCount ? { proxied_images: proxyCount.n } : {}),
    trends,
  });
});

// The platform audit log is now served by /api/audit/platform/* (see
// src/worker/routes/audit.ts — Transparent Platform Control).

// ─── Login error log ──────────────────────────────────────────────────────────

app.get("/login-errors", async (c) => {
  const { page, limit, offset } = readPage(
    c.req.query("page"),
    c.req.query("limit"),
    50,
    200,
  );
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
    conditions.push("identifier LIKE ? ESCAPE '\\'");
    params.push(likePattern(qIdentifier));
  }
  if (qIp) {
    conditions.push("ip_address LIKE ? ESCAPE '\\'");
    params.push(likePattern(qIp));
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

app.route("/", adminInviteRoutes);

app.route("/", adminSourceRoutes);

export default app;
