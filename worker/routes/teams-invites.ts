// Team invites: /api/teams/:id/invites — creating, editing and revoking a
// team's invite links. Accepting one is in teams.ts (it runs before auth).

import { Hono } from "hono";
import { randomBase64url } from "../lib/crypto";
import { hashLookupCandidate } from "../lib/secretCrypto";
import { getConfig, getConfigValue } from "../lib/config";
import { emailConfigFromSite, sendEmail } from "../lib/email";
import { readPage, likePattern } from "../lib/pagination";
import type { TeamGroupRow, Variables } from "../types";
import {
  MAX_GROUPS_PER_MEMBER,
  canAssignGroup,
  getSiteRolePermissions,
} from "../lib/teamGroups";
import { parseInviteExpiry } from "../lib/inviteExpiry";
import {
  canManageTeamInvite,
  isInviteEnabled,
  validateInviteMaxUses,
  loadInviteGroups,
  type InviteRow,
} from "../lib/inviteManagement";
import { hasRole, teamAuthority, auditTeam } from "../lib/teams";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

// ─── Invites ──────────────────────────────────────────────────────────────────

// List invites for a team, including expired rows so managers can extend them.
app.get("/:id/invites", async (c) => {
  const id = c.req.param("id");

  const eff = await teamAuthority(c, id);
  if (!eff) return c.json({ error: "not_found" }, 404);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "forbidden" }, 403);

  const { page, limit, offset } = readPage(
    c.req.query("page"),
    c.req.query("limit"),
    20,
  );
  const query = c.req.query("q")?.trim() ?? "";

  const where = query
    ? "i.team_id = ? AND LOWER(COALESCE(i.email, '')) LIKE LOWER(?) ESCAPE '\\'"
    : "i.team_id = ?";
  const args: unknown[] = query ? [id, likePattern(query)] : [id];

  const [invites, countRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT i.*, u.username AS created_by_username
       FROM team_invites i JOIN users u ON u.id = i.created_by
       WHERE ${where}
       ORDER BY i.created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(...args, limit, offset)
      .all<InviteRow & { created_by_username: string }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n
       FROM team_invites i JOIN users u ON u.id = i.created_by
       WHERE ${where}`,
    )
      .bind(...args)
      .first<{ n: number }>(),
  ]);

  const inviteGroups = await loadInviteGroups(
    c.env.DB,
    invites.results.map((invite) => invite.token),
  );
  return c.json({
    invites: invites.results.map((invite) => {
      const canManage = canManageTeamInvite(
        eff.role,
        c.get("user").id,
        invite.created_by,
      );
      return {
        ...invite,
        token: canManage ? invite.token : null,
        enabled: isInviteEnabled(invite.enabled),
        can_manage: canManage,
        allows_registration: invite.allows_registration === 1,
        allow_existing_members: invite.allow_existing_members === 1,
        groups: inviteGroups.get(invite.token) ?? [],
      };
    }),
    total: countRow?.n ?? 0,
    page,
    limit,
  });
});

// Create invite (shareable link or email)
app.post("/:id/invites", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const eff = await teamAuthority(c, id);
  if (!eff) return c.json({ error: "not_found" }, 404);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{
    role?: string;
    max_uses?: number;
    expires_at?: number;
    email?: string;
    allows_registration?: boolean;
    allow_existing_members?: boolean;
    group_ids?: string[];
  }>();

  if (
    body.max_uses !== undefined &&
    (!Number.isSafeInteger(body.max_uses) || body.max_uses < 0)
  )
    return c.json(
      { error: "field_min", params: { field: "max_uses", min: 0 } },
      400,
    );

  let role: string = "member";
  if (body.role === "admin") role = "admin";
  if (body.role === "co-owner" && hasRole(eff.role, "owner")) role = "co-owner";
  const maxUses = body.max_uses ?? 0;

  let allowsRegistration = 0;
  if (body.allows_registration) {
    const team = await c.env.DB.prepare(
      "SELECT invite_registration_granted FROM teams WHERE id = ?",
    )
      .bind(id)
      .first<{ invite_registration_granted: number }>();
    // The site admin's grant, and sign-up not closed.
    const signUpOpen = await getConfigValue(c.env.DB, "allow_registration");
    if (!signUpOpen || team?.invite_registration_granted !== 1)
      return c.json({ error: "team_invite_signup_off" }, 403);
    // An account-minting invite must be bounded. team_invites defaults
    // max_uses to 0 = unlimited, which is harmless while invites only admit
    // existing users but would mean unlimited registration here — so the
    // caller has to name a finite number, under the site's ceiling.
    const cap = await getConfigValue(
      c.env.DB,
      "team_invite_registration_max_uses_cap",
    );
    if (!maxUses || maxUses < 1)
      return c.json({ error: "invite_needs_limit" }, 400);
    if (maxUses > cap)
      return c.json({ error: "invite_uses_cap", params: { max: cap } }, 400);
    // Registration invites always land people as plain members. Someone
    // arriving through a link should never start out able to manage the team.
    role = "member";
    allowsRegistration = 1;
  }
  const now = Math.floor(Date.now() / 1000);
  const expiry = parseInviteExpiry(body.expires_at, now);
  if (!expiry.ok)
    return c.json({ error: expiry.error, params: expiry.params }, 400);
  const expiresAt = expiry.expiresAt;

  if (!Array.isArray(body.group_ids ?? []))
    return c.json(
      { error: "field_must_be_array", params: { field: "group_ids" } },
      400,
    );
  if ((body.group_ids ?? []).some((groupId) => typeof groupId !== "string"))
    return c.json(
      { error: "field_invalid", params: { field: "group_ids" } },
      400,
    );
  const requestedGroupIds = [...new Set(body.group_ids ?? [])];
  if (requestedGroupIds.length > 1)
    return c.json({ error: "invite_one_group_max" }, 400);
  if (body.allow_existing_members && requestedGroupIds.length === 0)
    return c.json({ error: "invite_existing_needs_group" }, 400);
  if (requestedGroupIds.length > MAX_GROUPS_PER_MEMBER)
    return c.json(
      {
        error: "invite_group_limit",
        params: { max: MAX_GROUPS_PER_MEMBER },
      },
      400,
    );
  const inviteGroups: TeamGroupRow[] = [];
  if (requestedGroupIds.length > 0) {
    const team = await c.env.DB.prepare(
      "SELECT enable_groups, role_permissions FROM teams WHERE id = ?",
    )
      .bind(id)
      .first<{ enable_groups: number; role_permissions: string | null }>();
    if (!team || team.enable_groups !== 1)
      return c.json({ error: "member_groups_disabled" }, 400);
    const siteDefaults = await getSiteRolePermissions(c.env.DB);
    for (const groupId of requestedGroupIds) {
      const group = await c.env.DB.prepare(
        "SELECT * FROM team_groups WHERE id = ? AND team_id = ?",
      )
        .bind(groupId, id)
        .first<TeamGroupRow>();
      if (!group) return c.json({ error: "group_not_found" }, 400);
      if (!canAssignGroup(eff.role, group, team.role_permissions, siteDefaults))
        return c.json(
          { error: "group_not_assignable", params: { group: group.slug } },
          403,
        );
      inviteGroups.push(group);
    }
  }
  const token = randomBase64url(24);
  const storedToken = token;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO team_invites (token, team_id, role, created_by, email, max_uses, uses, expires_at, created_at, allows_registration, allow_existing_members, enabled)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 1)`,
    ).bind(
      storedToken,
      id,
      role,
      user.id,
      body.email ?? null,
      maxUses,
      expiresAt,
      now,
      allowsRegistration,
      body.allow_existing_members ? 1 : 0,
    ),
    ...inviteGroups.map((group) =>
      c.env.DB.prepare(
        "INSERT INTO team_invite_groups (invite_token, team_id, group_id) VALUES (?, ?, ?)",
      ).bind(storedToken, id, group.id),
    ),
  ]);

  auditTeam(c, id, "team.invite.create", {
    resourceType: "team_invite",
    resourceId: `invite:${token.slice(0, 8)}`,
    metadata: {
      role,
      email: body.email ?? null,
      max_uses: maxUses,
      allows_registration: allowsRegistration === 1,
      allow_existing_members: body.allow_existing_members === true,
      member_groups: inviteGroups.map((group) => group.slug),
      expires_at: expiresAt,
    },
  });

  const inviteLink = allowsRegistration
    ? `${c.env.APP_URL}/join/${id}?invite=${encodeURIComponent(token)}`
    : `${c.env.APP_URL}/teams/join/${token}`;

  // Send email if requested
  if (body.email) {
    const [team, config] = await Promise.all([
      c.env.DB.prepare("SELECT name FROM teams WHERE id = ?")
        .bind(id)
        .first<{ name: string }>(),
      getConfig(c.env.DB),
    ]);
    if (config.email_provider !== "none") {
      const esc = (s: string) =>
        s
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      const teamName = esc(team?.name ?? "a team");
      const senderName = esc(user.display_name);
      const siteName = esc(config.site_name);
      await sendEmail(
        c.env,
        {
          to: body.email,
          subject: `You've been invited to join ${team?.name ?? "a team"} on ${config.site_name}`,
          html: `<div style="font-family:sans-serif">
            <h2>Team Invitation</h2>
            <p>${senderName} has invited you to join <strong>${teamName}</strong> as a <strong>${role}</strong> on ${siteName}.</p>
            <p><a href="${inviteLink}" style="background:#5b5fc7;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;display:inline-block">Accept Invitation</a></p>
            <p style="color:#888;font-size:12px">This link expires at ${new Date(expiresAt * 1000).toISOString()}.</p>
          </div>`,
          text: `${user.display_name} invited you to join a team. Accept: ${inviteLink}`,
        },
        emailConfigFromSite(config),
      ).catch(() => {
        /* non-fatal */
      });
    }
  }

  return c.json(
    {
      invite: {
        token,
        team_id: id,
        role,
        email: body.email ?? null,
        max_uses: maxUses,
        uses: 0,
        expires_at: expiresAt,
        created_at: now,
        created_by_username: user.username,
        allows_registration: allowsRegistration === 1,
        allow_existing_members: body.allow_existing_members === true,
        enabled: true,
        can_manage: true,
        groups: inviteGroups.map((group) => ({
          id: group.id,
          slug: group.slug,
          name: group.name,
          color: group.color,
        })),
      },
    },
    201,
  );
});

// Revoke an invite
app.patch("/:id/invites/:token", async (c) => {
  const id = c.req.param("id");
  const token = c.req.param("token");
  const user = c.get("user");
  const eff = await teamAuthority(c, id);
  if (!eff) return c.json({ error: "not_found" }, 404);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "forbidden" }, 403);

  const invite = await c.env.DB.prepare(
    "SELECT * FROM team_invites WHERE token = ? AND team_id = ?",
  )
    .bind(token, id)
    .first<InviteRow>();
  if (!invite) return c.json({ error: "invite_not_found" }, 404);
  if (!canManageTeamInvite(eff.role, user.id, invite.created_by))
    return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{
    email?: string | null;
    max_uses?: number;
    expires_at?: number;
    enabled?: boolean;
  }>();
  const changes: Record<string, unknown> = {};
  let email = invite.email;
  let maxUses = invite.max_uses;
  let expiresAt = invite.expires_at;
  let enabled = isInviteEnabled(invite.enabled);
  if (body.email !== undefined) {
    email = body.email?.trim() || null;
    changes.email = email;
  }
  if (body.max_uses !== undefined) {
    const valid = validateInviteMaxUses(body.max_uses, invite.uses, 0);
    if (!valid.ok) return c.json({ error: "max_uses_below_used" }, 400);
    maxUses = valid.value;
    if (invite.allows_registration === 1) {
      const cap = await getConfigValue(
        c.env.DB,
        "team_invite_registration_max_uses_cap",
      );
      if (maxUses < 1 || maxUses > cap)
        return c.json(
          {
            error: "field_int_range",
            params: { field: "max_uses", min: 1, max: cap },
          },
          400,
        );
    }
    changes.max_uses = maxUses;
  }
  if (body.expires_at !== undefined) {
    const expiry = parseInviteExpiry(
      body.expires_at,
      Math.floor(Date.now() / 1000),
    );
    if (!expiry.ok)
      return c.json({ error: expiry.error, params: expiry.params }, 400);
    expiresAt = expiry.expiresAt;
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
  const assignments: string[] = [];
  const values: unknown[] = [];
  if (body.email !== undefined) {
    assignments.push("email = ?");
    values.push(email);
  }
  if (body.max_uses !== undefined) {
    assignments.push("max_uses = ?");
    values.push(maxUses);
  }
  if (body.expires_at !== undefined) {
    assignments.push("expires_at = ?");
    values.push(expiresAt);
  }
  if (body.enabled !== undefined) {
    assignments.push("enabled = ?");
    values.push(enabled ? 1 : 0);
  }
  const useGuard =
    body.max_uses !== undefined && maxUses !== 0 ? " AND uses <= ?" : "";
  if (useGuard) values.push(maxUses);
  const updated = await c.env.DB.prepare(
    `UPDATE team_invites SET ${assignments.join(", ")} WHERE token = ? AND team_id = ?${useGuard}`,
  )
    .bind(...values, token, id)
    .run();
  if (!updated.meta.changes)
    return c.json({ error: "invite_usage_changed" }, 409);
  auditTeam(
    c,
    id,
    enabled === isInviteEnabled(invite.enabled)
      ? "team.invite.update"
      : enabled
        ? "team.invite.enable"
        : "team.invite.disable",
    {
      resourceType: "team_invite",
      resourceId: `invite:${token.slice(0, 8)}`,
      metadata: { changes },
    },
  );
  return c.json({
    invite: {
      ...invite,
      email,
      max_uses: maxUses,
      expires_at: expiresAt,
      enabled,
    },
  });
});

app.delete("/:id/invites/:token", async (c) => {
  const id = c.req.param("id");
  const token = c.req.param("token");

  const user = c.get("user");
  const eff = await teamAuthority(c, id);
  if (!eff) return c.json({ error: "not_found" }, 404);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "forbidden" }, 403);

  const tokenLookup = await hashLookupCandidate(c.env, token);
  const invite = await c.env.DB.prepare(
    "SELECT created_by FROM team_invites WHERE (token = ? OR token = ?) AND team_id = ?",
  )
    .bind(token, tokenLookup ?? token, id)
    .first<{ created_by: string }>();
  if (invite && !canManageTeamInvite(eff.role, user.id, invite.created_by))
    return c.json({ error: "forbidden" }, 403);
  // For revoke, missing/suspicious tokens are silently treated as a no-op
  // delete — caller already gated by team admin role above, so a probe
  // here can't be used to enumerate invites.
  const result = await c.env.DB.prepare(
    "DELETE FROM team_invites WHERE (token = ? OR token = ?) AND team_id = ?",
  )
    .bind(token, tokenLookup ?? token, id)
    .run();

  if (result.meta.changes)
    auditTeam(c, id, "team.invite.revoke", {
      resourceType: "team_invite",
      resourceId: tokenLookup ?? token,
    });

  return c.json({ ok: true });
});

export default app;
