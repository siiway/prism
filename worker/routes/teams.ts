// Team management — collaborative app ownership

import { Hono } from "hono";
import { randomId, randomBase64url } from "../lib/crypto";
import { hashSecret, hashLookupCandidate } from "../lib/secretCrypto";
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
import {
  proxyImageUrl,
  sweepOrphanedImageProxyMappings,
} from "../lib/proxyImage";
import { validateRedirectUriForRegistration } from "../lib/redirectUri";
import type { DomainRow } from "../types";
import { getConfig } from "../lib/config";
import { sendEmail } from "../lib/email";
import {
  deliverUserEmailNotifications,
  notificationActorMetaFromHeaders,
} from "../lib/notifications";
import type { OAuthAppRow, TeamMemberRow, TeamRow, Variables } from "../types";
import {
  getEffectiveTeamRequirements,
  getSiteRequirementFloor,
  getUserSecurityState,
  mergeWithSiteFloor,
  unmetRequirements,
} from "../lib/teamRequirements";
import { recordAudit, auditRequestMeta } from "../lib/audit";
import { isTeamLocked } from "../lib/lockdown";
import {
  MAX_GROUPS_PER_MEMBER,
  MAX_GROUPS_PER_TEAM,
  MAX_GROUP_DESCRIPTION_LENGTH,
  MAX_GROUP_NAME_LENGTH,
  canAssignGroup,
  canManageGroups,
  effectiveCapabilities,
  getGroupsForTeamMembers,
  getMemberGroups,
  getSiteRolePermissions,
  listTeamGroups,
  parseRolePermissions,
  sanitizeRolePermissions,
  serializeTeamGroup,
  validateGroupColor,
  validateGroupSlug,
} from "../lib/teamGroups";
import type { TeamGroupRow, TeamRolePermissions } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

// Record a team-scope audit event (Transparent Team Control).
function auditTeam(
  c: import("hono").Context<AppEnv>,
  teamId: string,
  action: string,
  opts: {
    resourceType?: string;
    resourceId?: string | null;
    resourceName?: string | null;
    metadata?: unknown;
  } = {},
): void {
  const actor = c.get("user");
  const meta = auditRequestMeta(c);
  void recordAudit(c.env, c.executionCtx, {
    scope: "team",
    scopeId: teamId,
    action,
    actorId: actor.id,
    actorName: actor.username,
    resourceType: opts.resourceType ?? "team",
    resourceId: opts.resourceId ?? teamId,
    resourceName: opts.resourceName ?? null,
    ip: meta.ip,
    userAgent: meta.userAgent,
    metadata: opts.metadata ?? {},
  });
}

// ─── Serialization ────────────────────────────────────────────────────────────

/** SQLite stores booleans as 0/1 (and nullable preferences as 0/1/NULL).
 *  The client `Team` type expects real booleans, so normalize every
 *  boolean-ish column before sending a team row over the wire. Keeping this
 *  in one place avoids `0` leaking into the UI (e.g. `value && <JSX/>`). */
function serializeTeamRow(team: TeamRow) {
  const toBool = (v: number): boolean => v === 1;
  const toNullableBool = (v: number | null): boolean | null =>
    v === null ? null : v === 1;
  return {
    ...team,
    profile_is_public: toBool(team.profile_is_public),
    profile_show_description: toNullableBool(team.profile_show_description),
    profile_show_avatar: toNullableBool(team.profile_show_avatar),
    profile_show_owner: toNullableBool(team.profile_show_owner),
    profile_show_member_count: toNullableBool(team.profile_show_member_count),
    profile_show_apps: toNullableBool(team.profile_show_apps),
    profile_show_domains: toNullableBool(team.profile_show_domains),
    profile_show_members: toNullableBool(team.profile_show_members),
    profile_show_sub_teams: toNullableBool(team.profile_show_sub_teams),
    require_2fa: toBool(team.require_2fa),
    require_verified_email: toBool(team.require_verified_email),
    enable_groups: toBool(team.enable_groups),
    // Send the parsed overrides, not the raw blob — the client shouldn't
    // have to know the storage format to render the settings toggles.
    role_permissions: parseRolePermissions(team.role_permissions),
  };
}

// ─── Role helpers ─────────────────────────────────────────────────────────────

export const ROLE_RANK: Record<string, number> = {
  owner: 4,
  "co-owner": 3,
  admin: 2,
  member: 1,
};

export function hasRole(
  memberRole: string,
  required: "member" | "admin" | "co-owner" | "owner",
): boolean {
  return (ROLE_RANK[memberRole] ?? 0) >= ROLE_RANK[required];
}

export async function getMember(
  db: D1Database,
  teamId: string,
  userId: string,
): Promise<TeamMemberRow | null> {
  return db
    .prepare("SELECT * FROM team_members WHERE team_id = ? AND user_id = ?")
    .bind(teamId, userId)
    .first<TeamMemberRow>();
}

// ─── Sub-team helpers ─────────────────────────────────────────────────────────

/** Absolute upper bound on nesting depth — guards the ancestor walk against
 *  data corruption even when the site config is set higher. The admin
 *  config endpoint also clamps `max_team_depth` to 20 to keep recursive
 *  helpers cheap. */
const ANCESTOR_WALK_LIMIT = 64;

/** Read the operator-configured max nesting depth from site_config, falling
 *  back to the default in DEFAULT_CONFIG (5). Walked once per write; reads
 *  use the cap on the same getConfig fetch the caller already had. */
export async function getMaxTeamDepth(db: D1Database): Promise<number> {
  return getConfigValue(db, "max_team_depth");
}

/** Walks from the given team up to the root. Returns [team, parent,
 *  grandparent, ...]. Hard-capped at ANCESTOR_WALK_LIMIT entries to defend
 *  against data corruption (a cycle that slipped past API validation). */
export async function getTeamAncestors(
  db: D1Database,
  teamId: string,
): Promise<TeamRow[]> {
  const out: TeamRow[] = [];
  const seen = new Set<string>();
  let currentId: string | null = teamId;
  while (currentId && out.length <= ANCESTOR_WALK_LIMIT) {
    if (seen.has(currentId)) break;
    seen.add(currentId);
    const row: TeamRow | null = await db
      .prepare("SELECT * FROM teams WHERE id = ?")
      .bind(currentId)
      .first<TeamRow>();
    if (!row) break;
    out.push(row);
    currentId = row.parent_team_id;
  }
  return out;
}

/** All team IDs in the subtree rooted at teamId, inclusive. Children-first
 *  order so callers can clean up descendants before parents. */
export async function getDescendantTeamIds(
  db: D1Database,
  teamId: string,
): Promise<string[]> {
  const order: string[] = [];
  const queue: string[] = [teamId];
  const visited = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    order.push(id);
    const { results } = await db
      .prepare("SELECT id FROM teams WHERE parent_team_id = ?")
      .bind(id)
      .all<{ id: string }>();
    for (const r of results) queue.push(r.id);
  }
  // Reverse to children-first.
  return order.reverse();
}

/** A user's effective role on a team: max(direct role, any inherited role
 *  from an ancestor team they're a member of). Returns null if the user has
 *  neither direct nor inherited membership.
 *
 *  Inherited from sub-team semantics (Inherited model): a member of team A
 *  with role R is treated as a member of every descendant of A with at
 *  least role R. Stacking with a direct membership picks the higher role.
 *
 *  Honors the `inherit_team_membership` site config — when disabled the
 *  function degenerates to a direct-only lookup (equivalent to {@link
 *  getMember} with an `{ inherited_from: null }` wrapper). */
export async function getEffectiveMember(
  db: D1Database,
  teamId: string,
  userId: string,
): Promise<{
  role: "owner" | "co-owner" | "admin" | "member";
  direct: TeamMemberRow | null;
  /** Team id this role was inherited from, or null when the highest role
   *  came from a direct membership on `teamId` itself. */
  inherited_from: string | null;
} | null> {
  const inherit = await getConfigValue(db, "inherit_team_membership");
  if (!inherit) {
    const direct = await getMember(db, teamId, userId);
    return direct ? { role: direct.role, direct, inherited_from: null } : null;
  }

  const ancestors = await getTeamAncestors(db, teamId);
  if (!ancestors.length) return null;

  let best: { row: TeamMemberRow; teamId: string } | null = null;
  let direct: TeamMemberRow | null = null;
  for (const t of ancestors) {
    const m = await getMember(db, t.id, userId);
    if (!m) continue;
    if (t.id === teamId) direct = m;
    if (!best || (ROLE_RANK[m.role] ?? 0) > (ROLE_RANK[best.row.role] ?? 0)) {
      best = { row: m, teamId: t.id };
    }
  }
  if (!best) return null;
  return {
    role: best.row.role,
    direct,
    inherited_from: best.teamId === teamId ? null : best.teamId,
  };
}

/** Returns true if moving `teamId` under `newParentId` would create a cycle
 *  or exceed the operator-configured max nesting depth for any team in the
 *  affected subtree. */
export async function isInvalidReparent(
  db: D1Database,
  teamId: string,
  newParentId: string | null,
): Promise<string | null> {
  if (!newParentId) return null;
  if (newParentId === teamId) return "A team cannot be its own parent";

  const maxDepth = await getMaxTeamDepth(db);
  const parentAncestors = await getTeamAncestors(db, newParentId);
  if (!parentAncestors.length) return "Parent team not found";
  if (parentAncestors.some((a) => a.id === teamId))
    return "Cannot move a team under one of its own descendants (cycle)";
  if (parentAncestors.length >= maxDepth)
    return `Team nesting limit (${maxDepth}) reached`;

  // Need to also bound the subtree depth: parent depth + subtree depth ≤ MAX
  const subtreeDepth = await maxSubtreeDepth(db, teamId);
  if (parentAncestors.length + subtreeDepth > maxDepth)
    return `Team nesting limit (${maxDepth}) would be exceeded`;
  return null;
}

/** All teams the user has effective access to. Each entry is the team row
 *  plus the highest effective role and an `inherited_from` ancestor id (null
 *  for direct memberships). Order is unspecified — callers should sort.
 *
 *  Subtree expansion respects the `inherit_team_membership` site config:
 *  when off, only direct memberships are returned. */
export async function listEffectiveTeamMemberships(
  db: D1Database,
  userId: string,
): Promise<
  Array<{
    team: TeamRow;
    role: "owner" | "co-owner" | "admin" | "member";
    joined_at: number;
    show_on_profile: number | null;
    inherited_from: string | null;
  }>
> {
  const { results: direct } = await db
    .prepare(
      `SELECT t.*, tm.role, tm.show_on_profile, tm.joined_at
       FROM teams t JOIN team_members tm ON tm.team_id = t.id
       WHERE tm.user_id = ?`,
    )
    .bind(userId)
    .all<
      TeamRow & {
        role: "owner" | "co-owner" | "admin" | "member";
        joined_at: number;
        show_on_profile: number | null;
      }
    >();

  const map = new Map<
    string,
    {
      team: TeamRow;
      role: "owner" | "co-owner" | "admin" | "member";
      joined_at: number;
      show_on_profile: number | null;
      inherited_from: string | null;
    }
  >();
  for (const r of direct) {
    const { role, show_on_profile, joined_at, ...team } = r;
    map.set(r.id, {
      team,
      role,
      joined_at,
      show_on_profile,
      inherited_from: null,
    });
  }
  const inherit = await getConfigValue(db, "inherit_team_membership");
  if (inherit) {
    for (const r of direct) {
      const subtree = await getDescendantTeamIds(db, r.id);
      for (const descId of subtree) {
        if (descId === r.id) continue;
        const existing = map.get(descId);
        if (existing && existing.inherited_from === null) continue;
        if (
          existing &&
          (ROLE_RANK[existing.role] ?? 0) >= (ROLE_RANK[r.role] ?? 0)
        )
          continue;
        const descRow = await db
          .prepare("SELECT * FROM teams WHERE id = ?")
          .bind(descId)
          .first<TeamRow>();
        if (!descRow) continue;
        map.set(descId, {
          team: descRow,
          role: r.role,
          joined_at: r.joined_at,
          show_on_profile: null,
          inherited_from: r.id,
        });
      }
    }
  }
  return Array.from(map.values());
}

/** Depth of the deepest descendant under `teamId` (0 = no children). */
async function maxSubtreeDepth(
  db: D1Database,
  teamId: string,
): Promise<number> {
  let deepest = 0;
  const queue: Array<{ id: string; depth: number }> = [
    { id: teamId, depth: 0 },
  ];
  const visited = new Set<string>();
  while (queue.length) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (depth > deepest) deepest = depth;
    if (depth > ANCESTOR_WALK_LIMIT) break;
    const { results } = await db
      .prepare("SELECT id FROM teams WHERE parent_team_id = ?")
      .bind(id)
      .all<{ id: string }>();
    for (const r of results) queue.push({ id: r.id, depth: depth + 1 });
  }
  return deepest;
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
 * Disband a team and all its sub-teams (cascade). For each team in the
 * subtree (deepest first) we reassign team-owned apps to a real-user
 * fallback so the rows survive the FK cascade that follows from removing
 * the team-user (oauth_apps.owner_id REFERENCES users(id) ON DELETE
 * CASCADE), then drop the team-user and team rows.
 *
 * Fallback choice: prefer the team's own owner, otherwise the parent
 * team's owner walking up the chain, otherwise the deleting user. This
 * keeps apps inside the same human-owned tree when possible.
 */
export async function dissolveTeam(
  db: D1Database,
  teamId: string,
  fallbackUserId: string,
): Promise<void> {
  const ids = await getDescendantTeamIds(db, teamId); // children-first
  const now = Math.floor(Date.now() / 1000);

  for (const id of ids) {
    const ownerRow = await db
      .prepare(
        "SELECT user_id FROM team_members WHERE team_id = ? AND role = 'owner' LIMIT 1",
      )
      .bind(id)
      .first<{ user_id: string }>();
    const reassignTo = ownerRow?.user_id ?? fallbackUserId;

    await db
      .prepare(
        "UPDATE oauth_apps SET team_id = NULL, owner_id = ?, updated_at = ? WHERE team_id = ?",
      )
      .bind(reassignTo, now, id)
      .run();

    // Drop the team-user row if it exists. CASCADE-safe now that no app
    // rows still point at it as owner.
    await db
      .prepare("DELETE FROM users WHERE id = ? AND kind = 'team'")
      .bind(id)
      .run();

    await db.prepare("DELETE FROM teams WHERE id = ?").bind(id).run();
  }
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

  const tokenLookup = await hashLookupCandidate(c.env, token);
  if (!tokenLookup)
    return c.json({ error: "Invite not found or expired" }, 404);
  const invite = await c.env.DB.prepare(
    "SELECT * FROM team_invites WHERE (token = ? OR token = ?) AND expires_at > ?",
  )
    .bind(token, tokenLookup, now)
    .first<InviteRow>();

  if (!invite) return c.json({ error: "Invite not found or expired" }, 404);
  if (invite.max_uses > 0 && invite.uses >= invite.max_uses)
    return c.json({ error: "Invite link has reached its usage limit" }, 410);

  const team = await c.env.DB.prepare(
    "SELECT id, name, description, avatar_url, require_2fa, require_verified_email FROM teams WHERE id = ?",
  )
    .bind(invite.team_id)
    .first<{
      id: string;
      name: string;
      description: string;
      avatar_url: string | null;
      require_2fa: number;
      require_verified_email: number;
    }>();
  if (!team) return c.json({ error: "Team not found" }, 404);

  const floor = await getSiteRequirementFloor(c.env.DB);
  const effective = mergeWithSiteFloor(team, floor);

  const sessionUser = c.get("user") ?? null;
  let alreadyMember = false;
  let unmet: ReturnType<typeof unmetRequirements> = [];
  if (sessionUser) {
    const existing = await getMember(c.env.DB, team.id, sessionUser.id);
    alreadyMember = !!existing;
    if (!alreadyMember) {
      const state = await getUserSecurityState(c.env.DB, sessionUser.id);
      unmet = unmetRequirements(effective, state);
    }
  }

  return c.json({
    team: {
      id: team.id,
      name: team.name,
      description: team.description,
      avatar_url: await proxyImageUrl(c.env.APP_URL, c.env.DB, team.avatar_url),
      unproxied_avatar_url: team.avatar_url,
    },
    role: invite.role,
    email: invite.email,
    expires_at: invite.expires_at,
    already_member: alreadyMember,
    requirements: {
      require_2fa: effective.require_2fa,
      require_verified_email: effective.require_verified_email,
      forced_by_site: effective.forced_by_site,
    },
    unmet_requirements: unmet,
    user: sessionUser,
  });
});

// POST /join/:token — accept invite (must be authenticated)
app.post("/join/:token", requireAuth, async (c) => {
  const user = c.get("user");
  const token = c.req.param("token");
  const now = Math.floor(Date.now() / 1000);

  const tokenLookup = await hashLookupCandidate(c.env, token);
  if (!tokenLookup)
    return c.json({ error: "Invite not found or expired" }, 404);
  const invite = await c.env.DB.prepare(
    "SELECT * FROM team_invites WHERE (token = ? OR token = ?) AND expires_at > ?",
  )
    .bind(token, tokenLookup, now)
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

  const teamReq = await getEffectiveTeamRequirements(c.env.DB, invite.team_id);
  if (teamReq) {
    const state = await getUserSecurityState(c.env.DB, user.id);
    const unmet = unmetRequirements(teamReq, state);
    if (unmet.length) {
      return c.json(
        {
          error: "You don't meet this team's join requirements",
          unmet_requirements: unmet,
        },
        403,
      );
    }
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)",
    ).bind(invite.team_id, user.id, invite.role, now),
    c.env.DB.prepare(
      "UPDATE team_invites SET uses = uses + 1 WHERE token = ?",
    ).bind(invite.token),
  ]);

  return c.json({ team_id: invite.team_id, message: "Joined team" });
});

// ─── All remaining routes require auth ────────────────────────────────────────

app.use("*", requireAuth);

// ─── Team CRUD ────────────────────────────────────────────────────────────────

// List teams the current user belongs to.
// Includes both direct memberships AND inherited memberships (member of an
// ancestor team). `inherited_from` carries the ancestor team's id when the
// listing entry came from inheritance only; null for direct memberships.
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

  // Expand each direct membership to its descendant subtree (inherited
  // visibility). Use a map keyed by team id so direct entries override
  // inherited ones, and the highest inherited role wins on overlap.
  const collected = new Map<
    string,
    {
      team: TeamRow;
      role: string;
      show_on_profile: number | null;
      inherited_from: string | null;
    }
  >();
  for (const row of rows.results) {
    collected.set(row.id, {
      team: row,
      role: row.role,
      show_on_profile: row.show_on_profile,
      inherited_from: null,
    });
  }
  for (const row of rows.results) {
    const subtree = await getDescendantTeamIds(c.env.DB, row.id);
    for (const descendantId of subtree) {
      if (descendantId === row.id) continue;
      const existing = collected.get(descendantId);
      if (existing && existing.inherited_from === null) continue; // direct wins
      if (
        existing &&
        (ROLE_RANK[existing.role] ?? 0) >= (ROLE_RANK[row.role] ?? 0)
      )
        continue;
      const descRow = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ?")
        .bind(descendantId)
        .first<TeamRow>();
      if (!descRow) continue;
      collected.set(descendantId, {
        team: descRow,
        role: row.role,
        show_on_profile: null,
        inherited_from: row.id,
      });
    }
  }

  return c.json({
    teams: await Promise.all(
      Array.from(collected.values()).map(async (entry) => ({
        ...serializeTeamRow(entry.team),
        role: entry.role,
        avatar_url: await proxyImageUrl(
          c.env.APP_URL,
          c.env.DB,
          entry.team.avatar_url,
        ),
        unproxied_avatar_url: entry.team.avatar_url,
        show_on_profile:
          entry.show_on_profile === null ? null : entry.show_on_profile === 1,
        inherited_from: entry.inherited_from,
      })),
    ),
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

// Create team (top-level if `parent_team_id` is omitted, otherwise a
// sub-team under the named parent).
app.post("/", async (c) => {
  const user = c.get("user");

  const body = await c.req.json<{
    name: string;
    description?: string;
    avatar_url?: string;
    parent_team_id?: string | null;
  }>();
  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);

  // Parent validation — sub-team creation requires admin+ on the parent.
  // Top-level creation respects the site-wide disable toggle.
  let parentId: string | null = null;
  if (body.parent_team_id) {
    const enabled = await getConfigValue(c.env.DB, "enable_sub_teams");
    if (!enabled)
      return c.json({ error: "Sub-teams are disabled on this instance" }, 403);
    const parentRow = await c.env.DB.prepare(
      "SELECT id FROM teams WHERE id = ?",
    )
      .bind(body.parent_team_id)
      .first<{ id: string }>();
    if (!parentRow) return c.json({ error: "Parent team not found" }, 404);
    const eff = await getEffectiveMember(
      c.env.DB,
      body.parent_team_id,
      user.id,
    );
    if (!eff || !hasRole(eff.role, "admin"))
      return c.json(
        { error: "Forbidden: must be admin+ of the parent team" },
        403,
      );
    const maxDepth = await getMaxTeamDepth(c.env.DB);
    const ancestors = await getTeamAncestors(c.env.DB, body.parent_team_id);
    if (ancestors.length >= maxDepth)
      return c.json({ error: `Team nesting limit (${maxDepth}) reached` }, 400);
    parentId = body.parent_team_id;
  } else if (user.role !== "admin") {
    const disabled = await getConfigValue(c.env.DB, "disable_user_create_team");
    if (disabled) return c.json({ error: "Team creation is disabled" }, 403);
  }

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
      "INSERT INTO teams (id, name, description, avatar_url, parent_team_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      id,
      body.name.trim(),
      body.description ?? "",
      body.avatar_url ?? null,
      parentId,
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

  auditTeam(c, id, "team.create", {
    resourceName: body.name.trim(),
    metadata: { parent_team_id: parentId },
  });

  return c.json({ team: { ...serializeTeamRow(team!), role: "owner" } }, 201);
});

// List immediate sub-teams of a parent team.
// Members of an ancestor team (inherited or direct) may list.
app.get("/:id/sub-teams", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const enabled = await getConfigValue(c.env.DB, "enable_sub_teams");
  if (!enabled)
    return c.json({ error: "Sub-teams are disabled on this instance" }, 403);

  const eff = await getEffectiveMember(c.env.DB, id, user.id);
  if (!eff) return c.json({ error: "Not found" }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT t.*, (
       SELECT COUNT(*) FROM team_members WHERE team_id = t.id
     ) AS member_count
     FROM teams t WHERE t.parent_team_id = ?
     ORDER BY t.created_at DESC`,
  )
    .bind(id)
    .all<TeamRow & { member_count: number }>();

  return c.json({
    sub_teams: await Promise.all(
      results.map(async (t) => ({
        ...t,
        avatar_url: await proxyImageUrl(c.env.APP_URL, c.env.DB, t.avatar_url),
        unproxied_avatar_url: t.avatar_url,
        // Effective role of caller in this sub-team (inherited from the
        // ancestor at minimum). Clients can use this to disable UI affordances
        // for non-admin viewers.
        my_role: eff.role,
        inherited_from: eff.inherited_from ?? id,
      })),
    ),
  });
});

// Create a sub-team under :id. Convenience alias for
// POST / with parent_team_id — body is the same as POST /.
app.post("/:id/sub-teams", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const enabled = await getConfigValue(c.env.DB, "enable_sub_teams");
  if (!enabled)
    return c.json({ error: "Sub-teams are disabled on this instance" }, 403);

  const body = await c.req.json<{
    name: string;
    description?: string;
    avatar_url?: string;
  }>();
  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);

  const parentRow = await c.env.DB.prepare("SELECT id FROM teams WHERE id = ?")
    .bind(id)
    .first<{ id: string }>();
  if (!parentRow) return c.json({ error: "Parent team not found" }, 404);
  const eff = await getEffectiveMember(c.env.DB, id, user.id);
  if (!eff || !hasRole(eff.role, "admin"))
    return c.json(
      { error: "Forbidden: must be admin+ of the parent team" },
      403,
    );
  const maxDepth = await getMaxTeamDepth(c.env.DB);
  const ancestors = await getTeamAncestors(c.env.DB, id);
  if (ancestors.length >= maxDepth)
    return c.json({ error: `Team nesting limit (${maxDepth}) reached` }, 400);

  if (body.avatar_url) {
    const imgErr = await validateImageUrl(body.avatar_url);
    if (imgErr) return c.json({ error: `avatar_url: ${imgErr}` }, 400);
  }

  const subId = randomId();
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO teams (id, name, description, avatar_url, parent_team_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      subId,
      body.name.trim(),
      body.description ?? "",
      body.avatar_url ?? null,
      id,
      now,
      now,
    ),
    c.env.DB.prepare(
      "INSERT INTO users (id, email, username, password_hash, display_name, avatar_url, role, kind, email_verified, is_active, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, 'user', 'team', 0, 1, ?, ?)",
    ).bind(
      subId,
      teamUserSyntheticEmail(subId),
      teamUserSyntheticUsername(subId),
      body.name.trim(),
      body.avatar_url ?? null,
      now,
      now,
    ),
    c.env.DB.prepare(
      "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
    ).bind(subId, user.id, now),
  ]);

  const team = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ?")
    .bind(subId)
    .first<TeamRow>();
  return c.json({ team: { ...serializeTeamRow(team!), role: "owner" } }, 201);
});

// Get team details + members + hierarchy info.
//
// Visible to direct members and to members of any ancestor team (inherited
// visibility). The response includes:
//   - `team.ancestors` — array of {id, name} from immediate parent to root
//   - `team.sub_teams` — immediate children with member_count
//   - `team.my_role` — effective role (direct ∪ inherited, max wins)
//   - `team.inherited_from` — ancestor id when my_role came from inheritance
//   - `members` — direct members of this team only (inherited members are
//     visible by inspecting ancestor teams, which the client can do on its
//     own; surfacing them here would multiply listings on every sub-team).
app.get("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const eff = await getEffectiveMember(c.env.DB, id, user.id);
  if (!eff) return c.json({ error: "Not found" }, 404);

  const [team, members, ancestors, subTeams, memberGroups] = await Promise.all([
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
    getTeamAncestors(c.env.DB, id),
    c.env.DB.prepare(
      `SELECT t.id, t.name, t.avatar_url, (
         SELECT COUNT(*) FROM team_members WHERE team_id = t.id
       ) AS member_count
       FROM teams t WHERE t.parent_team_id = ?
       ORDER BY t.created_at DESC`,
    )
      .bind(id)
      .all<{
        id: string;
        name: string;
        avatar_url: string | null;
        member_count: number;
      }>(),
    getGroupsForTeamMembers(c.env.DB, id),
  ]);

  if (!team) return c.json({ error: "Not found" }, 404);

  // ancestors[0] is the team itself — slice it off and rewrite avatars.
  const ancestorChain = await Promise.all(
    ancestors.slice(1).map(async (a) => ({
      id: a.id,
      name: a.name,
      avatar_url: await proxyImageUrl(c.env.APP_URL, c.env.DB, a.avatar_url),
    })),
  );

  return c.json({
    team: {
      ...serializeTeamRow(team),
      avatar_url: await proxyImageUrl(c.env.APP_URL, c.env.DB, team.avatar_url),
      unproxied_avatar_url: team.avatar_url,
      my_role: eff.role,
      inherited_from: eff.inherited_from,
      ancestors: ancestorChain,
      sub_teams: await Promise.all(
        subTeams.results.map(async (s) => ({
          id: s.id,
          name: s.name,
          avatar_url: await proxyImageUrl(
            c.env.APP_URL,
            c.env.DB,
            s.avatar_url,
          ),
          member_count: s.member_count,
        })),
      ),
    },
    members: await Promise.all(
      members.results.map(async (m) => ({
        ...m,
        avatar_url: await proxyImageUrl(c.env.APP_URL, c.env.DB, m.avatar_url),
        unproxied_avatar_url: m.avatar_url,
        // Empty whenever the team has groups switched off — the resolver
        // returns an empty map rather than us branching here.
        groups: memberGroups.get(m.user_id) ?? [],
      })),
    ),
  });
});

// Update team
app.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const eff = await getEffectiveMember(c.env.DB, id, user.id);
  if (!eff) return c.json({ error: "Not found" }, 404);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "Forbidden" }, 403);
  const member = { role: eff.role };

  const body = await c.req.json<{
    name?: string;
    description?: string;
    avatar_url?: string;
    parent_team_id?: string | null;
    profile_is_public?: boolean;
    profile_show_description?: boolean | null;
    profile_show_avatar?: boolean | null;
    profile_show_owner?: boolean | null;
    profile_show_member_count?: boolean | null;
    profile_show_apps?: boolean | null;
    profile_show_domains?: boolean | null;
    profile_show_members?: boolean | null;
    profile_show_sub_teams?: boolean | null;
    require_2fa?: boolean;
    require_verified_email?: boolean;
    enable_groups?: boolean;
    role_permissions?: unknown;
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
  if (body.parent_team_id !== undefined) {
    const enabled = await getConfigValue(c.env.DB, "enable_sub_teams");
    if (!enabled)
      return c.json({ error: "Sub-teams are disabled on this instance" }, 403);
    // Moving a team. Owner-only (the team's own owner, direct or inherited)
    // because re-parenting redistributes inherited access across the whole
    // organisation tree.
    if (!hasRole(member.role, "owner"))
      return c.json(
        { error: "Only the owner can move the team to a new parent" },
        403,
      );
    const reason = await isInvalidReparent(c.env.DB, id, body.parent_team_id);
    if (reason) return c.json({ error: reason }, 400);
    if (body.parent_team_id) {
      const parentEff = await getEffectiveMember(
        c.env.DB,
        body.parent_team_id,
        user.id,
      );
      if (!parentEff || !hasRole(parentEff.role, "admin"))
        return c.json(
          { error: "Forbidden: must be admin+ of the new parent team" },
          403,
        );
    }
    updates.push("parent_team_id = ?");
    values.push(body.parent_team_id);
  }
  if (body.require_2fa !== undefined) {
    if (!hasRole(member.role, "owner"))
      return c.json(
        { error: "Only the owner can change join requirements" },
        403,
      );
    updates.push("require_2fa = ?");
    values.push(body.require_2fa ? 1 : 0);
  }
  if (body.require_verified_email !== undefined) {
    if (!hasRole(member.role, "owner"))
      return c.json(
        { error: "Only the owner can change join requirements" },
        403,
      );
    updates.push("require_verified_email = ?");
    values.push(body.require_verified_email ? 1 : 0);
  }
  if (body.enable_groups !== undefined) {
    if (!hasRole(member.role, "owner"))
      return c.json({ error: "Only the owner can toggle member groups" }, 403);
    updates.push("enable_groups = ?");
    values.push(body.enable_groups ? 1 : 0);
  }
  if (body.role_permissions !== undefined) {
    // Owner-only, and deliberately not merely "admin+": a capability set the
    // constrained role could edit would be no constraint at all — an admin
    // would simply grant themselves whatever the owner withheld.
    if (!hasRole(member.role, "owner"))
      return c.json(
        { error: "Only the owner can change role permissions" },
        403,
      );
    const cleaned = sanitizeRolePermissions(body.role_permissions);
    updates.push("role_permissions = ?");
    // Store NULL rather than "{}" when nothing is overridden, so the column
    // reads as "follows the site default" instead of "explicitly empty".
    values.push(
      Object.keys(cleaned).length === 0 ? null : JSON.stringify(cleaned),
    );
  }
  for (const field of [
    "profile_show_description",
    "profile_show_avatar",
    "profile_show_owner",
    "profile_show_member_count",
    "profile_show_apps",
    "profile_show_domains",
    "profile_show_members",
    "profile_show_sub_teams",
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

  auditTeam(c, id, "team.update", {
    resourceName: updated?.name ?? team.name,
    metadata: { fields: updates.map((u) => u.split(" = ")[0]) },
  });

  return c.json({
    team: { ...serializeTeamRow(updated!), my_role: member.role },
  });
});

// Delete team — owner only (direct OR inherited from an ancestor team).
// Cascades through all sub-teams (deepest first); each level's apps fall back
// to that level's own owner, then the deleting user. See {@link dissolveTeam}.
app.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const eff = await getEffectiveMember(c.env.DB, id, user.id);
  if (!eff) return c.json({ error: "Not found" }, 404);
  if (!hasRole(eff.role, "owner"))
    return c.json({ error: "Only the team owner can delete the team" }, 403);

  const teamRow = await c.env.DB.prepare("SELECT name FROM teams WHERE id = ?")
    .bind(id)
    .first<{ name: string }>();
  if (teamRow && isTeamLocked(c.env, teamRow.name)) {
    return c.json({ error: "This team is locked and cannot be deleted" }, 403);
  }

  auditTeam(c, id, "team.delete");

  await dissolveTeam(c.env.DB, id, user.id);

  // Team avatar + every member-app icon may now be unreferenced — sweep.
  c.executionCtx.waitUntil(
    sweepOrphanedImageProxyMappings(c.env.DB).catch(() => {}),
  );

  return c.json({ message: "Team deleted" });
});

// ─── Members ─────────────────────────────────────────────────────────────────

// Add member by username
app.post("/:id/members", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const eff = await getEffectiveMember(c.env.DB, id, user.id);
  if (!eff) return c.json({ error: "Not found" }, 404);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "Forbidden" }, 403);

  const body = await c.req.json<{ username: string; role?: string }>();
  let role: string = "member";
  if (body.role === "admin") role = "admin";
  if (body.role === "co-owner" && eff.role === "owner") role = "co-owner";

  const target = await c.env.DB.prepare(
    "SELECT id FROM users WHERE username = ? AND kind = 'user'",
  )
    .bind(body.username)
    .first<{ id: string }>();
  if (!target) return c.json({ error: "User not found" }, 404);

  const existing = await getMember(c.env.DB, id, target.id);
  if (existing) return c.json({ error: "Already a member" }, 409);

  const teamReq = await getEffectiveTeamRequirements(c.env.DB, id);
  if (teamReq) {
    const state = await getUserSecurityState(c.env.DB, target.id);
    const unmet = unmetRequirements(teamReq, state);
    if (unmet.length) {
      return c.json(
        {
          error:
            "User doesn't meet this team's join requirements (e.g. 2FA, verified email)",
          unmet_requirements: unmet,
        },
        403,
      );
    }
  }

  await c.env.DB.prepare(
    "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)",
  )
    .bind(id, target.id, role, Math.floor(Date.now() / 1000))
    .run();

  auditTeam(c, id, "team.member.add", {
    resourceType: "user",
    resourceId: target.id,
    resourceName: `@${body.username}`,
    metadata: { role },
  });

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

  const eff = await getEffectiveMember(c.env.DB, id, user.id);
  if (!eff) return c.json({ error: "Not found" }, 404);
  if (!hasRole(eff.role, "co-owner"))
    return c.json({ error: "Only owners and co-owners can change roles" }, 403);
  if (targetUserId === user.id)
    return c.json({ error: "Cannot change your own role" }, 400);

  const body = await c.req.json<{ role: string }>();
  if (!["co-owner", "admin", "member"].includes(body.role))
    return c.json({ error: "Role must be co-owner, admin, or member" }, 400);

  // Target must be a *direct* member of this team — inherited memberships
  // are managed at the ancestor team they originate from.
  const target = await getMember(c.env.DB, id, targetUserId);
  if (!target) return c.json({ error: "Member not found" }, 404);
  if (target.role === "owner")
    return c.json({ error: "Cannot change owner role" }, 403);
  if (target.role === "co-owner" && eff.role !== "owner")
    return c.json({ error: "Only the owner can change co-owner roles" }, 403);
  if (body.role === "co-owner" && eff.role !== "owner")
    return c.json({ error: "Only the owner can assign co-owner role" }, 403);

  await c.env.DB.prepare(
    "UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?",
  )
    .bind(body.role, id, targetUserId)
    .run();

  auditTeam(c, id, "team.member.role_change", {
    resourceType: "user",
    resourceId: targetUserId,
    metadata: { from: target.role, to: body.role },
  });

  return c.json({ message: "Role updated" });
});

// Remove member (owner/admin; cannot remove an owner). Self-leave requires
// direct membership — inherited members "leave" by leaving the ancestor.
app.delete("/:id/members/:userId", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const targetUserId = c.req.param("userId");

  const isSelf = targetUserId === user.id;
  let actorRole: string;
  if (isSelf) {
    const direct = await getMember(c.env.DB, id, user.id);
    if (!direct)
      return c.json({ error: "You are not a direct member of this team" }, 404);
    actorRole = direct.role;
  } else {
    const eff = await getEffectiveMember(c.env.DB, id, user.id);
    if (!eff) return c.json({ error: "Not found" }, 404);
    if (!hasRole(eff.role, "admin")) return c.json({ error: "Forbidden" }, 403);
    actorRole = eff.role;
  }

  const target = await getMember(c.env.DB, id, targetUserId);
  if (!target) return c.json({ error: "Member not found" }, 404);

  if (target.role === "owner" && !isSelf)
    return c.json({ error: "Cannot remove the team owner" }, 403);
  // Only owner can remove co-owners
  if (target.role === "co-owner" && !isSelf && actorRole !== "owner")
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

  auditTeam(c, id, isSelf ? "team.member.leave" : "team.member.remove", {
    resourceType: "user",
    resourceId: targetUserId,
    metadata: { role: target.role },
  });

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

  auditTeam(c, id, "team.ownership.transfer", {
    resourceType: "user",
    resourceId: body.user_id,
    metadata: { from: user.id, to: body.user_id },
  });

  return c.json({ message: "Ownership transferred" });
});

// ─── Member groups ────────────────────────────────────────────────────────────
//
// Groups are pure labels — they never widen what anyone can do inside Prism.
// What they *do* affect is downstream authorization, which is why who may
// hand them out is itself configurable (see worker/lib/teamGroups.ts) and why
// every mutation here is audited.

/** Shared preamble for the group endpoints: the caller's effective role plus
 *  the two inputs every capability check needs. Returns null when the caller
 *  has no membership at all. */
async function groupContext(
  db: D1Database,
  teamId: string,
  userId: string,
): Promise<{
  team: TeamRow;
  role: string;
  siteDefaults: TeamRolePermissions;
} | null> {
  const eff = await getEffectiveMember(db, teamId, userId);
  if (!eff) return null;
  const [team, siteDefaults] = await Promise.all([
    db
      .prepare("SELECT * FROM teams WHERE id = ?")
      .bind(teamId)
      .first<TeamRow>(),
    getSiteRolePermissions(db),
  ]);
  if (!team) return null;
  return { team, role: eff.role, siteDefaults };
}

// List group definitions. Readable by any member — a member seeing which
// labels exist is harmless, and the client needs the capability flags to
// decide what to render.
app.get("/:id/groups", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const ctx = await groupContext(c.env.DB, id, user.id);
  if (!ctx) return c.json({ error: "Not found" }, 404);

  // Definitions are listed even while the feature is off, so an owner can
  // see what flipping the switch back on would restore.
  const groups = await listTeamGroups(c.env.DB, id);

  return c.json({
    enabled: ctx.team.enable_groups === 1,
    capabilities: effectiveCapabilities(
      ctx.team.role_permissions,
      ctx.siteDefaults,
    ),
    // What the chain resolves to *without* this team's overrides. The
    // settings UI labels its "follow the site default" option with this, so
    // an owner can see what clearing an override would actually give them.
    default_capabilities: effectiveCapabilities(null, ctx.siteDefaults),
    can_manage: canManageGroups(
      ctx.role,
      ctx.team.role_permissions,
      ctx.siteDefaults,
    ),
    groups: groups.map((g) => ({
      ...serializeTeamGroup(g),
      can_assign: canAssignGroup(
        ctx.role,
        g,
        ctx.team.role_permissions,
        ctx.siteDefaults,
      ),
    })),
  });
});

app.post("/:id/groups", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const ctx = await groupContext(c.env.DB, id, user.id);
  if (!ctx) return c.json({ error: "Not found" }, 404);
  if (ctx.team.enable_groups !== 1)
    return c.json({ error: "Member groups are disabled for this team" }, 403);
  if (!canManageGroups(ctx.role, ctx.team.role_permissions, ctx.siteDefaults))
    return c.json({ error: "Forbidden" }, 403);

  const body = await c.req.json<{
    slug?: string;
    name?: string;
    description?: string;
    color?: string | null;
    admin_assignable?: boolean | null;
  }>();

  const slug = (body.slug ?? "").trim().toLowerCase();
  const slugErr = validateGroupSlug(slug);
  if (slugErr) return c.json({ error: slugErr }, 400);

  const name = (body.name ?? "").trim();
  if (!name) return c.json({ error: "name is required" }, 400);
  if (name.length > MAX_GROUP_NAME_LENGTH)
    return c.json(
      { error: `name must be at most ${MAX_GROUP_NAME_LENGTH} characters` },
      400,
    );

  const description = (body.description ?? "").trim();
  if (description.length > MAX_GROUP_DESCRIPTION_LENGTH)
    return c.json(
      {
        error: `description must be at most ${MAX_GROUP_DESCRIPTION_LENGTH} characters`,
      },
      400,
    );

  const color = body.color ?? null;
  const colorErr = validateGroupColor(color);
  if (colorErr) return c.json({ error: colorErr }, 400);

  // The per-group exception overrides the owner's capability set, so only
  // the owner may set it — otherwise a manager could exempt themselves.
  if (body.admin_assignable !== undefined && !hasRole(ctx.role, "owner"))
    return c.json(
      { error: "Only the owner can set per-group assignment rules" },
      403,
    );

  const existing = await listTeamGroups(c.env.DB, id);
  if (existing.length >= MAX_GROUPS_PER_TEAM)
    return c.json(
      { error: `A team can have at most ${MAX_GROUPS_PER_TEAM} groups` },
      400,
    );
  if (existing.some((g) => g.slug === slug))
    return c.json({ error: "A group with that slug already exists" }, 409);

  const now = Math.floor(Date.now() / 1000);
  const groupId = randomId();
  try {
    await c.env.DB.prepare(
      `INSERT INTO team_groups
       (id, team_id, slug, name, description, color, admin_assignable, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        groupId,
        id,
        slug,
        name,
        description,
        color || null,
        body.admin_assignable === undefined || body.admin_assignable === null
          ? null
          : body.admin_assignable
            ? 1
            : 0,
        now,
        now,
      )
      .run();
  } catch (err) {
    // The check above races: two concurrent creates can both read a free
    // slug. UNIQUE (team_id, slug) is the real guard, so translate it into
    // the same 409 the checked path returns rather than a 500.
    if (String(err).includes("UNIQUE"))
      return c.json({ error: "A group with that slug already exists" }, 409);
    throw err;
  }

  auditTeam(c, id, "team.group.create", {
    resourceType: "team_group",
    resourceId: groupId,
    resourceName: slug,
    metadata: { slug, name },
  });

  const created = await c.env.DB.prepare(
    "SELECT * FROM team_groups WHERE id = ?",
  )
    .bind(groupId)
    .first<TeamGroupRow>();

  return c.json({ group: serializeTeamGroup(created!) }, 201);
});

app.patch("/:id/groups/:groupId", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const groupId = c.req.param("groupId");

  const ctx = await groupContext(c.env.DB, id, user.id);
  if (!ctx) return c.json({ error: "Not found" }, 404);
  if (ctx.team.enable_groups !== 1)
    return c.json({ error: "Member groups are disabled for this team" }, 403);
  if (!canManageGroups(ctx.role, ctx.team.role_permissions, ctx.siteDefaults))
    return c.json({ error: "Forbidden" }, 403);

  const group = await c.env.DB.prepare(
    "SELECT * FROM team_groups WHERE id = ? AND team_id = ?",
  )
    .bind(groupId, id)
    .first<TeamGroupRow>();
  if (!group) return c.json({ error: "Group not found" }, 404);

  const body = await c.req.json<{
    slug?: string;
    name?: string;
    description?: string;
    color?: string | null;
    admin_assignable?: boolean | null;
  }>();

  // Slugs are what downstream authorization rules bind to. Renaming one
  // would silently break every policy referencing it, so the display name is
  // the only mutable label.
  if (body.slug !== undefined && body.slug !== group.slug)
    return c.json(
      { error: "slug is immutable — delete and recreate the group instead" },
      400,
    );

  const updates: string[] = ["updated_at = ?"];
  const values: unknown[] = [Math.floor(Date.now() / 1000)];

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) return c.json({ error: "name cannot be empty" }, 400);
    if (name.length > MAX_GROUP_NAME_LENGTH)
      return c.json(
        { error: `name must be at most ${MAX_GROUP_NAME_LENGTH} characters` },
        400,
      );
    updates.push("name = ?");
    values.push(name);
  }
  if (body.description !== undefined) {
    const description = body.description.trim();
    if (description.length > MAX_GROUP_DESCRIPTION_LENGTH)
      return c.json(
        {
          error: `description must be at most ${MAX_GROUP_DESCRIPTION_LENGTH} characters`,
        },
        400,
      );
    updates.push("description = ?");
    values.push(description);
  }
  if (body.color !== undefined) {
    const colorErr = validateGroupColor(body.color);
    if (colorErr) return c.json({ error: colorErr }, 400);
    updates.push("color = ?");
    values.push(body.color || null);
  }
  if (body.admin_assignable !== undefined) {
    if (!hasRole(ctx.role, "owner"))
      return c.json(
        { error: "Only the owner can set per-group assignment rules" },
        403,
      );
    updates.push("admin_assignable = ?");
    values.push(
      body.admin_assignable === null ? null : body.admin_assignable ? 1 : 0,
    );
  }

  values.push(groupId);
  await c.env.DB.prepare(
    `UPDATE team_groups SET ${updates.join(", ")} WHERE id = ?`,
  )
    .bind(...values)
    .run();

  auditTeam(c, id, "team.group.update", {
    resourceType: "team_group",
    resourceId: groupId,
    resourceName: group.slug,
    metadata: { fields: updates.map((u) => u.split(" = ")[0]) },
  });

  const updated = await c.env.DB.prepare(
    "SELECT * FROM team_groups WHERE id = ?",
  )
    .bind(groupId)
    .first<TeamGroupRow>();

  return c.json({ group: serializeTeamGroup(updated!) });
});

app.delete("/:id/groups/:groupId", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const groupId = c.req.param("groupId");

  const ctx = await groupContext(c.env.DB, id, user.id);
  if (!ctx) return c.json({ error: "Not found" }, 404);
  if (ctx.team.enable_groups !== 1)
    return c.json({ error: "Member groups are disabled for this team" }, 403);
  if (!canManageGroups(ctx.role, ctx.team.role_permissions, ctx.siteDefaults))
    return c.json({ error: "Forbidden" }, 403);

  const group = await c.env.DB.prepare(
    "SELECT * FROM team_groups WHERE id = ? AND team_id = ?",
  )
    .bind(groupId, id)
    .first<TeamGroupRow>();
  if (!group) return c.json({ error: "Group not found" }, 404);

  // Assignments go with it via ON DELETE CASCADE — downstream apps stop
  // seeing the label on their next token refresh.
  await c.env.DB.prepare("DELETE FROM team_groups WHERE id = ?")
    .bind(groupId)
    .run();

  auditTeam(c, id, "team.group.delete", {
    resourceType: "team_group",
    resourceId: groupId,
    resourceName: group.slug,
    metadata: { slug: group.slug, name: group.name },
  });

  return c.json({ message: "Group deleted" });
});

// Replace a member's group set. A full replacement rather than add/remove
// deltas keeps the dashboard's multi-select honest — the client sends the
// state it wants and the server reconciles.
app.put("/:id/members/:userId/groups", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const targetUserId = c.req.param("userId");

  const ctx = await groupContext(c.env.DB, id, user.id);
  if (!ctx) return c.json({ error: "Not found" }, 404);
  if (ctx.team.enable_groups !== 1)
    return c.json({ error: "Member groups are disabled for this team" }, 403);

  // Direct membership only — inherited members carry labels from the
  // ancestor they originate at, and that's where they're managed.
  const target = await getMember(c.env.DB, id, targetUserId);
  if (!target) return c.json({ error: "Member not found" }, 404);

  const body = await c.req.json<{ group_ids?: unknown }>();
  if (!Array.isArray(body.group_ids))
    return c.json({ error: "group_ids must be an array" }, 400);
  const requested = [
    ...new Set(
      body.group_ids.filter((g): g is string => typeof g === "string"),
    ),
  ];
  if (requested.length > MAX_GROUPS_PER_MEMBER)
    return c.json(
      {
        error: `A member can hold at most ${MAX_GROUPS_PER_MEMBER} groups`,
      },
      400,
    );

  const defined = await listTeamGroups(c.env.DB, id);
  const byId = new Map(defined.map((g) => [g.id, g]));
  const unknownId = requested.find((gid) => !byId.has(gid));
  if (unknownId) return c.json({ error: `Unknown group: ${unknownId}` }, 400);

  const { results: currentRows } = await c.env.DB.prepare(
    "SELECT group_id FROM team_member_groups WHERE team_id = ? AND user_id = ?",
  )
    .bind(id, targetUserId)
    .all<{ group_id: string }>();
  const current = new Set(currentRows.map((r) => r.group_id));
  const next = new Set(requested);

  const added = requested.filter((gid) => !current.has(gid));
  const removed = [...current].filter((gid) => !next.has(gid));
  if (added.length === 0 && removed.length === 0)
    return c.json({ message: "No changes" });

  // Only the groups actually changing are permission-checked. Checking the
  // whole set instead would mean an admin barred from one sensitive group
  // could no longer edit *any* label on a member already holding it.
  for (const gid of [...added, ...removed]) {
    const group = byId.get(gid);
    // A group that vanished between the read and here — treat as unknown.
    if (!group) return c.json({ error: `Unknown group: ${gid}` }, 400);
    if (
      !canAssignGroup(
        ctx.role,
        group,
        ctx.team.role_permissions,
        ctx.siteDefaults,
      )
    )
      return c.json(
        { error: `You cannot assign or remove the group "${group.slug}"` },
        403,
      );
  }

  const now = Math.floor(Date.now() / 1000);
  const stmts = [
    ...removed.map((gid) =>
      c.env.DB.prepare(
        "DELETE FROM team_member_groups WHERE team_id = ? AND user_id = ? AND group_id = ?",
      ).bind(id, targetUserId, gid),
    ),
    ...added.map((gid) =>
      c.env.DB.prepare(
        "INSERT INTO team_member_groups (team_id, user_id, group_id, assigned_at) VALUES (?, ?, ?, ?)",
      ).bind(id, targetUserId, gid, now),
    ),
  ];
  if (stmts.length > 0) await c.env.DB.batch(stmts);

  auditTeam(c, id, "team.member.groups_change", {
    resourceType: "user",
    resourceId: targetUserId,
    metadata: {
      added: added.map((gid) => byId.get(gid)?.slug ?? gid),
      removed: removed.map((gid) => byId.get(gid)?.slug ?? gid),
    },
  });

  // Single-member resolve — the whole-team variant would recompute every
  // other member's labels just to read one row back.
  return c.json({ groups: await getMemberGroups(c.env.DB, id, targetUserId) });
});

// ─── Invites ──────────────────────────────────────────────────────────────────

// List active invites for a team
app.get("/:id/invites", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const eff = await getEffectiveMember(c.env.DB, id, user.id);
  if (!eff) return c.json({ error: "Not found" }, 404);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "Forbidden" }, 403);

  const now = Math.floor(Date.now() / 1000);
  const { results } = await c.env.DB.prepare(
    `SELECT i.*, u.username AS created_by_username
     FROM team_invites i JOIN users u ON u.id = i.created_by
     WHERE i.team_id = ? AND i.expires_at > ?
     ORDER BY i.created_at DESC`,
  )
    .bind(id, now)
    .all<InviteRow & { created_by_username: string }>();

  return c.json({ invites: results });
});

// Create invite (shareable link or email)
app.post("/:id/invites", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const eff = await getEffectiveMember(c.env.DB, id, user.id);
  if (!eff) return c.json({ error: "Not found" }, 404);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "Forbidden" }, 403);

  const body = await c.req.json<{
    role?: string;
    max_uses?: number;
    expires_in_hours?: number;
    ttl_hours?: number;
    email?: string;
  }>();

  let role: string = "member";
  if (body.role === "admin") role = "admin";
  if (body.role === "co-owner" && hasRole(eff.role, "owner")) role = "co-owner";
  const maxUses = body.max_uses ?? 0;
  const requestedTtl = body.ttl_hours ?? body.expires_in_hours ?? 72;
  const ttlHours = Math.min(Math.max(requestedTtl, 1), 720); // max 30 days
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + ttlHours * 3600;
  const token = randomBase64url(24);
  const storedToken = await hashSecret(c.env, token);

  await c.env.DB.prepare(
    `INSERT INTO team_invites (token, team_id, role, created_by, email, max_uses, uses, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  )
    .bind(
      storedToken,
      id,
      role,
      user.id,
      body.email ?? null,
      maxUses,
      expiresAt,
      now,
    )
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
      },
    },
    201,
  );
});

// Revoke an invite
app.delete("/:id/invites/:token", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const token = c.req.param("token");

  const eff = await getEffectiveMember(c.env.DB, id, user.id);
  if (!eff) return c.json({ error: "Not found" }, 404);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "Forbidden" }, 403);

  const tokenLookup = await hashLookupCandidate(c.env, token);
  // For revoke, missing/suspicious tokens are silently treated as a no-op
  // delete — caller already gated by team admin role above, so a probe
  // here can't be used to enumerate invites.
  await c.env.DB.prepare(
    "DELETE FROM team_invites WHERE (token = ? OR token = ?) AND team_id = ?",
  )
    .bind(token, tokenLookup ?? token, id)
    .run();

  return c.json({ message: "Invite revoked" });
});

// ─── Team domains ─────────────────────────────────────────────────────────────

const DOMAIN_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

// List team domains. Includes domains owned by this team plus, as read-only
// `inherited_from`-tagged entries, every domain owned by an ancestor team
// (sub-teams inherit ancestor domains for verification + display). Honors
// the `inherit_team_domains` site config — when disabled the response
// contains direct domains only.
app.get(":id/domains", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const eff = await getEffectiveMember(c.env.DB, id, user.id);
  if (!eff) return c.json({ error: "Not a team member" }, 403);

  const own = await c.env.DB.prepare(
    "SELECT * FROM domains WHERE team_id = ? ORDER BY created_at DESC",
  )
    .bind(id)
    .all<DomainRow>();

  const inheritDomains = await getConfigValue(c.env.DB, "inherit_team_domains");
  let inherited: Array<DomainRow & { inherited_from: string }> = [];
  if (inheritDomains) {
    // Ancestor-owned domains, surfaced as read-only entries. We pull them
    // in a single IN() rather than per-ancestor since depth is bounded.
    const ancestors = await getTeamAncestors(c.env.DB, id);
    const ancestorIds = ancestors.slice(1).map((a) => a.id);
    if (ancestorIds.length) {
      const placeholders = ancestorIds.map(() => "?").join(",");
      const { results } = await c.env.DB.prepare(
        `SELECT * FROM domains WHERE team_id IN (${placeholders})
         ORDER BY created_at DESC`,
      )
        .bind(...ancestorIds)
        .all<DomainRow>();
      inherited = results.map((r) => ({ ...r, inherited_from: r.team_id! }));
    }
  }

  return c.json({
    domains: [
      ...own.results.map((d) => ({ ...d, inherited_from: null })),
      ...inherited,
    ],
  });
});

// Add team domain
app.post(":id/domains", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const eff = await getEffectiveMember(c.env.DB, id, user.id);
  if (!eff) return c.json({ error: "Not a team member" }, 403);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "Forbidden" }, 403);

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
  const eff = await getEffectiveMember(c.env.DB, id, user.id);
  if (!eff) return c.json({ error: "Not a team member" }, 403);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "Forbidden" }, 403);

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
  const eff = await getEffectiveMember(c.env.DB, id, user.id);
  if (!eff) return c.json({ error: "Not a team member" }, 403);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "Forbidden" }, 403);

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
  const eff = await getEffectiveMember(c.env.DB, id, user.id);
  if (!eff) return c.json({ error: "Not a team member" }, 403);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "Forbidden" }, 403);

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
  const eff = await getEffectiveMember(c.env.DB, id, user.id);
  if (!eff) return c.json({ error: "Not a team member" }, 403);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "Forbidden" }, 403);

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

  // Requester must be admin+ in the target team (effective)
  const targetEff = await getEffectiveMember(c.env.DB, body.team_id, user.id);
  if (!targetEff || !hasRole(targetEff.role, "admin"))
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
  const eff = await getEffectiveMember(c.env.DB, id, user.id);
  if (!eff) return c.json({ error: "Not a team member" }, 403);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "Forbidden" }, 403);

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
  // When `inherit_team_domains` is disabled we only consult the team's
  // own verified domains for auto-verification, matching the listing
  // behavior.
  const inheritDomains = await getConfigValue(db, "inherit_team_domains");
  const teamIds = inheritDomains
    ? (await getTeamAncestors(db, teamId)).map((a) => a.id)
    : [teamId];
  if (!teamIds.length) return null;
  const placeholders = teamIds.map(() => "?").join(",");
  const parts = domain.split(".");
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join(".");
    const row = await db
      .prepare(
        `SELECT domain FROM domains
         WHERE team_id IN (${placeholders}) AND domain = ? AND verified = 1
         LIMIT 1`,
      )
      .bind(...teamIds, parent)
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

  const eff = await getEffectiveMember(c.env.DB, id, user.id);
  if (!eff) return c.json({ error: "Not found" }, 404);

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
      return safeApp(c.env.APP_URL, c.env.DB, row, isVerified);
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

  const eff = await getEffectiveMember(c.env.DB, id, user.id);
  if (!eff) return c.json({ error: "Not found" }, 404);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "Forbidden" }, 403);

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
    const reason = validateRedirectUriForRegistration(uri);
    if (reason)
      return c.json({ error: `Invalid redirect_uri (${reason}): ${uri}` }, 400);
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
  return c.json(
    { app: await fullApp(c.env.APP_URL, c.env.DB, row!, isVerified) },
    201,
  );
});

// Transfer a personal app into this team
app.post("/:id/apps/transfer", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const eff = await getEffectiveMember(c.env.DB, id, user.id);
  if (!eff) return c.json({ error: "Not found" }, 404);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "Forbidden" }, 403);

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

  const eff = await getEffectiveMember(c.env.DB, id, user.id);
  if (!eff) return c.json({ error: "Not found" }, 404);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "Forbidden" }, 403);

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

async function safeApp(
  baseUrl: string,
  db: D1Database,
  row: OAuthAppRow,
  isVerified: boolean,
) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon_url: await proxyImageUrl(baseUrl, db, row.icon_url),
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

async function fullApp(
  baseUrl: string,
  db: D1Database,
  row: OAuthAppRow,
  isVerified: boolean,
) {
  return {
    ...(await safeApp(baseUrl, db, row, isVerified)),
    client_secret: row.client_secret,
  };
}

export default app;
