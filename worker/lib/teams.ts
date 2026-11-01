// Team membership, roles and authority, shared by every route that acts on
// a team (teams, apps, domains, audit, oauth, search, admin).

import type { Context } from "hono";
import type { CodedError } from "./apiError";
import { getConfigValue } from "./config";
import type { TeamMemberRow, TeamRow, Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };

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

// ─── Site-admin elevation ─────────────────────────────────────────────────────

/** What an actor may do on a team, and where that authority came from.
 *
 *  For an ordinary user this is exactly {@link getEffectiveMember}. For a site
 *  admin it is `owner` on every team that exists, member or not — the admin
 *  panel drives teams "from the outside" through these same endpoints rather
 *  than a parallel, always-drifting set of admin-only ones.
 *
 *  `elevated` says whether the site-admin override is what granted the role.
 *  Routes read it to relax guards that only make sense between members (a
 *  team's own join requirements, for instance), and every audit entry carries
 *  it so the team can see that the site — not one of its members — acted. */
export interface TeamAuthority {
  role: "owner" | "co-owner" | "admin" | "member";
  /** The actor's own row on this team, or null when they aren't a member. */
  direct: TeamMemberRow | null;
  /** Ancestor the role was inherited from; null for direct or elevated. */
  inherited_from: string | null;
  /** True when site-admin override granted (or raised) the role. */
  elevated: boolean;
  /** The actor's effective role *ignoring* the override — what they would
   *  hold in "normal view". null when they aren't a member at all. Lets the
   *  UI decide whether dropping the override leaves them any access. */
  member_role: "owner" | "co-owner" | "admin" | "member" | null;
}

/** The actor an authority check should run as.
 *
 *  `role` is the *site* role. Callers pass "user" to deliberately suppress the
 *  override — see {@link actorFor}, which does so for PAT-authenticated
 *  requests. */
export interface TeamActor {
  id: string;
  role: "admin" | "user";
}

/** Did the client ask to drop the site-admin override for this request?
 *
 *  The dashboard's "switch to normal view" toggle sends this header so an
 *  admin can act as their own team membership instead of as the site. It is
 *  advisory and only ever *removes* authority, so it needs no validation
 *  beyond the value check — a non-admin sending it changes nothing. */
export function wantsNormalView(c: Context<AppEnv>): boolean {
  return c.req.header("X-Prism-Team-View")?.toLowerCase() === "member";
}

/** Resolve the acting principal for a request.
 *
 *  A Personal Access Token carries only its own scopes, so an admin's
 *  `apps:write` token stays an `apps:write` token here instead of quietly
 *  becoming a site-wide master key. Session-authenticated admins get the
 *  override — unless they've asked, via the "normal view" header, to be
 *  treated as their own membership for this request. */
export function actorFor(c: Context<AppEnv>): TeamActor {
  const user = c.get("user");
  const suppress = c.get("patAuth") || wantsNormalView(c);
  return { id: user.id, role: suppress ? "user" : user.role };
}

/** Is this request driven by a site administrator on their own session? */
export function isSiteAdmin(c: Context<AppEnv>): boolean {
  return actorFor(c).role === "admin";
}

export async function getTeamAuthority(
  db: D1Database,
  teamId: string,
  actor: TeamActor,
): Promise<TeamAuthority | null> {
  const eff = await getEffectiveMember(db, teamId, actor.id);
  const member_role = eff?.role ?? null;
  if (actor.role !== "admin")
    return eff ? { ...eff, elevated: false, member_role } : null;
  // A site admin holds owner-level authority on *every* team as the site,
  // whether or not they are a member — and holds it even on a team they own by
  // membership. The action is the site's, so it is elevated (and audited as
  // `site_admin: true`) regardless. An admin who wants to act as their own
  // membership drops the override with "normal view", which flips actor.role
  // to "user" above and returns their real `eff` on the branch just taken.
  const exists = await db
    .prepare("SELECT 1 AS n FROM teams WHERE id = ?")
    .bind(teamId)
    .first<{ n: number }>();
  if (!exists) return null;
  return {
    role: "owner",
    direct: eff?.direct ?? null,
    inherited_from: null,
    elevated: true,
    member_role,
  };
}

/** Request-scoped {@link getTeamAuthority} — the form nearly every route wants.
 *
 *  Also records, per team, whether the override was used, so {@link auditTeam}
 *  can stamp the entry without every call site threading the flag through. */
export async function teamAuthority(
  c: Context<AppEnv>,
  teamId: string,
): Promise<TeamAuthority | null> {
  const auth = await getTeamAuthority(c.env.DB, teamId, actorFor(c));
  let map = c.get("teamElevation");
  if (!map) {
    map = new Map<string, boolean>();
    c.set("teamElevation", map);
  }
  map.set(teamId, auth?.elevated ?? false);
  return auth;
}

/** Did the site-admin override grant this request its authority over `teamId`? */
export function actedAsSiteAdmin(c: Context<AppEnv>, teamId: string): boolean {
  return c.get("teamElevation")?.get(teamId) === true;
}

/** Returns true if moving `teamId` under `newParentId` would create a cycle
 *  or exceed the operator-configured max nesting depth for any team in the
 *  affected subtree. */
export async function isInvalidReparent(
  db: D1Database,
  teamId: string,
  newParentId: string | null,
): Promise<CodedError | null> {
  if (!newParentId) return null;
  if (newParentId === teamId) return { error: "team_parent_self" };

  const maxDepth = await getMaxTeamDepth(db);
  const parentAncestors = await getTeamAncestors(db, newParentId);
  if (!parentAncestors.length) return { error: "parent_team_not_found" };
  if (parentAncestors.some((a) => a.id === teamId))
    return { error: "team_parent_cycle" };
  if (parentAncestors.length >= maxDepth)
    return { error: "team_depth_limit", params: { max: maxDepth } };

  // Need to also bound the subtree depth: parent depth + subtree depth ≤ MAX
  const subtreeDepth = await maxSubtreeDepth(db, teamId);
  if (parentAncestors.length + subtreeDepth > maxDepth)
    return { error: "team_depth_limit", params: { max: maxDepth } };
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
