// User profile routes

import {
  RESTRICTED_CAPABILITY_DEFAULTS,
  getRestrictedCapabilities,
  guardCapability,
  isPendingJoin,
  isRestricted,
  isSyntheticEmail,
  resolveRestrictedCapability,
} from "../lib/userCapabilities";
import { Hono } from "hono";
import {
  hashPassword,
  verifyPassword,
  randomId,
  randomBase64url,
} from "../lib/crypto";
import { requireAuth } from "../middleware/auth";
import { readSessionCookie, setSessionCookie } from "../lib/cookies";
import {
  proxyImageUrl,
  registerMarkdownImageMappings,
  sweepOrphanedImageProxyMappings,
} from "../lib/proxyImage";
import { validateImageUrl } from "../lib/imageValidation";
import {
  recordAudit,
  recordAccountDeletion,
  auditRequestMeta,
} from "../lib/audit";
import {
  deliverUserEmailNotifications,
  notificationActorMetaFromHeaders,
  USER_NOTIFICATION_EVENTS,
  parseNotificationRules,
} from "../lib/notifications";
import type { NotificationRules, RestrictedCapability } from "../types";
import { getConfig, getConfigValue } from "../lib/config";
import { readPage, likePattern } from "../lib/pagination";
import { getGithubReadmeFromCache } from "../lib/githubReadme";
import { encryptSecret, hashSecret } from "../lib/secretCrypto";
import { sendEmail, verifyEmailTemplate } from "../lib/email";
import type {
  UserRow,
  UserEmailRow,
  UserNotificationPrefsRow,
  Variables,
} from "../types";

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
  const config = await getConfig(c.env.DB);

  // Silent cookie upgrade: if this request authenticated via Bearer/X-Session-Token
  // (existing pre-cookie clients) and there's no session cookie yet, mirror the
  // token into a cookie so the next navigation hits SSR with a usable session.
  // The token hash is in the sessions table; we just need to reissue the cookie
  // header with the same token the client already presented.
  if (!readSessionCookie(c)) {
    const authHeader = c.req.header("Authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : c.req.header("X-Session-Token");
    if (token && !token.startsWith("prism_pat_")) {
      const sessionId = c.get("sessionId");
      const exp = await c.env.DB.prepare(
        "SELECT expires_at FROM sessions WHERE id = ?",
      )
        .bind(sessionId)
        .first<{ expires_at: number }>();
      if (exp) {
        const ttl = Math.max(0, exp.expires_at - Math.floor(Date.now() / 1000));
        if (ttl > 0) setSessionCookie(c, token, ttl);
      }
    }
  }

  return c.json({
    user: await safeUser(c.env.APP_URL, c.env.DB, row),
    totp_enabled: (totp?.n ?? 0) > 0,
    passkey_count: passkeyCount?.n ?? 0,
    site_access_token_ttl_minutes: config.access_token_ttl_minutes,
    site_refresh_token_ttl_days: config.refresh_token_ttl_days,
  });
});

// Update profile
app.patch("/me", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    display_name?: string;
    avatar_url?: string;
    alt_email_login?: boolean | null;
    access_token_ttl_minutes?: number | null;
    refresh_token_ttl_days?: number | null;
    profile_is_public?: boolean;
    profile_show_display_name?: boolean | null;
    profile_show_avatar?: boolean | null;
    profile_show_email?: boolean | null;
    profile_show_joined_at?: boolean | null;
    profile_show_gpg_keys?: boolean | null;
    profile_show_authorized_apps?: boolean | null;
    profile_show_owned_apps?: boolean | null;
    profile_show_domains?: boolean | null;
    profile_show_joined_teams?: boolean | null;
    profile_show_readme?: boolean | null;
    profile_readme?: string | null;
    profile_readme_source?: "manual" | "github";
    profile_readme_source_meta?: {
      connection_id?: string;
      github_login?: string;
    } | null;
    github_readme_token?: string | null;
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
  if (body.alt_email_login !== undefined) {
    updates.push("alt_email_login = ?");
    values.push(
      body.alt_email_login === null ? null : body.alt_email_login ? 1 : 0,
    );
  }
  if (body.access_token_ttl_minutes !== undefined) {
    if (body.access_token_ttl_minutes !== null) {
      if (
        !Number.isInteger(body.access_token_ttl_minutes) ||
        body.access_token_ttl_minutes < 1
      )
        return c.json(
          { error: "access_token_ttl_minutes must be a positive integer" },
          400,
        );
    }
    updates.push("access_token_ttl_minutes = ?");
    values.push(body.access_token_ttl_minutes);
  }
  if (body.refresh_token_ttl_days !== undefined) {
    if (body.refresh_token_ttl_days !== null) {
      if (
        !Number.isInteger(body.refresh_token_ttl_days) ||
        body.refresh_token_ttl_days < 1
      )
        return c.json(
          { error: "refresh_token_ttl_days must be a positive integer" },
          400,
        );
    }
    updates.push("refresh_token_ttl_days = ?");
    values.push(body.refresh_token_ttl_days);
  }
  if (body.profile_is_public !== undefined) {
    // Turning a profile public adds a rendered, crawlable page plus image
    // proxying — a per-account cost the restricted tier exists to avoid.
    // Turning it *off* is always allowed.
    if (body.profile_is_public) {
      const capErr = await guardCapability(c.env.DB, user.id, "profile:public");
      if (capErr) return c.json({ error: capErr }, 403);
    }
    updates.push("profile_is_public = ?");
    values.push(body.profile_is_public ? 1 : 0);
  }
  if (body.profile_readme !== undefined) {
    const raw = body.profile_readme;
    if (raw !== null && typeof raw !== "string") {
      return c.json({ error: "profile_readme must be a string or null" }, 400);
    }
    // Empty string == clear (treat the same as null) so the public profile
    // can simply check truthiness.
    const trimmed = raw === null ? null : raw;
    if (trimmed !== null) {
      // Byte length, not character count — UTF-8 emoji etc. would otherwise
      // sneak past a .length cap and blow the row size.
      const bytes = new TextEncoder().encode(trimmed).byteLength;
      const maxBytes = await getConfigValue(
        c.env.DB,
        "profile_readme_max_bytes",
      );
      if (bytes > maxBytes) {
        return c.json(
          { error: `profile_readme exceeds the ${maxBytes}-byte limit` },
          413,
        );
      }
    }
    updates.push("profile_readme = ?");
    values.push(trimmed && trimmed.length > 0 ? trimmed : null);
    updates.push("profile_readme_updated_at = ?");
    values.push(now);
  }
  if (body.profile_readme_source !== undefined) {
    if (
      body.profile_readme_source !== "manual" &&
      body.profile_readme_source !== "github"
    ) {
      return c.json(
        { error: "profile_readme_source must be 'manual' or 'github'" },
        400,
      );
    }
    if (body.profile_readme_source === "github") {
      // Resolve the GitHub login from the chosen connection so the public
      // profile route can fetch even if the connection is later removed.
      const meta = body.profile_readme_source_meta ?? {};
      let login = meta.github_login?.trim();
      const connectionId = meta.connection_id?.trim();
      if (connectionId) {
        const conn = await c.env.DB.prepare(
          "SELECT id, profile_data FROM social_connections WHERE id = ? AND user_id = ? AND provider = 'github'",
        )
          .bind(connectionId, user.id)
          .first<{ id: string; profile_data: string }>();
        if (!conn) {
          return c.json(
            { error: "GitHub connection not found for this user" },
            400,
          );
        }
        try {
          const profile = JSON.parse(conn.profile_data) as { login?: string };
          if (profile.login) login = profile.login;
        } catch {
          // ignore — fall back to whatever the client sent
        }
      }
      if (!login) {
        return c.json(
          { error: "github source requires a connection_id or github_login" },
          400,
        );
      }
      updates.push("profile_readme_source = ?");
      values.push("github");
      updates.push("profile_readme_source_meta = ?");
      values.push(
        JSON.stringify({
          connection_id: connectionId ?? null,
          github_login: login,
        }),
      );
    } else {
      updates.push("profile_readme_source = ?");
      values.push("manual");
      updates.push("profile_readme_source_meta = ?");
      values.push(null);
    }
  }
  if (body.github_readme_token !== undefined) {
    if (
      body.github_readme_token !== null &&
      typeof body.github_readme_token !== "string"
    ) {
      return c.json(
        { error: "github_readme_token must be a string or null" },
        400,
      );
    }
    const tok = body.github_readme_token?.trim() || null;
    if (tok && tok.length > 256) {
      return c.json({ error: "github_readme_token is too long" }, 400);
    }
    // Encrypt at rest if the SECRETS_KEY binding is configured. No-op
    // otherwise (legacy plaintext path).
    updates.push("github_readme_token = ?");
    values.push(tok ? await encryptSecret(c.env, tok) : null);
    // A user replacing the token always means "give this one a fresh
    // chance" — even if they're clearing it, zeroing the counter avoids
    // weird state if they paste it back later.
    updates.push("github_readme_token_failures = ?");
    values.push(0);
  }
  for (const field of [
    "profile_show_display_name",
    "profile_show_avatar",
    "profile_show_email",
    "profile_show_joined_at",
    "profile_show_gpg_keys",
    "profile_show_authorized_apps",
    "profile_show_owned_apps",
    "profile_show_domains",
    "profile_show_joined_teams",
    "profile_show_readme",
  ] as const) {
    const v = body[field];
    if (v !== undefined) {
      updates.push(`${field} = ?`);
      values.push(v === null ? null : v ? 1 : 0);
    }
  }

  if (updates.length === 0) return c.json({ error: "Nothing to update" }, 400);

  updates.push("updated_at = ?");
  values.push(now, user.id);

  await c.env.DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  if (body.profile_readme !== undefined) {
    // See note in POST /me/readme — anonymous public-profile viewers can't
    // register URLs themselves, so we do it server-side at save time.
    await registerMarkdownImageMappings(
      c.env.DB,
      typeof body.profile_readme === "string" ? body.profile_readme : null,
      user.id,
    );
  }

  // Avatar swap or README rewrite likely orphans the previous URL(s) —
  // sweep in the background. Other field edits don't touch image columns
  // so we skip the DB scan there.
  if (body.avatar_url !== undefined || body.profile_readme !== undefined) {
    c.executionCtx.waitUntil(
      sweepOrphanedImageProxyMappings(c.env.DB).catch(() => {}),
    );
  }

  const row = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(user.id)
    .first<UserRow>();
  // Collect human-readable changes for the notification
  const changedFields: Record<string, string> = {};
  if (body.display_name !== undefined)
    changedFields.display_name = body.display_name;
  if (body.avatar_url !== undefined)
    changedFields.avatar_url = body.avatar_url ?? "";

  const auditMeta = auditRequestMeta(c);
  const changedFieldNames = Object.keys(changedFields).filter(
    (f) => f !== "updated_at" && f !== "profile_readme_updated_at" && f !== "profile_readme_source_meta"
  );
  await recordAudit(c.env, c.executionCtx, {
    scope: "user",
    scopeId: user.id,
    action: "user.profile.update",
    actorId: user.id,
    actorName: user.username,
    resourceType: "user",
    resourceId: user.id,
    resourceName: `@${user.username}`,
    ip: auditMeta.ip,
    userAgent: auditMeta.userAgent,
    geo: auditMeta.geo,
    metadata: { changed_fields: changedFieldNames },
  });
  c.executionCtx.waitUntil(
    deliverUserEmailNotifications(
      c.env,
      user.id,
      "profile.updated",
      {
        changed_fields: changedFields,
        ...notificationActorMetaFromHeaders(c.req.raw.headers),
      },
      c.env.APP_URL,
    ).catch(() => {}),
  );
  return c.json({ user: await safeUser(c.env.APP_URL, c.env.DB, row!) });
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

  // Whatever external URL the user previously had as their avatar is no
  // longer referenced — sweep so the proxy stops serving it.
  c.executionCtx.waitUntil(
    sweepOrphanedImageProxyMappings(c.env.DB).catch(() => {}),
  );

  return c.json({ avatar_url: avatarUrl });
});

// Upload README as a markdown file (multipart). Convenience for users who
// edit their bio in a real markdown editor instead of pasting into the
// textarea. The body is the raw markdown source — we never render it on the
// server, so no sanitization is needed here, just the size cap.
app.post("/me/readme", async (c) => {
  const user = c.get("user");
  const maxBytes = await getConfigValue(c.env.DB, "profile_readme_max_bytes");
  const formData = await c.req.formData();
  const file = formData.get("readme") as unknown as File | null;

  if (!file) return c.json({ error: "readme file required" }, 400);
  if (file.size > maxBytes) {
    return c.json({ error: `Readme exceeds the ${maxBytes}-byte limit` }, 413);
  }
  // Restrict to text-ish types. Some browsers send empty type for .md.
  const type = (file.type || "").toLowerCase();
  if (
    type &&
    !type.startsWith("text/") &&
    type !== "application/octet-stream"
  ) {
    return c.json({ error: "Readme must be a text/markdown file" }, 400);
  }

  const text = await file.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    // file.size can lie when the upstream stream is chunked; recheck after read.
    return c.json({ error: `Readme exceeds the ${maxBytes}-byte limit` }, 413);
  }

  const now = Math.floor(Date.now() / 1000);
  const trimmed = text.length > 0 ? text : null;
  await c.env.DB.prepare(
    "UPDATE users SET profile_readme = ?, profile_readme_updated_at = ?, updated_at = ? WHERE id = ?",
  )
    .bind(trimmed, now, now, user.id)
    .run();

  // Pre-register every embedded image URL so anonymous public-profile
  // viewers (who can't hit the auth-gated /register endpoint) still find
  // each image already mapped when they fetch /api/proxy/image/<id>.
  await registerMarkdownImageMappings(c.env.DB, trimmed, user.id);

  // Old README's image URLs may now be unreferenced — sweep.
  c.executionCtx.waitUntil(
    sweepOrphanedImageProxyMappings(c.env.DB).catch(() => {}),
  );

  return c.json({
    profile_readme: trimmed,
    profile_readme_updated_at: now,
    max_bytes: maxBytes,
  });
});

// Force-refresh the GitHub README cache for the current user. Bypasses TTL.
// Useful when the user just published a change on GitHub and wants the public
// profile to reflect it immediately. Errors short-circuit with the upstream
// status so the UI can show a useful message.
app.post("/me/readme/sync", async (c) => {
  const user = c.get("user");
  const row = await c.env.DB.prepare(
    "SELECT profile_readme_source, profile_readme_source_meta FROM users WHERE id = ?",
  )
    .bind(user.id)
    .first<{
      profile_readme_source: string;
      profile_readme_source_meta: string | null;
    }>();
  if (!row || row.profile_readme_source !== "github") {
    return c.json({ error: "README source is not github" }, 400);
  }
  let login: string | null = null;
  try {
    const meta = JSON.parse(row.profile_readme_source_meta ?? "{}") as {
      github_login?: string;
    };
    login = meta.github_login ?? null;
  } catch {
    // ignore
  }
  if (!login) return c.json({ error: "No GitHub login configured" }, 400);

  // Force-refresh by deleting the cache row, then routing through the
  // standard cache resolver so we pick up the same token cascade and
  // 401-failure tracking as a normal public-profile view.
  await c.env.DB.prepare(
    "DELETE FROM github_readme_cache WHERE github_login = ?",
  )
    .bind(login.toLowerCase())
    .run();

  const content = await getGithubReadmeFromCache(c.env, user.id, login);
  const now = Math.floor(Date.now() / 1000);

  if (content !== null) {
    await c.env.DB.prepare(
      "UPDATE users SET profile_readme_synced_at = ? WHERE id = ?",
    )
      .bind(now, user.id)
      .run();
    return c.json({ status: 200, synced_at: now });
  }

  // No content. Distinguish a real 404 (cache row was written with status
  // 404 by the resolver) from a hard fetch failure (no cache row).
  const cacheRow = await c.env.DB.prepare(
    "SELECT status FROM github_readme_cache WHERE github_login = ?",
  )
    .bind(login.toLowerCase())
    .first<{ status: number }>();
  if (cacheRow?.status === 404) {
    return c.json(
      { status: 404, error: "GitHub user has no profile README" },
      404,
    );
  }
  return c.json(
    {
      status: 502,
      error: "GitHub fetch failed — try again or check your token",
    },
    502,
  );
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

  // Before the delete — the membership rows this reads go with the user.
  await recordAccountDeletion(
    c.env,
    c.executionCtx,
    { id: row.id, username: row.username },
    {
      actorId: row.id,
      actorName: row.username,
      cause: "self",
      ...auditRequestMeta(c),
    },
  );

  await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();
  // Avatar + every README image just lost their owning row — sweep so
  // those URLs stop being servable instead of waiting for the next cron.
  c.executionCtx.waitUntil(
    sweepOrphanedImageProxyMappings(c.env.DB).catch(() => {}),
  );
  return c.json({ message: "Account deleted" });
});

async function safeUser(baseUrl: string, db: D1Database, row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    display_name: row.display_name,
    avatar_url: await proxyImageUrl(baseUrl, db, row.avatar_url),
    unproxied_avatar_url: row.avatar_url,
    role: row.role,
    email_verified: row.email_verified === 1,
    alt_email_login: row.alt_email_login,
    access_token_ttl_minutes: row.access_token_ttl_minutes,
    refresh_token_ttl_days: row.refresh_token_ttl_days,
    profile_is_public: row.profile_is_public === 1,
    profile_show_display_name: nullableBool(row.profile_show_display_name),
    profile_show_avatar: nullableBool(row.profile_show_avatar),
    profile_show_email: nullableBool(row.profile_show_email),
    profile_show_joined_at: nullableBool(row.profile_show_joined_at),
    profile_show_gpg_keys: nullableBool(row.profile_show_gpg_keys),
    profile_show_authorized_apps: nullableBool(
      row.profile_show_authorized_apps,
    ),
    profile_show_owned_apps: nullableBool(row.profile_show_owned_apps),
    profile_show_domains: nullableBool(row.profile_show_domains),
    profile_show_joined_teams: nullableBool(row.profile_show_joined_teams),
    profile_show_readme: nullableBool(row.profile_show_readme),
    profile_readme: row.profile_readme,
    profile_readme_updated_at: row.profile_readme_updated_at,
    profile_readme_source: row.profile_readme_source as "manual" | "github",
    profile_readme_source_meta: row.profile_readme_source_meta
      ? (JSON.parse(row.profile_readme_source_meta) as {
          connection_id: string | null;
          github_login: string;
        })
      : null,
    profile_readme_synced_at: row.profile_readme_synced_at,
    // Expose only whether a personal token is set, not the token itself.
    github_readme_token_set: !!row.github_readme_token,
    created_at: row.created_at,
  };
}

function nullableBool(v: number | null): boolean | null {
  if (v === null) return null;
  return v === 1;
}

// ─── Alternate Emails ─────────────────────────────────────────────────────────

// GET /api/user/me/emails — list primary + alternates
app.get("/me/emails", async (c) => {
  const user = c.get("user");
  const row = await c.env.DB.prepare(
    "SELECT email, email_verified FROM users WHERE id = ?",
  )
    .bind(user.id)
    .first<{ email: string; email_verified: number }>();
  if (!row) return c.json({ error: "User not found" }, 404);

  const { results } = await c.env.DB.prepare(
    "SELECT id, email, verified, verified_via, created_at FROM user_emails WHERE user_id = ? ORDER BY created_at ASC",
  )
    .bind(user.id)
    .all<
      Pick<
        UserEmailRow,
        "id" | "email" | "verified" | "verified_via" | "created_at"
      >
    >();

  return c.json({
    primary: { email: row.email, verified: row.email_verified === 1 },
    emails: results.map((r) => ({
      ...r,
      verified: r.verified === 1,
    })),
  });
});

// POST /api/user/me/emails — add alternate email
app.post("/me/emails", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ email: string }>();

  const email = (body.email ?? "").toLowerCase().trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return c.json({ error: "Invalid email address" }, 400);

  // Check uniqueness against primary emails
  const existing = await c.env.DB.prepare(
    "SELECT id FROM users WHERE email = ?",
  )
    .bind(email)
    .first();
  if (existing) return c.json({ error: "Email is already in use" }, 409);

  // Check uniqueness against other alternate emails
  const altExisting = await c.env.DB.prepare(
    "SELECT id FROM user_emails WHERE email = ?",
  )
    .bind(email)
    .first();
  if (altExisting) return c.json({ error: "Email is already in use" }, 409);

  const now = Math.floor(Date.now() / 1000);
  const id = randomId();
  const verifyToken = randomBase64url(24);
  const storedVerifyToken = await hashSecret(c.env, verifyToken);

  await c.env.DB.prepare(
    "INSERT INTO user_emails (id, user_id, email, verified, verify_token, created_at) VALUES (?, ?, ?, 0, ?, ?)",
  )
    .bind(id, user.id, email, storedVerifyToken, now)
    .run();

  // Send verification email if provider is configured
  const config = await getConfig(c.env.DB);
  if (config.email_provider !== "none") {
    const verifyUrl = `${c.env.APP_URL}/api/auth/verify-email?token=${verifyToken}&alt=1`;
    const tmpl = verifyEmailTemplate(config.site_name, verifyUrl);
    c.executionCtx.waitUntil(
      sendEmail(
        c.env,
        {
          to: email,
          subject: `Verify your email — ${config.site_name}`,
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
      ).catch(() => {}),
    );
  }

  return c.json({ id, email, verified: false, created_at: now }, 201);
});

// POST /api/user/me/emails/:id/resend — resend verification for alternate email
app.post("/me/emails/:id/resend", async (c) => {
  const user = c.get("user");
  const emailRow = await c.env.DB.prepare(
    "SELECT id, email, verified FROM user_emails WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), user.id)
    .first<Pick<UserEmailRow, "id" | "email" | "verified">>();
  if (!emailRow) return c.json({ error: "Email not found" }, 404);
  if (emailRow.verified) return c.json({ error: "Already verified" }, 400);

  const config = await getConfig(c.env.DB);
  if (config.email_provider === "none")
    return c.json({ error: "Email sending is not configured" }, 503);

  const verifyToken = randomBase64url(24);
  const storedVerifyToken = await hashSecret(c.env, verifyToken);
  await c.env.DB.prepare("UPDATE user_emails SET verify_token = ? WHERE id = ?")
    .bind(storedVerifyToken, emailRow.id)
    .run();

  const verifyUrl = `${c.env.APP_URL}/api/auth/verify-email?token=${verifyToken}&alt=1`;
  const tmpl = verifyEmailTemplate(config.site_name, verifyUrl);
  await sendEmail(
    c.env,
    {
      to: emailRow.email,
      subject: `Verify your email — ${config.site_name}`,
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

  return c.json({ message: "Verification email sent" });
});

// POST /api/user/me/emails/:id/set-primary — make an alternate email the primary
app.post("/me/emails/:id/set-primary", async (c) => {
  const user = c.get("user");
  const emailRow = await c.env.DB.prepare(
    "SELECT id, email, verified, verified_via, verified_at FROM user_emails WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), user.id)
    .first<
      Pick<
        UserEmailRow,
        "id" | "email" | "verified" | "verified_via" | "verified_at"
      >
    >();
  if (!emailRow) return c.json({ error: "Email not found" }, 404);
  if (!emailRow.verified)
    return c.json(
      { error: "Email must be verified before setting as primary" },
      400,
    );

  const userRow = await c.env.DB.prepare(
    "SELECT email, email_verified, email_verified_via, email_verified_at, email_verify_token, email_verify_code FROM users WHERE id = ?",
  )
    .bind(user.id)
    .first<{
      email: string;
      email_verified: number;
      email_verified_via: string | null;
      email_verified_at: number | null;
      email_verify_token: string | null;
      email_verify_code: string | null;
    }>();
  if (!userRow) return c.json({ error: "User not found" }, 404);

  const now = Math.floor(Date.now() / 1000);

  // Swap: move current primary to user_emails, promote alternate to users.email
  const oldPrimaryId = randomId();
  // A synthesised placeholder is not an address anyone can reach, so it is
  // dropped rather than demoted — keeping it would leave an unreachable
  // `@users.invalid` row sitting in the account's email list forever.
  const demoteOldPrimary = !isSyntheticEmail(userRow.email);
  await c.env.DB.batch([
    // Insert old primary as alternate. Carry the verification *state* but
    // explicitly drop the verify_token / verify_code — those are tied to a
    // specific outstanding inbound-mail challenge against the old primary
    // address; reusing them on a new alternate row would let a user replay
    // a code they already learned to flip a different address to verified.
    ...(demoteOldPrimary
      ? [
          c.env.DB.prepare(
            "INSERT INTO user_emails (id, user_id, email, verified, verify_token, verify_code, verified_via, verified_at, created_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)",
          ).bind(
            oldPrimaryId,
            user.id,
            userRow.email,
            userRow.email_verified,
            userRow.email_verified_via,
            userRow.email_verified_at,
            now,
          ),
        ]
      : []),
    // Update users table with new primary
    c.env.DB.prepare(
      "UPDATE users SET email = ?, email_verified = ?, email_verified_via = ?, email_verified_at = ?, email_verify_token = NULL, email_verify_code = NULL, updated_at = ? WHERE id = ?",
    ).bind(
      emailRow.email,
      emailRow.verified,
      emailRow.verified_via,
      emailRow.verified_at,
      now,
      user.id,
    ),
    // Delete the promoted alternate
    c.env.DB.prepare("DELETE FROM user_emails WHERE id = ?").bind(emailRow.id),
  ]);

  return c.json({ message: "Primary email updated" });
});

// ─── Lifting the invite-registration restriction ─────────────────────────────

// GET /api/user/me/restriction — what the Security tab needs to render the
// conversion control (or explain why it isn't available).
app.get("/me/restriction", async (c) => {
  const user = c.get("user");
  const row = await c.env.DB.prepare(
    "SELECT email, email_verified, origin_team_id, origin_join_completed, converted_at FROM users WHERE id = ?",
  )
    .bind(user.id)
    .first<{
      email: string;
      email_verified: number;
      origin_team_id: string | null;
      origin_join_completed: number;
      converted_at: number | null;
    }>();
  if (!row) return c.json({ error: "User not found" }, 404);

  if (!isRestricted(row)) {
    return c.json({
      restricted: false,
      converted_at: row.converted_at,
    });
  }

  const grants = await getRestrictedCapabilities(c.env.DB);
  const config = await getConfig(c.env.DB);
  const team = row.origin_team_id
    ? await c.env.DB.prepare("SELECT id, name FROM teams WHERE id = ?")
        .bind(row.origin_team_id)
        .first<{ id: string; name: string }>()
    : null;

  const needsEmail =
    isSyntheticEmail(row.email) ||
    (config.require_email_verification && row.email_verified !== 1);

  return c.json({
    restricted: true,
    pending_join: isPendingJoin(row),
    origin_team: team,
    capabilities: Object.fromEntries(
      (
        Object.keys(RESTRICTED_CAPABILITY_DEFAULTS) as RestrictedCapability[]
      ).map((k) => [k, resolveRestrictedCapability(k, grants)]),
    ),
    conversion: {
      available: resolveRestrictedCapability("self:convert", grants),
      needs_real_email: needsEmail,
      synthetic_email: isSyntheticEmail(row.email),
    },
  });
});

// POST /api/user/me/convert — become an ordinary account.
//
// One-way on purpose: "unlocks everything" has no meaningful inverse, and a
// reversible switch would just be another thing to reason about in the
// dissolution and re-parenting checks.
app.post("/me/convert", async (c) => {
  const user = c.get("user");
  const row = await c.env.DB.prepare(
    "SELECT id, username, email, email_verified, origin_team_id, origin_join_completed, converted_at FROM users WHERE id = ?",
  )
    .bind(user.id)
    .first<{
      id: string;
      username: string;
      email: string;
      email_verified: number;
      origin_team_id: string | null;
      origin_join_completed: number;
      converted_at: number | null;
    }>();
  if (!row) return c.json({ error: "User not found" }, 404);

  if (!isRestricted(row))
    return c.json({ error: "This account is not restricted" }, 400);
  if (isPendingJoin(row))
    return c.json({ error: "Finish joining your team before converting" }, 403);

  const grants = await getRestrictedCapabilities(c.env.DB);
  if (!resolveRestrictedCapability("self:convert", grants))
    return c.json(
      { error: "Converting to a full account is not enabled on this instance" },
      403,
    );

  // The invite path may have skipped email verification to spare the instance
  // a mail send per registration. That deferral ends here: an account about
  // to gain every ordinary feature must first be reachable, and must satisfy
  // whatever the site requires of an ordinary account.
  const config = await getConfig(c.env.DB);
  if (isSyntheticEmail(row.email))
    return c.json(
      {
        error:
          "Add and verify a real email address before converting this account",
      },
      403,
    );
  if (config.require_email_verification && row.email_verified !== 1)
    return c.json(
      { error: "Verify your email address before converting this account" },
      403,
    );

  const now = Math.floor(Date.now() / 1000);
  // origin_team_id is deliberately left in place. It stops constraining
  // anything the moment converted_at is set, but a leaked invite still needs
  // to be traceable to the accounts it produced.
  await c.env.DB.prepare(
    "UPDATE users SET converted_at = ?, updated_at = ? WHERE id = ? AND converted_at IS NULL",
  )
    .bind(now, now, user.id)
    .run();

  const auditMeta = auditRequestMeta(c);
  await recordAudit(c.env, c.executionCtx, [
    {
      scope: "user",
      scopeId: user.id,
      action: "user.restriction.converted",
      actorId: user.id,
      actorName: row.username,
      metadata: { origin_team_id: row.origin_team_id },
      ...auditMeta,
    },
    // The origin team loses a restricted member — worth surfacing there too,
    // since dissolution will no longer take this account with it.
    {
      scope: "team",
      scopeId: row.origin_team_id,
      action: "team.member.restriction_lifted",
      actorId: user.id,
      actorName: row.username,
      resourceType: "user",
      resourceId: user.id,
      resourceName: `@${row.username}`,
      metadata: {},
      ...auditMeta,
    },
  ]);

  return c.json({ message: "Account converted", converted_at: now });
});

// DELETE /api/user/me/emails/:id — remove an alternate email
app.delete("/me/emails/:id", async (c) => {
  const user = c.get("user");
  const emailRow = await c.env.DB.prepare(
    "SELECT id FROM user_emails WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), user.id)
    .first();
  if (!emailRow) return c.json({ error: "Email not found" }, 404);

  await c.env.DB.prepare("DELETE FROM user_emails WHERE id = ?")
    .bind(c.req.param("id"))
    .run();

  return c.json({ message: "Email removed" });
});

// ─── Personal Access Tokens ───────────────────────────────────────────────────

const VALID_PAT_SCOPES = new Set([
  "openid",
  "profile",
  "profile:write",
  "email",
  "apps:read",
  "apps:write",
  "teams:read",
  "teams:write",
  "teams:create",
  "teams:delete",
  "domains:read",
  "domains:write",
  "gpg:read",
  "gpg:write",
  "social:read",
  "social:write",
  "admin:users:read",
  "admin:users:write",
  "admin:users:delete",
  "admin:config:read",
  "admin:config:write",
  "admin:invites:read",
  "admin:invites:create",
  "admin:invites:delete",
  "offline_access",
]);

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

  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);
  if (!Array.isArray(body.scopes) || body.scopes.length === 0)
    return c.json({ error: "scopes is required" }, 400);

  const scopes = body.scopes.filter((s) => VALID_PAT_SCOPES.has(s));
  if (scopes.length === 0)
    return c.json({ error: "No valid scopes provided" }, 400);

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

  if (!row) return c.json({ error: "Token not found" }, 404);

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

  return c.json({ message: "Token revoked" });
});

// ─── Notification Preferences ─────────────────────────────────────────────────

// GET /api/user/me/notifications
app.get("/me/notifications", async (c) => {
  const user = c.get("user");

  // Load prefs row for rules + legacy migration data
  const row = await c.env.DB.prepare(
    "SELECT events, tg_events, notification_rules FROM user_notification_prefs WHERE user_id = ?",
  )
    .bind(user.id)
    .first<
      Pick<
        UserNotificationPrefsRow,
        "events" | "tg_events" | "notification_rules"
      >
    >();

  // First telegram connection for legacy migration
  const firstTg = await c.env.DB.prepare(
    "SELECT id FROM social_connections WHERE user_id = ? AND provider = 'telegram' ORDER BY connected_at ASC LIMIT 1",
  )
    .bind(user.id)
    .first<{ id: string }>();

  const rules = row
    ? parseNotificationRules(
        row.notification_rules,
        row.events,
        row.tg_events,
        firstTg?.id ?? null,
      )
    : {};

  // Build email list: primary + verified alternates
  const primaryRow = await c.env.DB.prepare(
    "SELECT email, email_verified FROM users WHERE id = ?",
  )
    .bind(user.id)
    .first<{ email: string; email_verified: number }>();

  const emails: { id: string; email: string }[] = [];
  if (primaryRow?.email_verified) {
    emails.push({ id: "primary", email: primaryRow.email });
  }
  const { results: altEmails } = await c.env.DB.prepare(
    "SELECT id, email FROM user_emails WHERE user_id = ? AND verified = 1 ORDER BY created_at ASC",
  )
    .bind(user.id)
    .all<{ id: string; email: string }>();
  emails.push(...altEmails);

  // Build telegram connection list
  const { results: tgConns } = await c.env.DB.prepare(
    "SELECT id, provider_user_id, profile_data FROM social_connections WHERE user_id = ? AND provider = 'telegram' ORDER BY connected_at ASC",
  )
    .bind(user.id)
    .all<{ id: string; provider_user_id: string; profile_data: string }>();

  const tg_connections = tgConns.map((conn) => {
    let name = conn.provider_user_id;
    let username: string | null = null;
    try {
      const p = JSON.parse(conn.profile_data) as Record<string, unknown>;
      const fn = p.first_name as string | undefined;
      const ln = p.last_name as string | undefined;
      name = [fn, ln].filter(Boolean).join(" ") || conn.provider_user_id;
      username = (p.username as string | undefined) ?? null;
    } catch {
      // ignore
    }
    return { id: conn.id, name, username };
  });

  // Build discord connection list
  const { results: discordConns } = await c.env.DB.prepare(
    "SELECT id, provider_user_id, profile_data FROM social_connections WHERE user_id = ? AND provider = 'discord' ORDER BY connected_at ASC",
  )
    .bind(user.id)
    .all<{ id: string; provider_user_id: string; profile_data: string }>();

  const discord_connections = discordConns.map((conn) => {
    let name = conn.provider_user_id;
    let username: string | null = null;
    try {
      const p = JSON.parse(conn.profile_data) as Record<string, unknown>;
      const globalName = p.global_name as string | undefined;
      username = (p.username as string | undefined) ?? null;
      name = globalName || username || conn.provider_user_id;
    } catch {
      // ignore
    }
    return { id: conn.id, name, username };
  });

  return c.json({
    rules,
    emails,
    tg_connections,
    discord_connections,
    available: USER_NOTIFICATION_EVENTS,
  });
});

/**
 * Strip every field that isn't a known event / channel / level. Returns a
 * cleaned NotificationRules object. Shared between the prefs PUT and the
 * notification-rulesets CRUD endpoints so a saved ruleset can never carry
 * a payload the prefs path itself would refuse.
 */
function sanitizeNotificationRules(input: unknown): NotificationRules | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const valid: NotificationRules = {};
  const validEvents = USER_NOTIFICATION_EVENTS as readonly string[];
  for (const [ev, rule] of Object.entries(input as Record<string, unknown>)) {
    if (!validEvents.includes(ev)) continue;
    if (!rule || typeof rule !== "object") continue;
    const cleaned: NonNullable<(typeof valid)[string]> = {};

    const r = rule as { email?: unknown; tg?: unknown; discord?: unknown };
    if (Array.isArray(r.email)) {
      const emailEntries: typeof cleaned.email = [];
      for (const entry of r.email) {
        const { email_id, level } = entry as unknown as Record<string, unknown>;
        if (
          typeof email_id === "string" &&
          email_id.length > 0 &&
          (level === "brief" || level === "full")
        ) {
          emailEntries.push({ email_id, level });
        }
      }
      if (emailEntries.length) cleaned.email = emailEntries;
    }

    if (Array.isArray(r.tg)) {
      const tgEntries: typeof cleaned.tg = [];
      for (const entry of r.tg) {
        const { connection_id, level } = entry as unknown as Record<
          string,
          unknown
        >;
        if (
          typeof connection_id === "string" &&
          connection_id.length > 0 &&
          (level === "brief" || level === "full")
        ) {
          tgEntries.push({ connection_id, level });
        }
      }
      if (tgEntries.length) cleaned.tg = tgEntries;
    }

    if (Array.isArray(r.discord)) {
      const discordEntries: typeof cleaned.discord = [];
      for (const entry of r.discord) {
        const { connection_id, level } = entry as unknown as Record<
          string,
          unknown
        >;
        if (
          typeof connection_id === "string" &&
          connection_id.length > 0 &&
          (level === "brief" || level === "full")
        ) {
          discordEntries.push({ connection_id, level });
        }
      }
      if (discordEntries.length) cleaned.discord = discordEntries;
    }

    valid[ev] = cleaned;
  }
  return valid;
}

const RULESET_NAME_MAX = 64;
const RULESET_NAME_RE = /^[\w][\w .,'\-()/]{0,63}$/u;

function validateRulesetName(raw: unknown): { name: string; error?: string } {
  if (typeof raw !== "string")
    return { name: "", error: "name must be a string" };
  const trimmed = raw.trim();
  if (!trimmed) return { name: "", error: "name is required" };
  if (trimmed.length > RULESET_NAME_MAX)
    return {
      name: trimmed,
      error: `name must be ${RULESET_NAME_MAX} characters or fewer`,
    };
  if (!RULESET_NAME_RE.test(trimmed))
    return {
      name: trimmed,
      error:
        "name may only contain letters, digits, spaces and . , - _ ( ) / '",
    };
  return { name: trimmed };
}

// PUT /api/user/me/notifications
app.put("/me/notifications", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ rules: NotificationRules }>();

  const valid = sanitizeNotificationRules(body.rules);
  if (valid === null) return c.json({ error: "rules must be an object" }, 400);

  await c.env.DB.prepare(
    "INSERT INTO user_notification_prefs (user_id, notification_rules) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET notification_rules = excluded.notification_rules",
  )
    .bind(user.id, JSON.stringify(valid))
    .run();

  return c.json({ rules: valid });
});

// ─── Notification rulesets (rule-engine presets) ─────────────────────────────
//
// A ruleset is an ordered list of NotificationRule entries — see
// worker/lib/notificationRules.ts for the rule shape and the evaluator.
// At most one ruleset per user is `is_active`; activating one
// automatically deactivates any other. When a ruleset is active it drives
// dispatch; otherwise the legacy per-event rules in
// user_notification_prefs.notification_rules apply.

import {
  sanitizeRulesArray,
  type NotificationRule,
} from "../lib/notificationRules";

interface RulesetRow {
  id: string;
  name: string;
  rules: string;
  is_active: number;
  created_at: number;
  updated_at: number;
}

function rulesetToJson(row: RulesetRow) {
  let rules: NotificationRule[] = [];
  try {
    const parsed = JSON.parse(row.rules);
    if (Array.isArray(parsed)) rules = parsed as NotificationRule[];
  } catch {
    // ignore — corrupted row, return empty
  }
  return {
    id: row.id,
    name: row.name,
    rules,
    is_active: !!row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// GET /api/user/me/notification-rulesets — list every saved ruleset
app.get("/me/notification-rulesets", async (c) => {
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, rules, is_active, created_at, updated_at FROM notification_rulesets WHERE user_id = ? ORDER BY name COLLATE NOCASE ASC",
  )
    .bind(user.id)
    .all<RulesetRow>();
  return c.json({ rulesets: results.map(rulesetToJson) });
});

// POST /api/user/me/notification-rulesets — save a new ruleset
app.post("/me/notification-rulesets", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    name?: unknown;
    rules?: unknown;
    is_active?: unknown;
  }>();

  const { name, error: nameErr } = validateRulesetName(body.name);
  if (nameErr) return c.json({ error: nameErr }, 400);

  const validation = sanitizeRulesArray(
    body.rules,
    USER_NOTIFICATION_EVENTS as readonly string[],
  );
  if (validation.error) return c.json({ error: validation.error }, 400);
  const cleanedRules = validation.rules;

  const id = randomId();
  const now = Math.floor(Date.now() / 1000);
  const wantActive = !!body.is_active;
  try {
    if (wantActive) {
      // Single transaction so we never have two active rulesets for a user.
      await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE notification_rulesets SET is_active = 0, updated_at = ? WHERE user_id = ? AND is_active = 1",
        ).bind(now, user.id),
        c.env.DB.prepare(
          "INSERT INTO notification_rulesets (id, user_id, name, rules, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
        ).bind(id, user.id, name, JSON.stringify(cleanedRules), now, now),
      ]);
    } else {
      await c.env.DB.prepare(
        "INSERT INTO notification_rulesets (id, user_id, name, rules, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
      )
        .bind(id, user.id, name, JSON.stringify(cleanedRules), now, now)
        .run();
    }
  } catch (err) {
    if (String(err).includes("UNIQUE"))
      return c.json({ error: "A ruleset with that name already exists" }, 409);
    throw err;
  }
  return c.json(
    {
      ruleset: {
        id,
        name,
        rules: cleanedRules,
        is_active: wantActive,
        created_at: now,
        updated_at: now,
      },
    },
    201,
  );
});

// PUT /api/user/me/notification-rulesets/:id — rename, replace rules,
// and/or toggle is_active
app.put("/me/notification-rulesets/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json<{
    name?: unknown;
    rules?: unknown;
    is_active?: unknown;
  }>();

  const existing = await c.env.DB.prepare(
    "SELECT id FROM notification_rulesets WHERE id = ? AND user_id = ?",
  )
    .bind(id, user.id)
    .first<{ id: string }>();
  if (!existing) return c.json({ error: "Not found" }, 404);

  const sets: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    const { name, error: nameErr } = validateRulesetName(body.name);
    if (nameErr) return c.json({ error: nameErr }, 400);
    sets.push("name = ?");
    values.push(name);
  }
  if (body.rules !== undefined) {
    const validation = sanitizeRulesArray(
      body.rules,
      USER_NOTIFICATION_EVENTS as readonly string[],
    );
    if (validation.error) return c.json({ error: validation.error }, 400);
    sets.push("rules = ?");
    values.push(JSON.stringify(validation.rules));
  }
  const willToggleActive = body.is_active !== undefined;
  if (willToggleActive) {
    sets.push("is_active = ?");
    values.push(body.is_active ? 1 : 0);
  }
  if (!sets.length) return c.json({ error: "Nothing to update" }, 400);

  const now = Math.floor(Date.now() / 1000);
  sets.push("updated_at = ?");
  values.push(now, id, user.id);

  try {
    if (willToggleActive && body.is_active) {
      // Deactivate every other ruleset first so there's at most one
      // active per user — see migration 0044.
      await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE notification_rulesets SET is_active = 0, updated_at = ? WHERE user_id = ? AND is_active = 1 AND id != ?",
        ).bind(now, user.id, id),
        c.env.DB.prepare(
          `UPDATE notification_rulesets SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
        ).bind(...values),
      ]);
    } else {
      await c.env.DB.prepare(
        `UPDATE notification_rulesets SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
      )
        .bind(...values)
        .run();
    }
  } catch (err) {
    if (String(err).includes("UNIQUE"))
      return c.json({ error: "A ruleset with that name already exists" }, 409);
    throw err;
  }

  const row = await c.env.DB.prepare(
    "SELECT id, name, rules, is_active, created_at, updated_at FROM notification_rulesets WHERE id = ?",
  )
    .bind(id)
    .first<RulesetRow>();
  return c.json({ ruleset: row ? rulesetToJson(row) : null });
});

// DELETE /api/user/me/notification-rulesets/:id
app.delete("/me/notification-rulesets/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const result = await c.env.DB.prepare(
    "DELETE FROM notification_rulesets WHERE id = ? AND user_id = ?",
  )
    .bind(id, user.id)
    .run();
  if (!result.meta?.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ message: "Deleted" });
});

export default app;
