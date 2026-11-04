// User profile routes

import {
  RESTRICTED_CAPABILITY_DEFAULTS,
  getRestrictedCapabilities,
  guardCapability,
  isPendingJoin,
  isRestricted,
  isSyntheticEmail,
  resolveRestrictedCapability,
  resolveSelfConvert,
} from "../lib/userCapabilities";
import { Hono } from "hono";
import { hashPassword, verifyPassword } from "../lib/crypto";
import { requireAuth } from "../middleware/auth";
import { readSessionCookie, setSessionCookie } from "../lib/cookies";
import {
  registerMarkdownImageMappings,
  sweepOrphanedImageProxyMappings,
} from "../lib/proxyImage";
import { toSessionUser } from "../lib/sessionUser";
import { signOutEverywhere } from "../lib/session";
import { validateImageUrl } from "../lib/imageValidation";
import {
  recordAudit,
  recordAccountDeletion,
  auditRequestMeta,
} from "../lib/audit";
import {
  deliverUserEmailNotifications,
  notificationActorMetaFromHeaders,
} from "../lib/notifications";
import { getConfig, getConfigValue } from "../lib/config";
import { getGithubReadmeFromCache } from "../lib/githubReadme";
import { encryptSecret } from "../lib/secretCrypto";
import type { RestrictedCapability, UserRow, Variables } from "../types";
import notificationRoutes from "./user-notifications";
import tokenRoutes from "./user-tokens";
import emailRoutes from "./user-emails";
import {
  PASSWORD_MIN_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
} from "../../shared/limits";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

app.use("*", requireAuth);

// Get own profile
app.get("/me", async (c) => {
  const user = c.get("user");
  const row = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(user.id)
    .first<UserRow>();
  if (!row) return c.json({ error: "user_not_found" }, 404);

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
    user: await selfUser(c.env.APP_URL, c.env.DB, row),
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
    notify_on_auto_authorization?: boolean;
    gpg_require_2fa?: boolean;
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
    if (
      body.display_name.length < 1 ||
      body.display_name.length > DISPLAY_NAME_MAX_LENGTH
    )
      return c.json(
        {
          error: "field_length",
          params: {
            field: "display_name",
            min: 1,
            max: DISPLAY_NAME_MAX_LENGTH,
          },
        },
        400,
      );
    updates.push("display_name = ?");
    values.push(body.display_name);
  }
  if (body.avatar_url !== undefined) {
    if (body.avatar_url && !body.avatar_url.startsWith("/api/assets/")) {
      const imgErr = await validateImageUrl(body.avatar_url);
      if (imgErr) return c.json(imgErr, 400);
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
          {
            error: "field_must_be_positive_integer",
            params: { field: "access_token_ttl_minutes" },
          },
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
          {
            error: "field_must_be_positive_integer",
            params: { field: "refresh_token_ttl_days" },
          },
          400,
        );
    }
    updates.push("refresh_token_ttl_days = ?");
    values.push(body.refresh_token_ttl_days ?? null);
  }
  if (body.notify_on_auto_authorization !== undefined) {
    updates.push("notify_on_auto_authorization = ?");
    values.push(body.notify_on_auto_authorization ? 1 : 0);
  }
  if (body.gpg_require_2fa !== undefined) {
    // Non-nullable — the site has no configurable default here, so the
    // preference is stored as a plain 0/1 with the migration's default of 1
    // preserving pre-existing behaviour.
    updates.push("gpg_require_2fa = ?");
    values.push(body.gpg_require_2fa ? 1 : 0);
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
      return c.json(
        { error: "field_must_be_string", params: { field: "profile_readme" } },
        400,
      );
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
          {
            error: "field_max_bytes",
            params: { field: "profile_readme", max: maxBytes },
          },
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
        {
          error: "field_one_of",
          params: { field: "profile_readme_source", values: "manual, github" },
        },
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
          return c.json({ error: "github_connection_not_found" }, 400);
        }
        try {
          const profile = JSON.parse(conn.profile_data) as { login?: string };
          if (profile.login) login = profile.login;
        } catch {
          // ignore — fall back to whatever the client sent
        }
      }
      if (!login) {
        return c.json({ error: "github_source_needs_account" }, 400);
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
        {
          error: "field_must_be_string",
          params: { field: "github_readme_token" },
        },
        400,
      );
    }
    const tok = body.github_readme_token?.trim() || null;
    if (tok && tok.length > 256) {
      return c.json(
        { error: "field_too_long", params: { field: "github_readme_token" } },
        400,
      );
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

  if (updates.length === 0) return c.json({ error: "nothing_to_update" }, 400);

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
    (f) =>
      f !== "updated_at" &&
      f !== "profile_readme_updated_at" &&
      f !== "profile_readme_source_meta",
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
  return c.json({ user: await selfUser(c.env.APP_URL, c.env.DB, row!) });
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
  if (!row) return c.json({ error: "user_not_found" }, 404);

  if (row.password_hash) {
    if (!body.current_password)
      return c.json(
        { error: "field_required", params: { field: "current_password" } },
        400,
      );
    const ok = await verifyPassword(body.current_password, row.password_hash);
    if (!ok) return c.json({ error: "wrong_password" }, 401);
  }

  if (!body.new_password || body.new_password.length < PASSWORD_MIN_LENGTH)
    return c.json({ error: "password_too_short" }, 400);

  const hash = await hashPassword(body.new_password);
  await c.env.DB.prepare(
    "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
  )
    .bind(hash, Math.floor(Date.now() / 1000), user.id)
    .run();

  // Whoever had the old password may still hold a session or an app's
  // refresh token; a new password has to lock them out. This browser stays.
  // A first password (an account that signed up through a social provider)
  // replaces nothing anyone could have stolen, so it signs nothing out.
  if (row.password_hash)
    await signOutEverywhere(
      c.env,
      c.executionCtx,
      user.id,
      c.get("sessionId") ?? null,
    );

  return c.json({ ok: true });
});

// Upload avatar to R2
app.post("/me/avatar", async (c) => {
  if (!c.env.R2_ASSETS) return c.json({ error: "uploads_disabled" }, 503);

  const r2 = c.env.R2_ASSETS;
  const user = c.get("user");
  const formData = await c.req.formData();
  const file: unknown = formData.get("avatar");

  if (!(file instanceof File))
    return c.json(
      { error: "field_required", params: { field: "avatar" } },
      400,
    );
  if (file.size > 2 * 1024 * 1024)
    return c.json({ error: "avatar_too_large" }, 400);
  if (
    !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)
  )
    return c.json({ error: "file_type_invalid" }, 400);

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
  const file: unknown = formData.get("readme");

  if (!(file instanceof File))
    return c.json(
      { error: "field_required", params: { field: "readme" } },
      400,
    );
  if (file.size > maxBytes) {
    return c.json(
      { error: "field_max_bytes", params: { field: "readme", max: maxBytes } },
      413,
    );
  }
  // Restrict to text-ish types. Some browsers send empty type for .md.
  const type = (file.type || "").toLowerCase();
  if (
    type &&
    !type.startsWith("text/") &&
    type !== "application/octet-stream"
  ) {
    return c.json({ error: "readme_type_invalid" }, 400);
  }

  const text = await file.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    // file.size can lie when the upstream stream is chunked; recheck after read.
    return c.json(
      { error: "field_max_bytes", params: { field: "readme", max: maxBytes } },
      413,
    );
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
    return c.json({ error: "readme_not_github" }, 400);
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
  if (!login) return c.json({ error: "github_login_missing" }, 400);

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
    return c.json({ status: 404, error: "github_no_readme" }, 404);
  }
  return c.json(
    {
      status: 502,
      error: "github_fetch_failed",
    },
    502,
  );
});

// Delete account
app.delete("/me", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ password?: string; confirm: string }>();

  if (body.confirm !== "DELETE")
    return c.json({ error: "confirm_delete" }, 400);

  const row = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(user.id)
    .first<UserRow>();
  if (!row) return c.json({ error: "user_not_found" }, 404);

  if (row.password_hash) {
    if (!body.password)
      return c.json(
        { error: "field_required", params: { field: "password" } },
        400,
      );
    const ok = await verifyPassword(body.password, row.password_hash);
    if (!ok) return c.json({ error: "wrong_password" }, 401);
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
  return c.json({ ok: true });
});

/** The session user plus the account settings `/user/me` exposes. */
async function selfUser(baseUrl: string, db: D1Database, row: UserRow) {
  return {
    ...(await toSessionUser(baseUrl, db, row)),
    alt_email_login: row.alt_email_login,
    access_token_ttl_minutes: row.access_token_ttl_minutes,
    refresh_token_ttl_days: row.refresh_token_ttl_days,
    notify_on_auto_authorization: row.notify_on_auto_authorization === 1,
    gpg_require_2fa: row.gpg_require_2fa !== 0,
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

app.route("/", emailRoutes);

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
  if (!row) return c.json({ error: "user_not_found" }, 404);

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
  const canConvert = await resolveSelfConvert(
    c.env.DB,
    row.origin_team_id,
    grants,
  );

  return c.json({
    restricted: true,
    pending_join: isPendingJoin(row),
    origin_team: team,
    capabilities: Object.fromEntries(
      (
        Object.keys(RESTRICTED_CAPABILITY_DEFAULTS) as RestrictedCapability[]
      ).map((k) => [
        k,
        k === "self:convert"
          ? canConvert
          : resolveRestrictedCapability(k, grants),
      ]),
    ),
    conversion: {
      available: canConvert,
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
  if (!row) return c.json({ error: "user_not_found" }, 404);

  if (!isRestricted(row))
    return c.json({ error: "account_not_restricted" }, 400);
  if (isPendingJoin(row))
    return c.json({ error: "convert_finish_joining" }, 403);

  const grants = await getRestrictedCapabilities(c.env.DB);
  if (!(await resolveSelfConvert(c.env.DB, row.origin_team_id, grants)))
    return c.json({ error: "convert_disabled" }, 403);

  // The invite path may have skipped email verification to spare the instance
  // a mail send per registration. That deferral ends here: an account about
  // to gain every ordinary feature must first be reachable, and must satisfy
  // whatever the site requires of an ordinary account.
  const config = await getConfig(c.env.DB);
  if (isSyntheticEmail(row.email))
    return c.json(
      {
        error: "convert_needs_real_email",
      },
      403,
    );
  if (config.require_email_verification && row.email_verified !== 1)
    return c.json({ error: "convert_verify_email" }, 403);

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

  return c.json({ converted_at: now });
});

// DELETE /api/user/me/emails/:id — remove an alternate email
app.delete("/me/emails/:id", async (c) => {
  const user = c.get("user");
  const emailRow = await c.env.DB.prepare(
    "SELECT id FROM user_emails WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), user.id)
    .first();
  if (!emailRow) return c.json({ error: "email_not_found" }, 404);

  await c.env.DB.prepare("DELETE FROM user_emails WHERE id = ?")
    .bind(c.req.param("id"))
    .run();

  return c.json({ ok: true });
});

app.route("/", tokenRoutes);

app.route("/", notificationRoutes);

export default app;
