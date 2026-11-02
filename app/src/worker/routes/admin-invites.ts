// Admin → site invites: /api/admin/invites — the invite links that let people
// register while registration is invite-only.

import { Hono } from "hono";
import { getConfig } from "../lib/config";
import { isHashedSecret } from "../lib/secretCrypto";
import {
  emailConfigFromSite,
  inviteEmailTemplate,
  sendEmail,
} from "../lib/email";
import { readPage, likePattern } from "../lib/pagination";
import { randomBase64url, randomId } from "../lib/crypto";
import { auditAdmin } from "../lib/audit";
import type { SiteInviteRow, Variables } from "../types";
import {
  inviteSetClause,
  isInviteEnabled,
  validateInviteMaxUses,
} from "../lib/inviteManagement";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

// ─── Site Invites ─────────────────────────────────────────────────────────────

// List all invites
app.get("/invites", async (c) => {
  const { page, limit, offset } = readPage(
    c.req.query("page"),
    c.req.query("limit"),
    20,
  );
  const query = c.req.query("q")?.trim() ?? "";

  const where = query
    ? "LOWER(COALESCE(i.email, '') || COALESCE(' ' || i.note, '')) LIKE LOWER(?) ESCAPE '\\'"
    : "1 = 1";
  const args: unknown[] = query ? [likePattern(query)] : [];

  const [invites, countRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT i.*, u.username AS created_by_username
       FROM site_invites i
       LEFT JOIN users u ON u.id = i.created_by
       WHERE ${where}
       ORDER BY i.created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(...args, limit, offset)
      .all<SiteInviteRow & { created_by_username: string | null }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM site_invites i WHERE ${where}`)
      .bind(...args)
      .first<{ n: number }>(),
  ]);
  return c.json({
    invites: invites.results.map((invite) => ({
      ...invite,
      enabled: isInviteEnabled(invite.enabled),
      token_available: !isHashedSecret(invite.token),
    })),
    total: countRow?.n ?? 0,
    page,
    limit,
  });
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
  const storedToken = token;
  const expiresAt = body.expires_in_days
    ? now + body.expires_in_days * 86400
    : null;

  await c.env.DB.prepare(
    `INSERT INTO site_invites (id, token, email, note, max_uses, use_count, created_by, expires_at, created_at, enabled)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 1)`,
  )
    .bind(
      id,
      storedToken,
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
      c.env,
      {
        to: body.email,
        subject: `You've been invited to ${config.site_name}`,
        ...tmpl,
      },
      emailConfigFromSite(config),
    );
  }

  auditAdmin(
    c,
    "invite.create",
    "site_invite",
    id,
    { email: body.email ?? null },
    body.email ?? null,
  );

  return c.json(
    { invite: { id, token, invite_url: inviteUrl, enabled: true } },
    201,
  );
});

app.get("/invites/:id", async (c) => {
  const invite = await c.env.DB.prepare(
    `SELECT i.*, u.username AS created_by_username
     FROM site_invites i
     LEFT JOIN users u ON u.id = i.created_by
     WHERE i.id = ?`,
  )
    .bind(c.req.param("id"))
    .first<SiteInviteRow & { created_by_username: string | null }>();
  if (!invite) return c.json({ error: "invite_not_found" }, 404);
  return c.json({
    invite: {
      ...invite,
      enabled: isInviteEnabled(invite.enabled),
      token_available: !isHashedSecret(invite.token),
    },
  });
});

app.patch("/invites/:id", async (c) => {
  const id = c.req.param("id");
  const invite = await c.env.DB.prepare(
    "SELECT * FROM site_invites WHERE id = ?",
  )
    .bind(id)
    .first<SiteInviteRow>();
  if (!invite) return c.json({ error: "invite_not_found" }, 404);
  const body = await c.req.json<{
    email?: string | null;
    note?: string | null;
    max_uses?: number | null;
    expires_in_days?: number | null;
    enabled?: boolean;
  }>();
  const changes: Record<string, unknown> = {};
  let email = invite.email;
  let note = invite.note;
  let maxUses = invite.max_uses;
  let expiresAt = invite.expires_at;
  let enabled = isInviteEnabled(invite.enabled);
  if (body.email !== undefined) {
    email = body.email?.toLowerCase().trim() || null;
    changes.email = email;
  }
  if (body.note !== undefined) {
    note = body.note?.trim() || null;
    changes.note = note;
  }
  if (body.max_uses !== undefined) {
    if (body.max_uses === null) maxUses = null;
    else {
      const valid = validateInviteMaxUses(body.max_uses, invite.use_count);
      if (!valid.ok) return c.json({ error: "max_uses_below_used" }, 400);
      maxUses = valid.value;
    }
    changes.max_uses = maxUses;
  }
  if (body.expires_in_days !== undefined) {
    if (body.expires_in_days === null) expiresAt = null;
    else if (
      !Number.isSafeInteger(body.expires_in_days) ||
      body.expires_in_days < 1
    )
      return c.json(
        {
          error: "field_must_be_positive_integer",
          params: { field: "expires_in_days" },
        },
        400,
      );
    else
      expiresAt = Math.floor(Date.now() / 1000) + body.expires_in_days * 86400;
    changes.expires_at = expiresAt;
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean")
      return c.json(
        { error: "field_must_be_boolean", params: { field: "enabled" } },
        400,
      );
    enabled = body.enabled;
    changes.enabled = enabled;
  }
  if (!Object.keys(changes).length)
    return c.json({ error: "nothing_to_update" }, 400);
  const set = inviteSetClause(changes);
  const useGuard =
    body.max_uses !== undefined && maxUses !== null
      ? " AND use_count <= ?"
      : "";
  // The guard's value binds after the id: it follows `id = ?` in the SQL.
  const updated = await c.env.DB.prepare(
    `UPDATE site_invites SET ${set.sql} WHERE id = ?${useGuard}`,
  )
    .bind(...set.values, id, ...(useGuard ? [maxUses] : []))
    .run();
  if (!updated.meta.changes)
    return c.json({ error: "invite_usage_changed" }, 409);
  auditAdmin(
    c,
    enabled === isInviteEnabled(invite.enabled)
      ? "invite.update"
      : enabled
        ? "invite.enable"
        : "invite.disable",
    "site_invite",
    id,
    { changes },
  );
  return c.json({
    invite: {
      ...invite,
      email,
      note,
      max_uses: maxUses,
      expires_at: expiresAt,
      enabled,
    },
  });
});

// Revoke (delete) invite
app.delete("/invites/:id", async (c) => {
  const { id } = c.req.param();

  const invite = await c.env.DB.prepare(
    "SELECT id FROM site_invites WHERE id = ?",
  )
    .bind(id)
    .first<{ id: string }>();
  if (!invite) return c.json({ error: "invite_not_found" }, 404);

  await c.env.DB.prepare("DELETE FROM site_invites WHERE id = ?")
    .bind(id)
    .run();

  auditAdmin(c, "invite.revoke", "site_invite", id, {});

  return c.json({ ok: true });
});

export default app;
