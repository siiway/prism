// Team groups — owner-defined member labels.
//
// Groups are *pure labels*: they never enter ROLE_RANK / hasRole, so Prism's
// own authorization is untouched. Their whole purpose is to ride along with
// member info (dashboard, OAuth member endpoints, OIDC claims) so downstream
// apps can authorize on them.
//
// Everything about reading and gating groups lives here because there are
// four independent read surfaces; without a single home the `enable_groups`
// gate and the inheritance rules would have to be re-implemented — and
// eventually diverge — in each one.

import { getConfigValue } from "./config";
import type {
  TeamCapability,
  TeamGroupRow,
  TeamRolePermissions,
} from "../types";

// ─── Limits ──────────────────────────────────────────────────────────────────

/** Per-team cap on group definitions. */
export const MAX_GROUPS_PER_TEAM = 50;
/** Per-member cap on assigned groups. Also bounds the size of the
 *  `groups_in_team_<id>` claim, which rides in the ID token. */
export const MAX_GROUPS_PER_MEMBER = 20;
export const MAX_GROUP_NAME_LENGTH = 64;
export const MAX_GROUP_DESCRIPTION_LENGTH = 256;

/** Slugs are the stable identifier downstream authorization rules bind to,
 *  so they're deliberately boring: lowercase, no separators beyond `-`. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 32;

/** Returns an error message, or null when the slug is acceptable. */
export function validateGroupSlug(slug: string): string | null {
  if (!slug) return "slug is required";
  if (slug.length > MAX_SLUG_LENGTH)
    return `slug must be at most ${MAX_SLUG_LENGTH} characters`;
  if (!SLUG_RE.test(slug))
    return "slug must be lowercase alphanumeric with single hyphens between segments";
  return null;
}

/** Returns an error message, or null when the colour is acceptable.
 *  Empty / null means "no colour", which is valid. */
export function validateGroupColor(color: string | null): string | null {
  if (color === null || color === "") return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(color))
    return "color must be a #rrggbb hex string";
  return null;
}

// ─── Capability resolution ───────────────────────────────────────────────────

/** Built-in defaults, the last link of the resolution chain.
 *
 *  Assigning is on by default (admins already manage membership, so handing
 *  out labels is a natural extension of that) while managing the definitions
 *  themselves is off (creating a group shapes what downstream apps can
 *  authorize on, which is an owner-level decision). */
export const TEAM_CAPABILITY_DEFAULTS: Record<TeamCapability, boolean> = {
  "groups:manage": false,
  "groups:assign": true,
};

/** Tolerant parse of the `teams.role_permissions` JSON blob. Malformed
 *  content degrades to "nothing overridden" rather than failing the request —
 *  a corrupt blob must not lock an owner out of their own team. */
export function parseRolePermissions(raw: string | null): TeamRolePermissions {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return parsed as TeamRolePermissions;
  } catch {
    return {};
  }
}

/**
 * Resolve one capability for the `admin` role through the full chain:
 *
 *   team.role_permissions → site default_team_role_permissions → built-in
 *
 * Each level contributes only the keys it explicitly sets; anything absent
 * falls through. Owners and co-owners never reach this function — they hold
 * every capability unconditionally.
 */
export function resolveAdminCapability(
  capability: TeamCapability,
  teamPermissions: TeamRolePermissions,
  siteDefaults: TeamRolePermissions,
): boolean {
  const fromTeam = teamPermissions.admin?.[capability];
  if (typeof fromTeam === "boolean") return fromTeam;
  const fromSite = siteDefaults.admin?.[capability];
  if (typeof fromSite === "boolean") return fromSite;
  return TEAM_CAPABILITY_DEFAULTS[capability];
}

/** Owners and co-owners are never gated by the capability set. */
function isUngated(role: string): boolean {
  return role === "owner" || role === "co-owner";
}

/** Whether `role` may create, edit or delete group definitions. */
export function canManageGroups(
  role: string,
  teamPermissionsRaw: string | null,
  siteDefaults: TeamRolePermissions,
): boolean {
  if (isUngated(role)) return true;
  if (role !== "admin") return false;
  return resolveAdminCapability(
    "groups:manage",
    parseRolePermissions(teamPermissionsRaw),
    siteDefaults,
  );
}

/**
 * Whether `role` may assign / unassign one specific group.
 *
 * Adds the per-group exception in front of the chain, so a team that lets
 * admins hand out labels in general can still reserve a sensitive group for
 * owners: `admin_assignable = 0` on that group alone.
 */
export function canAssignGroup(
  role: string,
  group: Pick<TeamGroupRow, "admin_assignable">,
  teamPermissionsRaw: string | null,
  siteDefaults: TeamRolePermissions,
): boolean {
  if (isUngated(role)) return true;
  if (role !== "admin") return false;
  if (group.admin_assignable !== null) return group.admin_assignable === 1;
  return resolveAdminCapability(
    "groups:assign",
    parseRolePermissions(teamPermissionsRaw),
    siteDefaults,
  );
}

/** Read the site-level fallback capability set, tolerating a malformed or
 *  legacy value in site_config the same way parseRolePermissions does. */
export async function getSiteRolePermissions(
  db: D1Database,
): Promise<TeamRolePermissions> {
  const value = await getConfigValue(db, "default_team_role_permissions");
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as TeamRolePermissions;
}

/** Strip an incoming capability payload down to keys we recognise, so a
 *  client cannot stuff arbitrary JSON into the column. Values must be real
 *  booleans; `null` removes an override (falls back to the next level). */
export function sanitizeRolePermissions(input: unknown): TeamRolePermissions {
  const out: TeamRolePermissions = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  const admin = (input as Record<string, unknown>).admin;
  if (!admin || typeof admin !== "object" || Array.isArray(admin)) return out;
  const cleaned: Partial<Record<TeamCapability, boolean>> = {};
  for (const capability of Object.keys(
    TEAM_CAPABILITY_DEFAULTS,
  ) as TeamCapability[]) {
    const v = (admin as Record<string, unknown>)[capability];
    if (typeof v === "boolean") cleaned[capability] = v;
  }
  if (Object.keys(cleaned).length > 0) out.admin = cleaned;
  return out;
}

// ─── Group resolution (with sub-team inheritance) ────────────────────────────

/** A group as it appears on a member, after the enable/inheritance rules. */
export interface ResolvedGroup {
  slug: string;
  name: string;
  color: string | null;
  /** Ancestor team id when this label came from a parent team, `null` when
   *  it was assigned on the team being read. */
  inherited_from: string | null;
}

/** {@link ResolvedGroup} plus the hop count used to settle slug collisions.
 *  Internal to {@link collapse} — stripped before the value leaves. */
interface RankedGroup extends ResolvedGroup {
  distance: number;
}

/** Only the columns the resolution walk needs — deliberately narrower than
 *  TeamRow so the ancestor walk stays cheap. */
interface TeamChainNode {
  id: string;
  parent_team_id: string | null;
  enable_groups: number;
}

/** D1 rejects statements with too many bound parameters; chunk any
 *  caller-controlled `IN (...)` list well below that ceiling. */
const BIND_CHUNK = 90;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

/**
 * Walk from each of `teamIds` up to its root, level by level.
 *
 * One query per level rather than one per team, so resolving groups for a
 * user in many teams at once (the OIDC claims path) stays cheap regardless
 * of how many teams they're in.
 */
async function loadTeamChains(
  db: D1Database,
  teamIds: string[],
  maxDepth: number,
): Promise<Map<string, TeamChainNode>> {
  const nodes = new Map<string, TeamChainNode>();
  let frontier = [...new Set(teamIds)];
  // maxDepth counts parents above the root, so +1 covers the teams themselves.
  for (let level = 0; level <= maxDepth && frontier.length > 0; level++) {
    const pending = frontier.filter((id) => !nodes.has(id));
    if (pending.length === 0) break;
    const next: string[] = [];
    for (const group of chunk(pending, BIND_CHUNK)) {
      const placeholders = group.map(() => "?").join(", ");
      const { results } = await db
        .prepare(
          `SELECT id, parent_team_id, enable_groups FROM teams WHERE id IN (${placeholders})`,
        )
        .bind(...group)
        .all<TeamChainNode>();
      for (const row of results) {
        nodes.set(row.id, row);
        if (row.parent_team_id) next.push(row.parent_team_id);
      }
    }
    frontier = next;
  }
  return nodes;
}

/** Ancestors of `teamId`, nearest first, excluding the team itself. Cycles
 *  (which the API layer rejects but corrupt data could still contain) break
 *  the walk rather than spinning. */
function ancestorsOf(
  teamId: string,
  nodes: Map<string, TeamChainNode>,
): TeamChainNode[] {
  const out: TeamChainNode[] = [];
  const seen = new Set<string>([teamId]);
  let current = nodes.get(teamId)?.parent_team_id ?? null;
  while (current && !seen.has(current)) {
    seen.add(current);
    const node = nodes.get(current);
    if (!node) break;
    out.push(node);
    current = node.parent_team_id;
  }
  return out;
}

interface AssignmentRow {
  team_id: string;
  user_id: string;
  slug: string;
  name: string;
  color: string | null;
}

/** Fetch every group assignment for the given (team, user) space in as few
 *  round-trips as the bind limit allows. */
async function loadAssignments(
  db: D1Database,
  teamIds: string[],
  restrict: { userId: string } | { memberOfTeamId: string },
): Promise<AssignmentRow[]> {
  const out: AssignmentRow[] = [];
  for (const group of chunk([...new Set(teamIds)], BIND_CHUNK)) {
    const placeholders = group.map(() => "?").join(", ");
    const where =
      "userId" in restrict
        ? "tmg.user_id = ?"
        : // Only members of the team being read — an ancestor's own members
          // are not silently pulled into a descendant's listing.
          "tmg.user_id IN (SELECT user_id FROM team_members WHERE team_id = ?)";
    const bindTail =
      "userId" in restrict ? restrict.userId : restrict.memberOfTeamId;
    const { results } = await db
      .prepare(
        `SELECT tmg.team_id, tmg.user_id, g.slug, g.name, g.color
           FROM team_member_groups tmg
           JOIN team_groups g ON g.id = tmg.group_id
          WHERE tmg.team_id IN (${placeholders}) AND ${where}
          ORDER BY g.name ASC`,
      )
      .bind(...group, bindTail)
      .all<AssignmentRow>();
    out.push(...results);
  }
  return out;
}

/**
 * Collapse raw assignments into the resolved list for one team.
 *
 * On slug collision the *closest* definition wins: the team being read first,
 * then each ancestor by distance. Two teams in one chain may both define
 * `oncall`, and the nearer one is the more specific answer.
 *
 * Proximity has to drive this explicitly. Falling back to whatever order the
 * rows arrived in would tie the winner to the SQL sort — which is by display
 * name, so renaming an unrelated group could silently flip which team a label
 * is attributed to. Deduping also keeps the claim array free of repeats.
 */
function collapse(
  teamId: string,
  ancestorIds: string[],
  rows: AssignmentRow[],
): ResolvedGroup[] {
  // Distance from the team being read: 0 = direct, 1 = parent, 2 = grandparent…
  const distance = new Map<string, number>([[teamId, 0]]);
  ancestorIds.forEach((id, i) => distance.set(id, i + 1));

  const bySlug = new Map<string, RankedGroup>();
  for (const row of rows) {
    // Skip rows belonging to some other team's chain — loadAssignments fetches
    // the union across every team being resolved in one pass.
    const d = distance.get(row.team_id);
    if (d === undefined) continue;
    const seen = bySlug.get(row.slug);
    if (seen && seen.distance <= d) continue;
    bySlug.set(row.slug, {
      slug: row.slug,
      name: row.name,
      color: row.color,
      inherited_from: d === 0 ? null : row.team_id,
      distance: d,
    });
  }
  // Rebuild explicitly so `distance` — an internal tie-break aid — never
  // reaches the wire.
  return [...bySlug.values()]
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((g) => ({
      slug: g.slug,
      name: g.name,
      color: g.color,
      inherited_from: g.inherited_from,
    }));
}

/** Shared setup for both resolution entry points. Returns null when groups
 *  are off for every requested team, letting callers skip the work. */
async function planResolution(
  db: D1Database,
  teamIds: string[],
): Promise<{
  chains: Map<string, string[]>;
  lookupTeamIds: string[];
} | null> {
  if (teamIds.length === 0) return null;
  const [maxDepth, inherit] = await Promise.all([
    getConfigValue(db, "max_team_depth"),
    getConfigValue(db, "inherit_team_membership"),
  ]);
  const nodes = await loadTeamChains(db, teamIds, maxDepth);

  const chains = new Map<string, string[]>();
  const lookup = new Set<string>();
  for (const teamId of new Set(teamIds)) {
    const self = nodes.get(teamId);
    // A team with groups switched off emits nothing at all — not even
    // labels inherited from an ancestor that still has them on.
    if (!self || self.enable_groups !== 1) continue;
    // Group inheritance rides on the same switch as role inheritance: when
    // ancestors and descendants are decoupled for membership, labels must
    // not keep flowing across that same boundary.
    const ancestorIds = inherit
      ? ancestorsOf(teamId, nodes)
          // An ancestor that turned groups off contributes nothing, otherwise
          // its labels would leak out through its children.
          .filter((a) => a.enable_groups === 1)
          .map((a) => a.id)
      : [];
    chains.set(teamId, ancestorIds);
    lookup.add(teamId);
    for (const id of ancestorIds) lookup.add(id);
  }
  if (chains.size === 0) return null;
  return { chains, lookupTeamIds: [...lookup] };
}

/**
 * Groups for every direct member of `teamId`, keyed by user id.
 *
 * Returns an empty map when the team has groups disabled. Members with no
 * labels are simply absent from the map — callers should default to `[]`.
 */
export async function getGroupsForTeamMembers(
  db: D1Database,
  teamId: string,
): Promise<Map<string, ResolvedGroup[]>> {
  const plan = await planResolution(db, [teamId]);
  const out = new Map<string, ResolvedGroup[]>();
  if (!plan) return out;

  const rows = await loadAssignments(db, plan.lookupTeamIds, {
    memberOfTeamId: teamId,
  });
  const ancestorIds = plan.chains.get(teamId) ?? [];

  const byUser = new Map<string, AssignmentRow[]>();
  for (const row of rows) {
    const list = byUser.get(row.user_id);
    if (list) list.push(row);
    else byUser.set(row.user_id, [row]);
  }
  for (const [userId, userRows] of byUser) {
    const resolved = collapse(teamId, ancestorIds, userRows);
    if (resolved.length > 0) out.set(userId, resolved);
  }
  return out;
}

/**
 * Groups one user holds, keyed by team id — the shape the OIDC claims and
 * the OAuth member-profile endpoint need.
 *
 * Teams with groups disabled are omitted from the result entirely.
 */
export async function getGroupsForUserByTeam(
  db: D1Database,
  userId: string,
  teamIds: string[],
): Promise<Map<string, ResolvedGroup[]>> {
  const out = new Map<string, ResolvedGroup[]>();
  const plan = await planResolution(db, teamIds);
  if (!plan) return out;

  const rows = await loadAssignments(db, plan.lookupTeamIds, { userId });
  if (rows.length === 0) return out;

  for (const [teamId, ancestorIds] of plan.chains) {
    const resolved = collapse(teamId, ancestorIds, rows);
    if (resolved.length > 0) out.set(teamId, resolved);
  }
  return out;
}

/** Convenience wrapper for a single (team, user) pair. */
export async function getMemberGroups(
  db: D1Database,
  teamId: string,
  userId: string,
): Promise<ResolvedGroup[]> {
  const byTeam = await getGroupsForUserByTeam(db, userId, [teamId]);
  return byTeam.get(teamId) ?? [];
}

// ─── Definition reads ────────────────────────────────────────────────────────

/** All group definitions on a team, regardless of `enable_groups` — the
 *  management UI still needs to list them while the feature is switched off
 *  so an owner can see what re-enabling would restore. Read surfaces must
 *  use the resolution helpers above instead. */
export async function listTeamGroups(
  db: D1Database,
  teamId: string,
): Promise<TeamGroupRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM team_groups WHERE team_id = ? ORDER BY name ASC")
    .bind(teamId)
    .all<TeamGroupRow>();
  return results;
}

/** Serialize a definition for the wire — SQLite 0/1/NULL becomes a real
 *  tri-state boolean, matching how team rows are normalised. */
export function serializeTeamGroup(row: TeamGroupRow) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    color: row.color,
    admin_assignable:
      row.admin_assignable === null ? null : row.admin_assignable === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** The effective capability set for a team, flattened for the client so the
 *  UI can grey out what the viewer cannot do without re-deriving the chain. */
export function effectiveCapabilities(
  teamPermissionsRaw: string | null,
  siteDefaults: TeamRolePermissions,
): Record<TeamCapability, boolean> {
  const parsed = parseRolePermissions(teamPermissionsRaw);
  const out = {} as Record<TeamCapability, boolean>;
  for (const capability of Object.keys(
    TEAM_CAPABILITY_DEFAULTS,
  ) as TeamCapability[]) {
    out[capability] = resolveAdminCapability(capability, parsed, siteDefaults);
  }
  return out;
}
