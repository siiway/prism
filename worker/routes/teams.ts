// Team management — collaborative app ownership

import { Hono } from "hono";
import { randomId, randomBase64url } from "../lib/crypto";
import { requireAuth, optionalAuth } from "../middleware/auth";
import { computeIsVerified } from "../lib/domainVerify";
import {
  checkMethod,
  isVerificationMethod,
  methodInstructions,
  tryAnyMethod,
  type VerificationMethod,
} from "../lib/domainOwnership";
import { getConfigValue } from "../lib/config";
import { validateImageUrl } from "../lib/imageValidation";
import { proxyImageUrl } from "../lib/proxyImage";
import type { DomainRow } from "../types";
import { getConfig } from "../lib/config";
import { sendEmail } from "../lib/email";
import {
  deliverUserEmailNotifications,
  notificationActorMetaFromHeaders,
} from "../lib/notifications";
import type { OAuthAppRow, TeamMemberRow, TeamRow, Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

// ─── Role helpers ─────────────────────────────────────────────────────────────

const ROLE_RANK: Record<string, number> = {
  owner: 4,
  "co-owner": 3,
  admin: 2,
  member: 1,
};

function hasRole(
  memberRole: string,
  required: "member" | "admin" | "co-owner" | "owner",
): boolean {
  return (ROLE_RANK[memberRole] ?? 0) >= ROLE_RANK[required];
}

async function getMember(
  db: D1Database,
  teamId: string,
  userId: string,
): Promise<TeamMemberRow | null> {
  return db
    .prepare("SELECT * FROM team_members WHERE team_id = ? AND user_id = ?")
    .bind(teamId, userId)
    .first<TeamMemberRow>();
}

// ─── Team-as-user helpers ────────────────────────────────────────────────────
//
// Synthetic credentials used to satisfy the NOT NULL UNIQUE constraints on
// users.email / users.username for kind='team' rows. The colon prefix
// guarantees the value can never collide with a real registration (the
// register validator only allows [a-z0-9_.-]).

export function teamUserSyntheticUsername(teamId: string): string {
  return `team:${teamId}`;
}

export function teamUserSyntheticEmail(teamId: string): string {
  return `team-${teamId}@teams.invalid`;
}

/**
 * Disband a team. Reassigns any team-owned apps to a real-user fallback so
 * the app rows survive the cascading delete that follows from removing the
 * team-user (oauth_apps.owner_id REFERENCES users(id) ON DELETE CASCADE).
 *
 * Falls back to the deleting user if the team has no owner-role member.
 */
export async function dissolveTeam(
  db: D1Database,
  teamId: string,
  fallbackUserId: string,
): Promise<void> {
  const ownerRow = await db
    .prepare(
      "SELECT user_id FROM team_members WHERE team_id = ? AND role = 'owner' LIMIT 1",
    )
    .bind(teamId)
    .first<{ user_id: string }>();
  const reassignTo = ownerRow?.user_id ?? fallbackUserId;
  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare(
      "UPDATE oauth_apps SET team_id = NULL, owner_id = ?, updated_at = ? WHERE team_id = ?",
    )
    .bind(reassignTo, now, teamId)
    .run();

  // Drop the team-user row if it exists. CASCADE-safe now that no app
  // rows still point at it as owner.
  await db
    .prepare("DELETE FROM users WHERE id = ? AND kind = 'team'")
    .bind(teamId)
    .run();

  await db.prepare("DELETE FROM teams WHERE id = ?").bind(teamId).run();
}

// ─── Public invite join routes (BEFORE global auth middleware) ────────────────

interface InviteRow {
  token: string;
  team_id: string;
  role: string;
  created_by: string;
  email: string | null;
  max_uses: number;
  uses: number;
  expires_at: number;
  created_at: number;
}

// GET /join/:token — public: show invite info
app.get("/join/:token", optionalAuth, async (c) => {
  const token = c.req.param("token");
  const now = Math.floor(Date.now() / 1000);

  const invite = await c.env.DB.prepare(
    "SELECT * FROM team_invites WHERE token = ? AND expires_at > ?",
  )
    .bind(token, now)
    .first<InviteRow>();

  if (!invite) return c.json({ error: "Invite not found or expired" }, 404);
  if (invite.max_uses > 0 && invite.uses >= invite.max_uses)
    return c.json({ error: "Invite link has reached its usage limit" }, 410);

  const team = await c.env.DB.prepare(
    "SELECT id, name, avatar_url FROM teams WHERE id = ?",
  )
    .bind(invite.team_id)
    .first<{ id: string; name: string; avatar_url: string | null }>();
  if (!team) return c.json({ error: "Team not found" }, 404);

  return c.json({
    team: {
      ...team,
      avatar_url: proxyImageUrl(c.env.APP_URL, team.avatar_url),
      unproxied_avatar_url: team.avatar_url,
    },
    invite: { role: invite.role, expires_at: invite.expires_at },
    user: c.get("user") ?? null,
  });
});

// POST /join/:token — accept invite (must be authenticated)
app.post("/join/:token", requireAuth, async (c) => {
  const user = c.get("user");
  const token = c.req.param("token");
  const now = Math.floor(Date.now() / 1000);

  const invite = await c.env.DB.prepare(
    "SELECT * FROM team_invites WHERE token = ? AND expires_at > ?",
  )
    .bind(token, now)
    .first<InviteRow>();

  if (!invite) return c.json({ error: "Invite not found or expired" }, 404);
  if (invite.max_uses > 0 && invite.uses >= invite.max_uses)
    return c.json({ error: "Invite link has reached its usage limit" }, 410);
  // Email-specific invites can only be used by the addressed user
  if (invite.email && invite.email.toLowerCase() !== user.email.toLowerCase())
    return c.json(
      { error: "This invite is for a different email address" },
      403,
    );

  const existing = await getMember(c.env.DB, invite.team_id, user.id);
  if (existing) return c.json({ error: "Already a member of this team" }, 409);

  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)",
    ).bind(invite.team_id, user.id, invite.role, now),
    c.env.DB.prepare(
      "UPDATE team_invites SET uses = uses + 1 WHERE token = ?",
    ).bind(token),
  ]);

  return c.json({ team_id: invite.team_id, message: "Joined team" });
});

// ─── All remaining routes require auth ────────────────────────────────────────

app.use("*", requireAuth);

// ─── Team CRUD ────────────────────────────────────────────────────────────────

// List teams the current user belongs to
app.get("/", async (c) => {
  const user = c.get("user");
  const rows = await c.env.DB.prepare(
    `SELECT t.*, tm.role, tm.show_on_profile
     FROM teams t
     JOIN team_members tm ON tm.team_id = t.id
     WHERE tm.user_id = ?
     ORDER BY t.created_at DESC`,
  )
    .bind(user.id)
    .all<TeamRow & { role: string; show_on_profile: number | null }>();

  return c.json({
    teams: rows.results.map((t) => ({
      ...t,
      avatar_url: proxyImageUrl(c.env.APP_URL, t.avatar_url),
      unproxied_avatar_url: t.avatar_url,
      show_on_profile:
        t.show_on_profile === null ? null : t.show_on_profile === 1,
    })),
  });
});

// Per-team override of profile_show_joined_teams. Caller must be a member.
// Body: { show_on_profile: true | false | null } — null reverts to following
// the user's master profile_show_joined_teams toggle.
app.patch("/:id/membership/show-on-profile", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json<{ show_on_profile: boolean | null }>();

  const member = await c.env.DB.prepare(
    "SELECT 1 AS x FROM team_members WHERE team_id = ? AND user_id = ?",
  )
    .bind(id, user.id)
    .first<{ x: number }>();
  if (!member) return c.json({ error: "Not a member of this team" }, 404);

  const stored =
    body.show_on_profile === null ? null : body.show_on_profile ? 1 : 0;
  await c.env.DB.prepare(
    "UPDATE team_members SET show_on_profile = ? WHERE team_id = ? AND user_id = ?",
  )
    .bind(stored, id, user.id)
    .run();
  return c.json({ show_on_profile: body.show_on_profile });
});

// Create team
app.post("/", async (c) => {
  const user = c.get("user");

  if (user.role !== "admin") {
    const disabled = await getConfigValue(c.env.DB, "disable_user_create_team");
    if (disabled) return c.json({ error: "Team creation is disabled" }, 403);
  }

  const body = await c.req.json<{
    name: string;
    description?: string;
    avatar_url?: string;
  }>();
  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);

  if (body.avatar_url) {
    const imgErr = await validateImageUrl(body.avatar_url);
    if (imgErr) return c.json({ error: `avatar_url: ${imgErr}` }, 400);
  }

  const id = randomId();
  const now = Math.floor(Date.now() / 1000);
  const teamUserUsername = teamUserSyntheticUsername(id);
  const teamUserEmail = teamUserSyntheticEmail(id);

  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO teams (id, name, description, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(
      id,
      body.name.trim(),
      body.description ?? "",
      body.avatar_url ?? null,
      now,
      now,
    ),
    // Synthetic user row mirroring the team — kind='team' rules out login,
    // sessions, social linking, etc. The id matches teams.id so any code
    // joining oauth_apps.owner_id → users still resolves to the team.
    c.env.DB.prepare(
      "INSERT INTO users (id, email, username, password_hash, display_name, avatar_url, role, kind, email_verified, is_active, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, 'user', 'team', 0, 1, ?, ?)",
    ).bind(
      id,
      teamUserEmail,
      teamUserUsername,
      body.name.trim(),
      body.avatar_url ?? null,
      now,
      now,
    ),
    c.env.DB.prepare(
      "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
    ).bind(id, user.id, now),
  ]);

  const team = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ?")
    .bind(id)
    .first<TeamRow>();

  return c.json({ team: { ...team!, role: "owner" } }, 201);
});

// Get team details + members
app.get("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const member = await getMember(c.env.DB, id, user.id);
  if (!member) return c.json({ error: "Not found" }, 404);

  const [team, members] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM teams WHERE id = ?")
      .bind(id)
      .first<TeamRow>(),
    c.env.DB.prepare(
      `SELECT tm.user_id, tm.role, tm.joined_at,
              u.username, u.display_name, u.avatar_url
       FROM team_members tm JOIN users u ON u.id = tm.user_id
       WHERE tm.team_id = ? ORDER BY tm.joined_at ASC`,
    )
      .bind(id)
      .all<{
        user_id: string;
        role: string;
        joined_at: number;
        username: string;
        display_name: string;
        avatar_url: string | null;
      }>(),
  ]);

  if (!team) return c.json({ error: "Not found" }, 404);

  return c.json({
    team: {
      ...team,
      avatar_url: proxyImageUrl(c.env.APP_URL, team.avatar_url),
      unproxied_avatar_url: team.avatar_url,
      my_role: member.role,
    },
    members: members.results.map((m) => ({
      ...m,
      avatar_url: proxyImageUrl(c.env.APP_URL, m.avatar_url),
      unproxied_avatar_url: m.avatar_url,
    })),
  });
});

// Update team
app.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const member = await getMember(c.env.DB, id, user.id);
  if (!member) return c.json({ error: "Not found" }, 404);
  if (!hasRole(member.role, "admin"))
    return c.json({ error: "Forbidden" }, 403);

  const body = await c.req.json<{
    name?: string;
    description?: string;
    avatar_url?: string;
    profile_is_public?: boolean;
    profile_show_description?: boolean | null;
    profile_show_avatar?: boolean | null;
    profile_show_owner?: boolean | null;
    profile_show_member_count?: boolean | null;
    profile_show_apps?: boolean | null;
    profile_show_domains?: boolean | null;
    profile_show_members?: boolean | null;
  }>();

  if (body.avatar_url) {
    const imgErr = await validateImageUrl(body.avatar_url);
    if (imgErr) return c.json({ error: `avatar_url: ${imgErr}` }, 400);
  }

  const team = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ?")
    .bind(id)
    .first<TeamRow>();
  if (!team) return c.json({ error: "Not found" }, 404);

  const updates: string[] = [
    "name = ?",
    "description = ?",
    "avatar_url = ?",
    "updated_at = ?",
  ];
  const values: unknown[] = [
    body.name?.trim() ?? team.name,
    body.description ?? team.description,
    body.avatar_url !== undefined ? body.avatar_url : team.avatar_url,
    Math.floor(Date.now() / 1000),
  ];

  if (body.profile_is_public !== undefined) {
    updates.push("profile_is_public = ?");
    values.push(body.profile_is_public ? 1 : 0);
  }
  for (const field of [
    "profile_show_description",
    "profile_show_avatar",
    "profile_show_owner",
    "profile_show_member_count",
    "profile_show_apps",
    "profile_show_domains",
    "profile_show_members",
  ] as const) {
    const v = body[field];
    if (v !== undefined) {
      updates.push(`${field} = ?`);
      values.push(v === null ? null : v ? 1 : 0);
    }
  }

  values.push(id);
  await c.env.DB.prepare(`UPDATE teams SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  // Mirror display fields to the team-user row so admin/profile views
  // stay in sync. No-op for deployments that haven't run the migration.
  if (body.name !== undefined || body.avatar_url !== undefined) {
    await c.env.DB.prepare(
      "UPDATE users SET display_name = ?, avatar_url = ?, updated_at = ? WHERE id = ? AND kind = 'team'",
    )
      .bind(
        body.name?.trim() ?? team.name,
        body.avatar_url !== undefined ? body.avatar_url : team.avatar_url,
        Math.floor(Date.now() / 1000),
        id,
      )
      .run();
  }

  const updated = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ?")
    .bind(id)
    .first<TeamRow>();
  return c.json({ team: { ...updated!, my_role: member.role } });
});

// Delete team (owner only)
app.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const member = await getMember(c.env.DB, id, user.id);
  if (!member) return c.json({ error: "Not found" }, 404);
  if (!hasRole(member.role, "owner"))
    return c.json({ error: "Only the team owner can delete the team" }, 403);

  await dissolveTeam(c.env.DB, id, user.id);

  return c.json({ message: "Team deleted" });
});

// ─── Members ─────────────────────────────────────────────────────────────────

// Add member by username
app.post("/:id/members", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const member = await getMember(c.env.DB, id, user.id);
  if (!member) return c.json({ error: "Not found" }, 404);
  if (!hasRole(member.role, "admin"))
    return c.json({ error: "Forbidden" }, 403);

  const body = await c.req.json<{ username: string; role?: string }>();
  let role: string = "member";
  if (body.role === "admin") role = "admin";
  if (body.role === "co-owner" && member.role === "owner") role = "co-owner";

  const target = await c.env.DB.prepare(
    "SELECT id FROM users WHERE username = ? AND kind = 'user'",
  )
    .bind(body.username)
    .first<{ id: string }>();
  if (!target) return c.json({ error: "User not found" }, 404);

  const existing = await getMember(c.env.DB, id, target.id);
  if (existing) return c.json({ error: "Already a member" }, 409);

  await c.env.DB.prepare(
    "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)",
  )
    .bind(id, target.id, role, Math.floor(Date.now() / 1000))
    .run();

  // Notify the added user
  const teamRow = await c.env.DB.prepare("SELECT name FROM teams WHERE id = ?")
    .bind(id)
    .first<{ name: string }>();
  if (teamRow) {
    c.executionCtx.waitUntil(
      deliverUserEmailNotifications(
        c.env,
        target.id,
        "team.member_added",
        {
          team_name: teamRow.name,
          role,
          ...notificationActorMetaFromHeaders(c.req.raw.headers),
        },
        c.env.APP_URL,
      ).catch(() => {}),
    );
  }

  return c.json({ message: "Member added" }, 201);
});

app.patch("/:id/members/:userId", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const targetUserId = c.req.param("userId");

  const member = await getMember(c.env.DB, id, user.id);
  if (!member) return c.json({ error: "Not found" }, 404);
  if (!hasRole(member.role, "co-owner"))
    return c.json({ error: "Only owners and co-owners can change roles" }, 403);
  if (targetUserId === user.id)
    return c.json({ error: "Cannot change your own role" }, 400);

  const body = await c.req.json<{ role: string }>();
  if (!["co-owner", "admin", "member"].includes(body.role))
    return c.json({ error: "Role must be co-owner, admin, or member" }, 400);

  const target = await getMember(c.env.DB, id, targetUserId);
  if (!target) return c.json({ error: "Member not found" }, 404);
  if (target.role === "owner")
    return c.json({ error: "Cannot change owner role" }, 403);
  // Co-owners cannot change other co-owners' roles
  if (target.role === "co-owner" && member.role !== "owner")
    return c.json({ error: "Only the owner can change co-owner roles" }, 403);
  // Only owners can assign co-owner role
  if (body.role === "co-owner" && member.role !== "owner")
    return c.json({ error: "Only the owner can assign co-owner role" }, 403);

  await c.env.DB.prepare(
    "UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?",
  )
    .bind(body.role, id, targetUserId)
    .run();

  return c.json({ message: "Role updated" });
});

// Remove member (owner/admin; cannot remove an owner)
app.delete("/:id/members/:userId", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const targetUserId = c.req.param("userId");

  const member = await getMember(c.env.DB, id, user.id);
  if (!member) return c.json({ error: "Not found" }, 404);

  // Allow leaving yourself (any role), otherwise need admin+
  const isSelf = targetUserId === user.id;
  if (!isSelf && !hasRole(member.role, "admin"))
    return c.json({ error: "Forbidden" }, 403);

  const target = await getMember(c.env.DB, id, targetUserId);
  if (!target) return c.json({ error: "Member not found" }, 404);

  if (target.role === "owner" && !isSelf)
    return c.json({ error: "Cannot remove the team owner" }, 403);
  // Only owner can remove co-owners
  if (target.role === "co-owner" && !isSelf && member.role !== "owner")
    return c.json({ error: "Only the owner can remove co-owners" }, 403);

  if (target.role === "owner" && isSelf) {
    // Leaving as owner: only allowed if no other members
    const { results } = await c.env.DB.prepare(
      "SELECT user_id FROM team_members WHERE team_id = ?",
    )
      .bind(id)
      .all<{ user_id: string }>();
    if (results.length > 1)
      return c.json(
        { error: "Transfer ownership before leaving the team" },
        400,
      );
    // Last member — delete the team
    await dissolveTeam(c.env.DB, id, user.id);
    return c.json({ message: "Team deleted" });
  }

  await c.env.DB.prepare(
    "DELETE FROM team_members WHERE team_id = ? AND user_id = ?",
  )
    .bind(id, targetUserId)
    .run();

  // Notify the removed user (only if it wasn't a self-leave)
  if (!isSelf) {
    const teamRow = await c.env.DB.prepare(
      "SELECT name FROM teams WHERE id = ?",
    )
      .bind(id)
      .first<{ name: string }>();
    if (teamRow) {
      c.executionCtx.waitUntil(
        deliverUserEmailNotifications(
          c.env,
          targetUserId,
          "team.member_removed",
          {
            team_name: teamRow.name,
            ...notificationActorMetaFromHeaders(c.req.raw.headers),
          },
          c.env.APP_URL,
        ).catch(() => {}),
      );
    }
  }

  return c.json({ message: "Member removed" });
});

// Transfer ownership to another member (owner only)
app.post("/:id/transfer-ownership", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const member = await getMember(c.env.DB, id, user.id);
  if (!member) return c.json({ error: "Not found" }, 404);
  if (!hasRole(member.role, "owner"))
    return c.json({ error: "Only the owner can transfer ownership" }, 403);

  const body = await c.req.json<{ user_id: string }>();
  if (body.user_id === user.id)
    return c.json({ error: "Already the owner" }, 400);

  const target = await getMember(c.env.DB, id, body.user_id);
  if (!target) return c.json({ error: "Target is not a team member" }, 404);

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE team_members SET role = 'owner' WHERE team_id = ? AND user_id = ?",
    ).bind(id, body.user_id),
    c.env.DB.prepare(
      "UPDATE team_members SET role = 'co-owner' WHERE team_id = ? AND user_id = ?",
    ).bind(id, user.id),
    c.env.DB.prepare("UPDATE teams SET updated_at = ? WHERE id = ?").bind(
      now,
      id,
    ),
  ]);

  return c.json({ message: "Ownership transferred" });
});

// ─── Invites ──────────────────────────────────────────────────────────────────

// List active invites for a team
app.get("/:id/invites", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const member = await getMember(c.env.DB, id, user.id);
  if (!member) return c.json({ error: "Not found" }, 404);
  if (!hasRole(member.role, "admin"))
    return c.json({ error: "Forbidden" }, 403);

  const now = Math.floor(Date.now() / 1000);
  const { results } = await c.env.DB.prepare(
    `SELECT i.*, u.username as creator_username
     FROM team_invites i JOIN users u ON u.id = i.created_by
     WHERE i.team_id = ? AND i.expires_at > ?
     ORDER BY i.created_at DESC`,
  )
    .bind(id, now)
    .all<InviteRow & { creator_username: string }>();

  return c.json({ invites: results });
});

// Create invite (shareable link or email)
app.post("/:id/invites", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const member = await getMember(c.env.DB, id, user.id);
  if (!member) return c.json({ error: "Not found" }, 404);
  if (!hasRole(member.role, "admin"))
    return c.json({ error: "Forbidden" }, 403);

  const body = await c.req.json<{
    role?: string;
    max_uses?: number;
    expires_in_hours?: number;
    email?: string;
  }>();

  let role: string = "member";
  if (body.role === "admin") role = "admin";
  if (body.role === "co-owner" && hasRole(member.role, "owner"))
    role = "co-owner";
  const maxUses = body.max_uses ?? 0;
  const ttlHours = Math.min(body.expires_in_hours ?? 72, 720); // max 30 days
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + ttlHours * 3600;
  const token = randomBase64url(24);

  await c.env.DB.prepare(
    `INSERT INTO team_invites (token, team_id, role, created_by, email, max_uses, uses, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  )
    .bind(token, id, role, user.id, body.email ?? null, maxUses, expiresAt, now)
    .run();

  const inviteLink = `${c.env.APP_URL}/teams/join/${token}`;

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
            <p style="color:#888;font-size:12px">This link expires in ${ttlHours} hours.</p>
          </div>`,
          text: `${user.display_name} invited you to join a team. Accept: ${inviteLink}`,
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
      ).catch(() => {
        /* non-fatal */
      });
    }
  }

  return c.json({ token, link: inviteLink, role, expires_at: expiresAt }, 201);
});

// Revoke an invite
app.delete("/:id/invites/:token", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const token = c.req.param("token");

  const member = await getMember(c.env.DB, id, user.id);
  if (!member) return c.json({ error: "Not found" }, 404);
  if (!hasRole(member.role, "admin"))
    return c.json({ error: "Forbidden" }, 403);

  await c.env.DB.prepare(
    "DELETE FROM team_invites WHERE token = ? AND team_id = ?",
  )
    .bind(token, id)
    .run();

  return c.json({ message: "Invite revoked" });
});

// ─── Team domains ─────────────────────────────────────────────────────────────

const DOMAIN_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

// List team domains
app.get(":id/domains", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const m = await getMember(c.env.DB, id, user.id);
  if (!m) return c.json({ error: "Not a team member" }, 403);

  const rows = await c.env.DB.prepare(
    "SELECT * FROM domains WHERE team_id = ? ORDER BY created_at DESC",
  )
    .bind(id)
    .all<DomainRow>();
  return c.json({ domains: rows.results });
});

// Add team domain
app.post(":id/domains", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const m = await getMember(c.env.DB, id, user.id);
  if (!m) return c.json({ error: "Not a team member" }, 403);
  if (!hasRole(m.role, "admin")) return c.json({ error: "Forbidden" }, 403);

  const body = await c.req.json<{ domain: string }>();
  if (!body.domain) return c.json({ error: "domain is required" }, 400);
  if (!DOMAIN_REGEX.test(body.domain))
    return c.json({ error: "Invalid domain format" }, 400);

  const domain = body.domain.toLowerCase().trim();

  const existing = await c.env.DB.prepare(
    "SELECT id FROM domains WHERE team_id = ? AND domain = ?",
  )
    .bind(id, domain)
    .first();
  if (existing) return c.json({ error: "Domain already added" }, 409);

  const verificationToken = randomBase64url(24);
  const domainId = randomId();
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    "INSERT INTO domains (id, user_id, created_by, team_id, domain, verification_token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(domainId, user.id, user.id, id, domain, verificationToken, now)
    .run();

  const instructions = methodInstructions(domain, verificationToken);

  // Auto-verify if the team already owns a verified parent domain
  const parent = await verifiedTeamParentDomain(c.env.DB, id, domain);
  if (parent) {
    const reverifyDays = await getConfigValue(c.env.DB, "domain_reverify_days");
    const nextReverify = now + reverifyDays * 24 * 60 * 60;
    await c.env.DB.prepare(
      "UPDATE domains SET verified = 1, verified_at = ?, next_reverify_at = ? WHERE id = ?",
    )
      .bind(now, nextReverify, domainId)
      .run();
    return c.json(
      {
        id: domainId,
        domain,
        verification_token: verificationToken,
        ...instructions,
        verified: true,
        verified_by_parent: parent,
      },
      201,
    );
  }

  return c.json(
    {
      id: domainId,
      domain,
      verification_token: verificationToken,
      ...instructions,
      verified: false,
    },
    201,
  );
});

// Verify team domain. Body: { method?: "dns-txt" | "http-file" | "html-meta" }
// If method is omitted, every method is tried until one succeeds.
app.post(":id/domains/:domainId/verify", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const domainId = c.req.param("domainId");
  const m = await getMember(c.env.DB, id, user.id);
  if (!m) return c.json({ error: "Not a team member" }, 403);
  if (!hasRole(m.role, "admin")) return c.json({ error: "Forbidden" }, 403);

  const row = await c.env.DB.prepare(
    "SELECT * FROM domains WHERE id = ? AND team_id = ?",
  )
    .bind(domainId, id)
    .first<DomainRow>();
  if (!row) return c.json({ error: "Domain not found" }, 404);

  let requestedMethod: VerificationMethod | null = null;
  try {
    const body = (await c.req
      .json<{ method?: unknown }>()
      .catch(() => ({}))) as {
      method?: unknown;
    };
    if (body.method !== undefined) {
      if (!isVerificationMethod(body.method))
        return c.json({ error: "Invalid verification method" }, 400);
      requestedMethod = body.method;
    }
  } catch {
    // empty body — treat as auto
  }

  const reverifyDays = await getConfigValue(c.env.DB, "domain_reverify_days");
  const now = Math.floor(Date.now() / 1000);
  const nextReverify = now + reverifyDays * 24 * 60 * 60;

  const parent = await verifiedTeamParentDomain(c.env.DB, id, row.domain);
  if (parent) {
    await c.env.DB.prepare(
      "UPDATE domains SET verified = 1, verified_at = ?, next_reverify_at = ?, verification_method = NULL WHERE id = ?",
    )
      .bind(now, nextReverify, domainId)
      .run();
    return c.json({
      verified: true,
      next_reverify_at: nextReverify,
      verified_by_parent: parent,
    });
  }

  const succeededMethod: VerificationMethod | null = requestedMethod
    ? (await checkMethod(requestedMethod, row.domain, row.verification_token))
      ? requestedMethod
      : null
    : await tryAnyMethod(row.domain, row.verification_token);

  if (succeededMethod) {
    await c.env.DB.prepare(
      "UPDATE domains SET verified = 1, verified_at = ?, next_reverify_at = ?, verification_method = ? WHERE id = ?",
    )
      .bind(now, nextReverify, succeededMethod, domainId)
      .run();
    return c.json({
      verified: true,
      next_reverify_at: nextReverify,
      verification_method: succeededMethod,
    });
  }

  const instructions = methodInstructions(row.domain, row.verification_token);
  return c.json({
    verified: false,
    attempted_method: requestedMethod,
    instructions,
  });
});

// Delete team domain
app.delete(":id/domains/:domainId", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const domainId = c.req.param("domainId");
  const m = await getMember(c.env.DB, id, user.id);
  if (!m) return c.json({ error: "Not a team member" }, 403);
  if (!hasRole(m.role, "admin")) return c.json({ error: "Forbidden" }, 403);

  const row = await c.env.DB.prepare(
    "SELECT id FROM domains WHERE id = ? AND team_id = ?",
  )
    .bind(domainId, id)
    .first();
  if (!row) return c.json({ error: "Domain not found" }, 404);

  await c.env.DB.prepare("DELETE FROM domains WHERE id = ?")
    .bind(domainId)
    .run();
  return c.json({ message: "Domain deleted" });
});

// Return team domain to its creator's personal domains
app.post(":id/domains/:domainId/to-personal", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const domainId = c.req.param("domainId");
  const m = await getMember(c.env.DB, id, user.id);
  if (!m) return c.json({ error: "Not a team member" }, 403);
  if (!hasRole(m.role, "admin")) return c.json({ error: "Forbidden" }, 403);

  const row = await c.env.DB.prepare(
    "SELECT * FROM domains WHERE id = ? AND team_id = ?",
  )
    .bind(domainId, id)
    .first<import("../types").DomainRow>();
  if (!row) return c.json({ error: "Domain not found" }, 404);

  // Check if the creator already has this domain personally
  const conflict = await c.env.DB.prepare(
    "SELECT id FROM domains WHERE user_id = ? AND team_id IS NULL AND domain = ?",
  )
    .bind(row.user_id, row.domain)
    .first();
  if (conflict)
    return c.json(
      { error: "Domain creator already owns this domain personally" },
      409,
    );

  await c.env.DB.prepare("UPDATE domains SET team_id = NULL WHERE id = ?")
    .bind(domainId)
    .run();

  return c.json({ message: "Domain returned to personal ownership" });
});

// Share team domain to another team (copy — keeps source, creates new row in target)
app.post(":id/domains/:domainId/share-to-team", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const domainId = c.req.param("domainId");
  const m = await getMember(c.env.DB, id, user.id);
  if (!m) return c.json({ error: "Not a team member" }, 403);
  if (!hasRole(m.role, "admin")) return c.json({ error: "Forbidden" }, 403);

  const row = await c.env.DB.prepare(
    "SELECT * FROM domains WHERE id = ? AND team_id = ?",
  )
    .bind(domainId, id)
    .first<DomainRow>();
  if (!row) return c.json({ error: "Domain not found" }, 404);

  const body = await c.req.json<{ team_id: string }>();
  if (!body.team_id) return c.json({ error: "team_id is required" }, 400);
  if (body.team_id === id)
    return c.json({ error: "Cannot share to the same team" }, 400);

  // Requester must be admin+ in the target team
  const targetMember = await getMember(c.env.DB, body.team_id, user.id);
  if (!targetMember || !hasRole(targetMember.role, "admin"))
    return c.json(
      { error: "Forbidden: must be admin or owner of target team" },
      403,
    );

  // Target team must not already have this domain
  const conflict = await c.env.DB.prepare(
    "SELECT id FROM domains WHERE team_id = ? AND domain = ?",
  )
    .bind(body.team_id, row.domain)
    .first();
  if (conflict)
    return c.json({ error: "Target team already has this domain" }, 409);

  const newId = randomId();
  const newToken = randomBase64url(24);
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    `INSERT INTO domains
      (id, user_id, created_by, team_id, domain, verification_token,
       verified, verified_at, next_reverify_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      newId,
      user.id,
      user.id,
      body.team_id,
      row.domain,
      newToken,
      row.verified,
      row.verified_at ?? null,
      row.next_reverify_at ?? null,
      now,
    )
    .run();

  return c.json({ id: newId, domain: row.domain, verified: !!row.verified });
});

// Share team domain to personal (copy — keeps team source, creates personal row for requester)
app.post(":id/domains/:domainId/share-to-personal", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const domainId = c.req.param("domainId");
  const m = await getMember(c.env.DB, id, user.id);
  if (!m) return c.json({ error: "Not a team member" }, 403);
  if (!hasRole(m.role, "admin")) return c.json({ error: "Forbidden" }, 403);

  const row = await c.env.DB.prepare(
    "SELECT * FROM domains WHERE id = ? AND team_id = ?",
  )
    .bind(domainId, id)
    .first<DomainRow>();
  if (!row) return c.json({ error: "Domain not found" }, 404);

  // User must not already own this domain personally
  const conflict = await c.env.DB.prepare(
    "SELECT id FROM domains WHERE user_id = ? AND team_id IS NULL AND domain = ?",
  )
    .bind(user.id, row.domain)
    .first();
  if (conflict)
    return c.json({ error: "You already own this domain personally" }, 409);

  const newId = randomId();
  const newToken = randomBase64url(24);
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    `INSERT INTO domains
      (id, user_id, created_by, team_id, domain, verification_token,
       verified, verified_at, next_reverify_at, created_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      newId,
      user.id,
      user.id,
      row.domain,
      newToken,
      row.verified,
      row.verified_at ?? null,
      row.next_reverify_at ?? null,
      now,
    )
    .run();

  return c.json({ id: newId, domain: row.domain, verified: !!row.verified });
});

async function verifiedTeamParentDomain(
  db: D1Database,
  teamId: string,
  domain: string,
): Promise<string | null> {
  const parts = domain.split(".");
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join(".");
    const row = await db
      .prepare(
        "SELECT domain FROM domains WHERE team_id = ? AND domain = ? AND verified = 1",
      )
      .bind(teamId, parent)
      .first<{ domain: string }>();
    if (row) return row.domain;
  }
  return null;
}

// ─── Team apps ────────────────────────────────────────────────────────────────

// List team apps
app.get("/:id/apps", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const member = await getMember(c.env.DB, id, user.id);
  if (!member) return c.json({ error: "Not found" }, 404);

  const rows = await c.env.DB.prepare(
    "SELECT * FROM oauth_apps WHERE team_id = ? ORDER BY created_at DESC",
  )
    .bind(id)
    .all<OAuthAppRow>();

  const apps = await Promise.all(
    rows.results.map(async (row) => {
      const isVerified = await computeIsVerified(
        c.env.DB,
        row.owner_id,
        row.website_url,
        row.redirect_uris,
      );
      return safeApp(c.env.APP_URL, row, isVerified);
    }),
  );

  return c.json({ apps });
});

// Create app for team
app.post("/:id/apps", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  if (user.role !== "admin") {
    const disabled = await getConfigValue(c.env.DB, "disable_user_create_app");
    if (disabled) return c.json({ error: "App creation is disabled" }, 403);
  }

  const member = await getMember(c.env.DB, id, user.id);
  if (!member) return c.json({ error: "Not found" }, 404);
  if (!hasRole(member.role, "admin"))
    return c.json({ error: "Forbidden" }, 403);

  const body = await c.req.json<{
    name: string;
    description?: string;
    website_url?: string;
    redirect_uris: string[];
    allowed_scopes?: string[];
    is_public?: boolean;
  }>();

  if (!body.name) return c.json({ error: "name is required" }, 400);
  if (!body.redirect_uris?.length)
    return c.json({ error: "At least one redirect_uri required" }, 400);

  for (const uri of body.redirect_uris) {
    try {
      new URL(uri);
    } catch {
      return c.json({ error: `Invalid redirect_uri: ${uri}` }, 400);
    }
  }

  const allowedScopes = (
    body.allowed_scopes ?? ["openid", "profile", "email"]
  ).filter((s) =>
    ["openid", "profile", "email", "apps:read", "offline_access"].includes(s),
  );

  // owner_id points at the team-user row (id == teams.id) when teams have
  // been migrated to the unified user model. Falls back to the creator if
  // the migration hasn't run yet so the FK stays valid.
  const teamUser = await c.env.DB.prepare(
    "SELECT id FROM users WHERE id = ? AND kind = 'team'",
  )
    .bind(id)
    .first<{ id: string }>();
  const appOwnerId = teamUser?.id ?? user.id;

  const appId = randomId();
  const clientId = `prism_${randomBase64url(16)}`;
  const clientSecret = randomBase64url(32);
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    `INSERT INTO oauth_apps
       (id, owner_id, team_id, name, description, website_url, client_id, client_secret,
        redirect_uris, allowed_scopes, is_public, is_active, is_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
  )
    .bind(
      appId,
      appOwnerId,
      id,
      body.name,
      body.description ?? "",
      body.website_url ?? null,
      clientId,
      clientSecret,
      JSON.stringify(body.redirect_uris),
      JSON.stringify(allowedScopes),
      body.is_public ? 1 : 0,
      now,
      now,
    )
    .run();

  const row = await c.env.DB.prepare("SELECT * FROM oauth_apps WHERE id = ?")
    .bind(appId)
    .first<OAuthAppRow>();
  const isVerified = await computeIsVerified(
    c.env.DB,
    user.id,
    body.website_url ?? null,
    JSON.stringify(body.redirect_uris),
  );
  return c.json({ app: fullApp(c.env.APP_URL, row!, isVerified) }, 201);
});

// Transfer a personal app into this team
app.post("/:id/apps/transfer", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const member = await getMember(c.env.DB, id, user.id);
  if (!member) return c.json({ error: "Not found" }, 404);
  if (!hasRole(member.role, "admin"))
    return c.json({ error: "Forbidden" }, 403);

  const body = await c.req.json<{ app_id: string }>();
  const appRow = await c.env.DB.prepare("SELECT * FROM oauth_apps WHERE id = ?")
    .bind(body.app_id)
    .first<OAuthAppRow>();

  if (!appRow) return c.json({ error: "App not found" }, 404);
  if (appRow.team_id)
    return c.json({ error: "App is already owned by a team" }, 409);
  if (appRow.owner_id !== user.id)
    return c.json({ error: "You can only transfer apps you created" }, 403);

  // Re-point owner_id to the team-user row (id == teams.id, kind='team')
  // so the app appears owned by the team everywhere owner_id is joined to
  // users (admin panel, profile pages, OAuth APIs).
  // If the deployment hasn't run the teams-as-users migration yet the
  // team-user row may not exist; fall back to the legacy behaviour
  // (leave owner_id alone, set team_id only) so we don't break the FK.
  const teamUser = await c.env.DB.prepare(
    "SELECT id FROM users WHERE id = ? AND kind = 'team'",
  )
    .bind(id)
    .first<{ id: string }>();

  const now = Math.floor(Date.now() / 1000);
  if (teamUser) {
    await c.env.DB.prepare(
      "UPDATE oauth_apps SET team_id = ?, owner_id = ?, updated_at = ? WHERE id = ?",
    )
      .bind(id, id, now, body.app_id)
      .run();
  } else {
    await c.env.DB.prepare(
      "UPDATE oauth_apps SET team_id = ?, updated_at = ? WHERE id = ?",
    )
      .bind(id, now, body.app_id)
      .run();
  }

  return c.json({ message: "App transferred to team" });
});

// Remove app from team (back to personal — assigned to the requester)
app.delete("/:id/apps/:appId/transfer", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const appId = c.req.param("appId");

  const member = await getMember(c.env.DB, id, user.id);
  if (!member) return c.json({ error: "Not found" }, 404);
  if (!hasRole(member.role, "admin"))
    return c.json({ error: "Forbidden" }, 403);

  const appRow = await c.env.DB.prepare(
    "SELECT * FROM oauth_apps WHERE id = ? AND team_id = ?",
  )
    .bind(appId, id)
    .first<OAuthAppRow>();
  if (!appRow) return c.json({ error: "App not found in this team" }, 404);

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    "UPDATE oauth_apps SET team_id = NULL, owner_id = ?, updated_at = ? WHERE id = ?",
  )
    .bind(user.id, now, appId)
    .run();

  return c.json({ message: "App moved back to personal" });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeApp(baseUrl: string, row: OAuthAppRow, isVerified: boolean) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon_url: proxyImageUrl(baseUrl, row.icon_url),
    unproxied_icon_url: row.icon_url,
    website_url: row.website_url,
    client_id: row.client_id,
    redirect_uris: JSON.parse(row.redirect_uris) as string[],
    allowed_scopes: JSON.parse(row.allowed_scopes) as string[],
    is_public: row.is_public === 1,
    is_active: row.is_active === 1,
    is_verified: isVerified,
    is_official: row.is_official === 1,
    is_first_party: row.is_first_party === 1,
    team_id: row.team_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function fullApp(baseUrl: string, row: OAuthAppRow, isVerified: boolean) {
  return {
    ...safeApp(baseUrl, row, isVerified),
    client_secret: row.client_secret,
  };
}

export default app;
