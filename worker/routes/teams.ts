// Team management — collaborative app ownership

import { Hono } from "hono";
import { randomId, randomBase64url } from "../lib/crypto";
import { encryptSecret, hashLookupCandidate } from "../lib/secretCrypto";
import { requireAuth, optionalAuth } from "../middleware/auth";
import { computeIsVerified } from "../lib/domainVerify";
import { getConfigValue } from "../lib/config";
import { validateImageUrl } from "../lib/imageValidation";
import {
  proxyImageUrl,
  sweepOrphanedImageProxyMappings,
} from "../lib/proxyImage";
import { isAllowedScope } from "../lib/scopes";
import {
  parseRedirectUris,
  validateRedirectUriEntry,
  type RedirectUriEntry,
} from "../lib/redirectUri";

import { readPage, likePattern } from "../lib/pagination";
import {
  deliverUserEmailNotifications,
  notificationActorMetaFromHeaders,
} from "../lib/notifications";
import type { OAuthAppRow, TeamRow, Variables } from "../types";
import {
  getEffectiveTeamRequirements,
  getSiteRequirementFloor,
  getUserSecurityState,
  mergeWithSiteFloor,
  unmetRequirements,
} from "../lib/teamRequirements";
import { isTeamLocked } from "../lib/lockdown";
import {
  checkTeamJoinAllowed,
  getRestrictionState,
  guardCapability,
  hasLiveRestrictedAccounts,
  isRestricted,
  subtreeHasRestrictedMembers,
} from "../lib/userCapabilities";
import {
  getGroupChainIds,
  MAX_GROUPS_PER_MEMBER,
  getGroupsForTeamMembers,
  parseRolePermissions,
  sanitizeRolePermissions,
} from "../lib/teamGroups";

import { loadInviteGroups, type InviteRow } from "../lib/inviteManagement";
import {
  ROLE_RANK,
  actorFor,
  dissolveTeam,
  getDescendantTeamIds,
  getMaxTeamDepth,
  getMember,
  getTeamAncestors,
  hasRole,
  isInvalidReparent,
  isSiteAdmin,
  teamAuthority,
  teamUserSyntheticEmail,
  teamUserSyntheticUsername,
  auditTeam,
} from "../lib/teams";
import teamDomainRoutes from "./teams-domains";
import teamGroupRoutes from "./teams-groups";
import teamInviteRoutes from "./teams-invites";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

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
    invite_registration_granted: toBool(team.invite_registration_granted),
    // null = the site default. Optional: absent until migration 0082 runs.
    invite_registration_allow_convert:
      team.invite_registration_allow_convert == null
        ? null
        : team.invite_registration_allow_convert === 1,
    invite_registration_exemptions: team.invite_registration_exemptions
      ? (JSON.parse(team.invite_registration_exemptions) as unknown)
      : {},
    allow_normal_user_join: toBool(team.allow_normal_user_join),
    restrict_member_list_for_members: toBool(
      team.restrict_member_list_for_members,
    ),
    dissolving_at: team.dissolving_at,
    // Send the parsed overrides, not the raw blob — the client shouldn't
    // have to know the storage format to render the settings toggles.
    role_permissions: parseRolePermissions(team.role_permissions),
  };
}

// ─── Public invite join routes (BEFORE global auth middleware) ────────────────

// GET /join/:token — public: show invite info
app.get("/join/:token", optionalAuth, async (c) => {
  const token = c.req.param("token");
  const now = Math.floor(Date.now() / 1000);

  const tokenLookup = await hashLookupCandidate(c.env, token);
  if (!tokenLookup) return c.json({ error: "invite_invalid_or_expired" }, 404);
  const invite = await c.env.DB.prepare(
    "SELECT * FROM team_invites WHERE (token = ? OR token = ?) AND expires_at > ? AND enabled = 1",
  )
    .bind(token, tokenLookup, now)
    .first<InviteRow>();

  if (!invite) return c.json({ error: "invite_invalid_or_expired" }, 404);
  if (invite.max_uses > 0 && invite.uses >= invite.max_uses)
    return c.json({ error: "invite_used_up" }, 410);

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
  if (!team) return c.json({ error: "team_not_found" }, 404);

  const floor = await getSiteRequirementFloor(c.env.DB);
  const effective = mergeWithSiteFloor(team, floor);

  const sessionUser = c.get("user") ?? null;
  let alreadyMember = false;
  let canApplyGroups = false;
  let unmet: ReturnType<typeof unmetRequirements> = [];
  if (sessionUser) {
    const existing = await getMember(c.env.DB, team.id, sessionUser.id);
    alreadyMember = !!existing;
    if (!alreadyMember) {
      const state = await getUserSecurityState(c.env.DB, sessionUser.id);
      unmet = unmetRequirements(effective, state);
    }
  }

  const inviteGroups = await loadInviteGroups(c.env.DB, [invite.token]);
  const groups = inviteGroups.get(invite.token) ?? [];
  if (sessionUser && alreadyMember && invite.allow_existing_members === 1) {
    const assigned = groups.length
      ? await c.env.DB.prepare(
          `SELECT group_id FROM team_member_groups
            WHERE team_id = ? AND user_id = ? AND group_id IN (${groups.map(() => "?").join(", ")})`,
        )
          .bind(team.id, sessionUser.id, ...groups.map((group) => group.id))
          .all<{ group_id: string }>()
      : { results: [] as Array<{ group_id: string }> };
    const assignedIds = new Set(assigned.results.map((row) => row.group_id));
    canApplyGroups = groups.some((group) => !assignedIds.has(group.id));
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
    groups,
    allow_existing_members: invite.allow_existing_members === 1,
    can_apply_groups: canApplyGroups,
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
  if (!tokenLookup) return c.json({ error: "invite_invalid_or_expired" }, 404);
  const invite = await c.env.DB.prepare(
    "SELECT * FROM team_invites WHERE (token = ? OR token = ?) AND expires_at > ? AND enabled = 1",
  )
    .bind(token, tokenLookup, now)
    .first<InviteRow>();

  if (!invite) return c.json({ error: "invite_invalid_or_expired" }, 404);
  if (invite.max_uses > 0 && invite.uses >= invite.max_uses)
    return c.json({ error: "invite_used_up" }, 410);
  // Email-specific invites can only be used by the addressed user
  if (invite.email && invite.email.toLowerCase() !== user.email.toLowerCase())
    return c.json({ error: "invite_email_mismatch" }, 403);

  const existing = await getMember(c.env.DB, invite.team_id, user.id);
  const invitedGroups = await loadInviteGroups(c.env.DB, [invite.token]);
  let groupIds = (invitedGroups.get(invite.token) ?? []).map((g) => g.id);
  if (
    existing &&
    (groupIds.length === 0 || invite.allow_existing_members !== 1)
  )
    return c.json({ error: "already_member" }, 409);
  if (existing) {
    const count = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM team_member_groups WHERE team_id = ? AND user_id = ?",
    )
      .bind(invite.team_id, user.id)
      .first<{ n: number }>();
    const placeholders = groupIds.map(() => "?").join(", ");
    const assigned = await c.env.DB.prepare(
      `SELECT group_id FROM team_member_groups
        WHERE team_id = ? AND user_id = ? AND group_id IN (${placeholders})`,
    )
      .bind(invite.team_id, user.id, ...groupIds)
      .all<{ group_id: string }>();
    const assignedIds = new Set(assigned.results.map((row) => row.group_id));
    groupIds = groupIds.filter((groupId) => !assignedIds.has(groupId));
    if (groupIds.length === 0)
      return c.json({ error: "invite_groups_already_held" }, 409);
    if ((count?.n ?? 0) + groupIds.length > MAX_GROUPS_PER_MEMBER)
      return c.json(
        { error: "member_group_limit", params: { max: MAX_GROUPS_PER_MEMBER } },
        400,
      );
  }

  if (!existing) {
    const joinState = await getRestrictionState(c.env.DB, user.id);
    if (joinState) {
      const joinErr = await checkTeamJoinAllowed(
        c.env.DB,
        joinState,
        invite.team_id,
      );
      if (joinErr) return c.json({ error: joinErr }, 403);
      // A team may decline unrestricted members entirely — used by teams whose
      // population is meant to be uniformly invite-registered. Direct adds by
      // an admin deliberately bypass this, so hiring staff still works.
      if (!isRestricted(joinState)) {
        const target = await c.env.DB.prepare(
          "SELECT allow_normal_user_join FROM teams WHERE id = ?",
        )
          .bind(invite.team_id)
          .first<{ allow_normal_user_join: number }>();
        if (target && target.allow_normal_user_join !== 1)
          return c.json(
            {
              error: "invite_existing_not_allowed",
            },
            403,
          );
      }
    }

    const teamReq = await getEffectiveTeamRequirements(
      c.env.DB,
      invite.team_id,
    );
    if (teamReq) {
      const state = await getUserSecurityState(c.env.DB, user.id);
      const unmet = unmetRequirements(teamReq, state);
      if (unmet.length) {
        return c.json(
          {
            error: "join_requirements_unmet",
            unmet_requirements: unmet,
          },
          403,
        );
      }
    }
  }

  const claim = await c.env.DB.prepare(
    `UPDATE team_invites SET uses = uses + 1
      WHERE token = ? AND expires_at > ? AND enabled = 1
        AND (max_uses = 0 OR uses < max_uses)`,
  )
    .bind(invite.token, now)
    .run();
  if (!claim.meta.changes) return c.json({ error: "invite_used_up" }, 410);

  try {
    if (existing) {
      for (const groupId of groupIds) {
        await c.env.DB.prepare(
          "INSERT INTO team_member_groups (team_id, user_id, group_id, assigned_at) VALUES (?, ?, ?, ?)",
        )
          .bind(invite.team_id, user.id, groupId, now)
          .run();
      }
    } else {
      await c.env.DB.batch([
        c.env.DB.prepare(
          "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)",
        ).bind(invite.team_id, user.id, invite.role, now),
        ...groupIds.map((groupId) =>
          c.env.DB.prepare(
            "INSERT INTO team_member_groups (team_id, user_id, group_id, assigned_at) VALUES (?, ?, ?, ?)",
          ).bind(invite.team_id, user.id, groupId, now),
        ),
      ]);
    }
  } catch (error) {
    await c.env.DB.prepare(
      "UPDATE team_invites SET uses = uses - 1 WHERE token = ? AND uses > 0",
    )
      .bind(invite.token)
      .run()
      .catch(() => {});
    throw error;
  }

  auditTeam(
    c,
    invite.team_id,
    existing ? "team.member.groups_change" : "team.member.add",
    {
      resourceType: "user",
      resourceId: user.id,
      resourceName: `@${user.username}`,
      metadata: existing
        ? { added: groupIds, removed: [], via: "invite" }
        : { role: invite.role, member_groups: groupIds, via: "invite" },
    },
  );

  return c.json({
    team_id: invite.team_id,
  });
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
  const { page, limit, offset } = readPage(
    c.req.query("page"),
    c.req.query("limit"),
    20,
  );
  const query = c.req.query("q")?.trim() ?? "";

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

  // Search + paginate over the fully-expanded (direct ∪ inherited) set.
  // The expansion must stay whole — an inherited entry can outrank a direct
  // one, so slicing before merging would produce wrong roles.
  const ql = query.toLowerCase();
  const entries = Array.from(collected.values()).filter(
    (e) => !ql || e.team.name.toLowerCase().includes(ql),
  );
  const pageEntries = entries.slice(offset, offset + limit);

  return c.json({
    teams: await Promise.all(
      pageEntries.map(async (entry) => ({
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
    total: entries.length,
    page,
    limit,
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
  if (!member) return c.json({ error: "not_team_member" }, 404);

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
    /** Site admins only — stand the team up under someone else's name. */
    owner_id?: string;
    owner_username?: string;
  }>();
  if (!body.name?.trim())
    return c.json({ error: "field_required", params: { field: "name" } }, 400);

  // Parent validation — sub-team creation requires admin+ on the parent.
  // Top-level creation respects the site-wide disable toggle.
  let parentId: string | null = null;
  if (body.parent_team_id) {
    const enabled = await getConfigValue(c.env.DB, "enable_sub_teams");
    if (!enabled) return c.json({ error: "subteams_disabled" }, 403);
    const parentRow = await c.env.DB.prepare(
      "SELECT id FROM teams WHERE id = ?",
    )
      .bind(body.parent_team_id)
      .first<{ id: string }>();
    if (!parentRow) return c.json({ error: "parent_team_not_found" }, 404);
    const eff = await teamAuthority(c, body.parent_team_id);
    if (!eff || !hasRole(eff.role, "admin"))
      return c.json({ error: "parent_team_admin_required" }, 403);
    const maxDepth = await getMaxTeamDepth(c.env.DB);
    const ancestors = await getTeamAncestors(c.env.DB, body.parent_team_id);
    if (ancestors.length >= maxDepth)
      return c.json(
        { error: "team_depth_limit", params: { max: maxDepth } },
        400,
      );
    parentId = body.parent_team_id;
  } else if (user.role !== "admin") {
    const disabled = await getConfigValue(c.env.DB, "disable_user_create_team");
    if (disabled) return c.json({ error: "team_creation_disabled" }, 403);
  }

  // Restricted accounts create nothing by default — including sub-teams,
  // which the branch above would otherwise wave through on the strength of
  // an ancestor membership.
  const capErr = await guardCapability(c.env.DB, user.id, "team:create");
  if (capErr) return c.json({ error: capErr }, 403);

  // A site admin provisioning a team for someone else shouldn't end up owning
  // it — the admin panel names the owner up front and the admin keeps only
  // the site-wide authority they already had.
  let ownerId = user.id;
  if (body.owner_id || body.owner_username) {
    if (!isSiteAdmin(c)) return c.json({ error: "admin_required" }, 403);
    const owner = await c.env.DB.prepare(
      "SELECT id FROM users WHERE kind = 'user' AND (id = ? OR username = ?)",
    )
      .bind(body.owner_id ?? "", body.owner_username ?? "")
      .first<{ id: string }>();
    if (!owner) return c.json({ error: "user_not_found" }, 404);
    ownerId = owner.id;
  }

  if (body.avatar_url) {
    const imgErr = await validateImageUrl(body.avatar_url);
    if (imgErr) return c.json(imgErr, 400);
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
    ).bind(id, ownerId, now),
  ]);

  const team = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ?")
    .bind(id)
    .first<TeamRow>();

  auditTeam(c, id, "team.create", {
    resourceName: body.name.trim(),
    metadata: {
      parent_team_id: parentId,
      ...(ownerId === user.id ? {} : { owner_id: ownerId }),
    },
  });

  return c.json({ team: { ...serializeTeamRow(team!), role: "owner" } }, 201);
});

// List immediate sub-teams of a parent team.
// Members of an ancestor team (inherited or direct) may list.
app.get("/:id/sub-teams", async (c) => {
  const id = c.req.param("id");

  const enabled = await getConfigValue(c.env.DB, "enable_sub_teams");
  if (!enabled) return c.json({ error: "subteams_disabled" }, 403);

  const eff = await teamAuthority(c, id);
  if (!eff) return c.json({ error: "not_found" }, 404);

  const { page, limit, offset } = readPage(
    c.req.query("page"),
    c.req.query("limit"),
    20,
  );
  const query = c.req.query("q")?.trim() ?? "";

  const where = query
    ? "t.parent_team_id = ? AND LOWER(t.name) LIKE LOWER(?) ESCAPE '\\'"
    : "t.parent_team_id = ?";
  const args: unknown[] = query ? [id, likePattern(query)] : [id];

  const [subs, countRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT t.*, (
         SELECT COUNT(*) FROM team_members WHERE team_id = t.id
       ) AS member_count
       FROM teams t WHERE ${where}
       ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(...args, limit, offset)
      .all<TeamRow & { member_count: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM teams t WHERE ${where}`)
      .bind(...args)
      .first<{ n: number }>(),
  ]);

  return c.json({
    sub_teams: await Promise.all(
      subs.results.map(async (t) => ({
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
    total: countRow?.n ?? 0,
    page,
    limit,
  });
});

// Create a sub-team under :id. Convenience alias for
// POST / with parent_team_id — body is the same as POST /.
app.post("/:id/sub-teams", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const enabled = await getConfigValue(c.env.DB, "enable_sub_teams");
  if (!enabled) return c.json({ error: "subteams_disabled" }, 403);

  const body = await c.req.json<{
    name: string;
    description?: string;
    avatar_url?: string;
  }>();
  if (!body.name?.trim())
    return c.json({ error: "field_required", params: { field: "name" } }, 400);

  const parentRow = await c.env.DB.prepare("SELECT id FROM teams WHERE id = ?")
    .bind(id)
    .first<{ id: string }>();
  if (!parentRow) return c.json({ error: "parent_team_not_found" }, 404);
  const eff = await teamAuthority(c, id);
  if (!eff || !hasRole(eff.role, "admin"))
    return c.json({ error: "parent_team_admin_required" }, 403);
  const maxDepth = await getMaxTeamDepth(c.env.DB);
  const ancestors = await getTeamAncestors(c.env.DB, id);
  if (ancestors.length >= maxDepth)
    return c.json(
      { error: "team_depth_limit", params: { max: maxDepth } },
      400,
    );

  if (body.avatar_url) {
    const imgErr = await validateImageUrl(body.avatar_url);
    if (imgErr) return c.json(imgErr, 400);
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
  const id = c.req.param("id");

  const eff = await teamAuthority(c, id);
  if (!eff) return c.json({ error: "not_found" }, 404);

  const team = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ?")
    .bind(id)
    .first<TeamRow>();
  if (!team) return c.json({ error: "not_found" }, 404);

  const viewerUserId =
    team.restrict_member_list_for_members === 1 &&
    eff.role === "member" &&
    !eff.elevated
      ? actorFor(c).id
      : undefined;

  // First page only. This used to return every member, which made the team
  // page's cost grow without bound with the roster — the table pages through
  // GET /:id/members from here on. Sub-teams are likewise capped to a page
  // (the tab pages through GET /:id/sub-teams); `sub_team_count` carries the
  // real total for the tab badge.
  const [memberPage, ancestors, subTeamPage] = await Promise.all([
    listTeamMembers(c.env.DB, c.env.APP_URL, id, {
      page: 1,
      limit: MEMBER_PAGE_SIZE,
      visibleToUserId: viewerUserId,
    }),
    getTeamAncestors(c.env.DB, id),
    c.env.DB.prepare(
      `SELECT t.id, t.name, t.avatar_url, (
         SELECT COUNT(*) FROM team_members WHERE team_id = t.id
       ) AS member_count
       FROM teams t WHERE t.parent_team_id = ?
       ORDER BY t.created_at DESC LIMIT ?`,
    )
      .bind(id, TEAM_PAGE_SIZE)
      .all<{
        id: string;
        name: string;
        avatar_url: string | null;
        member_count: number;
      }>(),
  ]);

  // ancestors[0] is the team itself — slice it off and rewrite avatars.
  const ancestorChain = await Promise.all(
    ancestors.slice(1).map(async (a) => ({
      id: a.id,
      name: a.name,
      avatar_url: await proxyImageUrl(c.env.APP_URL, c.env.DB, a.avatar_url),
    })),
  );

  const subTeamCountRow = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM teams WHERE parent_team_id = ?",
  )
    .bind(id)
    .first<{ n: number }>();

  return c.json({
    team: {
      ...serializeTeamRow(team),
      avatar_url: await proxyImageUrl(c.env.APP_URL, c.env.DB, team.avatar_url),
      unproxied_avatar_url: team.avatar_url,
      my_role: eff.role,
      inherited_from: eff.inherited_from,
      // The page is being viewed through the site-admin override rather than
      // a membership — the UI says so instead of impersonating an owner.
      site_admin_access: eff.elevated,
      // The role the viewer would hold with the override dropped — drives
      // whether the banner offers a "switch to normal view" that leads
      // anywhere (null = not a member, so there is nothing to switch to).
      my_member_role: eff.member_role,
      ancestors: ancestorChain,
      sub_teams: await Promise.all(
        subTeamPage.results.map(async (s) => ({
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
      sub_team_count: subTeamCountRow?.n ?? 0,
    },
    members: memberPage.members,
    // Total across the whole team, not the page — the members tab shows it,
    // and a count that shrank to the page size would just look wrong.
    member_count: memberPage.total,
    member_page: { page: memberPage.page, limit: memberPage.limit },
  });
});

// Update team
app.patch("/:id", async (c) => {
  const id = c.req.param("id");

  const eff = await teamAuthority(c, id);
  if (!eff) return c.json({ error: "not_found" }, 404);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "forbidden" }, 403);
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
    allow_normal_user_join?: boolean;
    restrict_member_list_for_members?: boolean;
  }>();

  if (body.avatar_url) {
    const imgErr = await validateImageUrl(body.avatar_url);
    if (imgErr) return c.json(imgErr, 400);
  }

  const team = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ?")
    .bind(id)
    .first<TeamRow>();
  if (!team) return c.json({ error: "not_found" }, 404);

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
    if (!enabled) return c.json({ error: "subteams_disabled" }, 403);
    // Moving a team. Owner-only (the team's own owner, direct or inherited)
    // because re-parenting redistributes inherited access across the whole
    // organisation tree.
    if (!hasRole(member.role, "owner"))
      return c.json({ error: "team_owner_required" }, 403);
    const reason = await isInvalidReparent(c.env.DB, id, body.parent_team_id);
    if (reason) return c.json(reason, 400);
    // Moving a subtree that contains restricted members would strand them
    // outside their own origin team — every individual step legal, the
    // invariant broken retroactively. Tested on *members*, because a
    // restricted user's origin is the top team, so a sub-team they joined
    // would report no accounts of its own.
    const descendants = await getDescendantTeamIds(c.env.DB, id);
    if (await subtreeHasRestrictedMembers(c.env.DB, id, descendants))
      return c.json(
        {
          error: "team_has_restricted_members",
        },
        403,
      );
    if (body.parent_team_id) {
      const parentEff = await teamAuthority(c, body.parent_team_id);
      if (!parentEff || !hasRole(parentEff.role, "admin"))
        return c.json({ error: "parent_team_admin_required" }, 403);
    }
    updates.push("parent_team_id = ?");
    values.push(body.parent_team_id);
  }
  if (body.require_2fa !== undefined) {
    if (!hasRole(member.role, "owner"))
      return c.json({ error: "team_owner_required" }, 403);
    updates.push("require_2fa = ?");
    values.push(body.require_2fa ? 1 : 0);
  }
  if (body.require_verified_email !== undefined) {
    if (!hasRole(member.role, "owner"))
      return c.json({ error: "team_owner_required" }, 403);
    updates.push("require_verified_email = ?");
    values.push(body.require_verified_email ? 1 : 0);
  }
  if (body.enable_groups !== undefined) {
    if (!hasRole(member.role, "owner"))
      return c.json({ error: "team_owner_required" }, 403);
    updates.push("enable_groups = ?");
    values.push(body.enable_groups ? 1 : 0);
  }
  if (body.role_permissions !== undefined) {
    // Owner-only, and deliberately not merely "admin+": a capability set the
    // constrained role could edit would be no constraint at all — an admin
    // would simply grant themselves whatever the owner withheld.
    if (!hasRole(member.role, "owner"))
      return c.json({ error: "team_owner_required" }, 403);
    const cleaned = sanitizeRolePermissions(body.role_permissions);
    updates.push("role_permissions = ?");
    // Store NULL rather than "{}" when nothing is overridden, so the column
    // reads as "follows the site default" instead of "explicitly empty".
    values.push(
      Object.keys(cleaned).length === 0 ? null : JSON.stringify(cleaned),
    );
  }
  if (body.allow_normal_user_join !== undefined) {
    if (!hasRole(member.role, "admin"))
      return c.json({ error: "forbidden" }, 403);
    updates.push("allow_normal_user_join = ?");
    values.push(body.allow_normal_user_join ? 1 : 0);
  }
  if (body.restrict_member_list_for_members !== undefined) {
    if (!hasRole(member.role, "co-owner"))
      return c.json(
        {
          error: "team_owners_required",
        },
        403,
      );
    updates.push("restrict_member_list_for_members = ?");
    values.push(body.restrict_member_list_for_members ? 1 : 0);
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

  const eff = await teamAuthority(c, id);
  if (!eff) return c.json({ error: "not_found" }, 404);
  if (!hasRole(eff.role, "owner"))
    return c.json({ error: "team_owner_required" }, 403);

  const teamRow = await c.env.DB.prepare("SELECT name FROM teams WHERE id = ?")
    .bind(id)
    .first<{ name: string }>();
  if (teamRow && isTeamLocked(c.env, teamRow.name)) {
    return c.json({ error: "team_locked" }, 403);
  }

  // Dissolving a team that minted accounts destroys those accounts. That is
  // a site-admin decision, taken through the staged flow — not something an
  // owner can trigger from here.
  //
  // Keyed on whether live restricted accounts exist, never on the invite
  // registration switch: otherwise an owner could flip the switch off and
  // walk straight through this check with thousands of accounts still
  // anchored to the team.
  if (await hasLiveRestrictedAccounts(c.env.DB, id))
    return c.json(
      {
        error: "team_dissolve_admin_only",
      },
      403,
    );

  auditTeam(c, id, "team.delete");

  await dissolveTeam(c.env.DB, id, user.id);

  // Team avatar + every member-app icon may now be unreferenced — sweep.
  c.executionCtx.waitUntil(
    sweepOrphanedImageProxyMappings(c.env.DB).catch(() => {}),
  );

  return c.json({ ok: true });
});

// ─── Member listing ───────────────────────────────────────────────────────────

/** Rows returned per member page. The team detail response embeds the first
 *  page so the initial render still needs one request; the table pages and
 *  filters through GET /:id/members from then on. */
const MEMBER_PAGE_SIZE = 50;

/** Sub-teams embedded in the team detail response. The tab pages through
 *  GET /:id/sub-teams from then on. */
const TEAM_PAGE_SIZE = 20;

interface MemberListOptions {
  page: number;
  limit: number;
  /** Matches display name or username, case-insensitively. */
  query?: string;
  /** Group slug. Resolved across the inheritance chain, so a label held via
   *  an ancestor team filters here exactly as it displays. */
  group?: string;
  /** When member list hiding is active for a regular member viewer, only
   *  owner/co-owner/admin and this user id are visible. */
  visibleToUserId?: string;
}

/**
 * One page of a team's direct members, with their resolved groups.
 *
 * Filtering happens in SQL rather than over a fully-loaded roster: the whole
 * point of paginating is to stop reading every member row, so a filter that
 * needed them all would give the page size back with one hand and take the
 * saving with the other.
 */
async function listTeamMembers(
  db: D1Database,
  appUrl: string,
  teamId: string,
  opts: MemberListOptions,
): Promise<{
  members: Array<Record<string, unknown>>;
  total: number;
  page: number;
  limit: number;
}> {
  const rowsWhere: string[] = ["tm.team_id = ?"];
  const rowsArgs: unknown[] = [teamId];

  const countWhere: string[] = ["tm.team_id = ?"];
  const countArgs: unknown[] = [teamId];

  if (opts.visibleToUserId !== undefined) {
    rowsWhere.push(
      "(tm.role IN ('owner', 'co-owner', 'admin') OR tm.user_id = ?)",
    );
    rowsArgs.push(opts.visibleToUserId);
  }

  if (opts.query) {
    // LIKE with an escaped pattern — the input is user-supplied and % or _
    // would otherwise silently widen the match.
    const pattern = likePattern(opts.query);
    const queryCond =
      "(LOWER(u.display_name) LIKE LOWER(?) ESCAPE '\\' OR LOWER(u.username) LIKE LOWER(?) ESCAPE '\\')";
    rowsWhere.push(queryCond);
    rowsArgs.push(pattern, pattern);
    countWhere.push(queryCond);
    countArgs.push(pattern, pattern);
  }

  if (opts.group) {
    // Inherited labels have to filter too, and inheritance is exactly
    // "assignments anywhere in the enabled chain" — so the chain becomes an
    // IN list rather than something resolved per member in JS.
    const chain = await getGroupChainIds(db, teamId);
    if (!chain) {
      // Groups are off for this team: no member can hold one.
      return { members: [], total: 0, page: opts.page, limit: opts.limit };
    }
    const placeholders = chain.map(() => "?").join(", ");
    const groupCond = `EXISTS (
         SELECT 1 FROM team_member_groups tmg
           JOIN team_groups g ON g.id = tmg.group_id
          WHERE tmg.user_id = tm.user_id
            AND tmg.team_id IN (${placeholders})
            AND g.slug = ?
       )`;
    rowsWhere.push(groupCond);
    rowsArgs.push(...chain, opts.group);
    countWhere.push(groupCond);
    countArgs.push(...chain, opts.group);
  }

  const rowsClause = rowsWhere.join(" AND ");
  const countClause = countWhere.join(" AND ");
  const offset = (opts.page - 1) * opts.limit;

  const [rows, countRow] = await Promise.all([
    db
      .prepare(
        `SELECT tm.user_id, tm.role, tm.joined_at,
                u.username, u.display_name, u.avatar_url
           FROM team_members tm JOIN users u ON u.id = tm.user_id
          WHERE ${rowsClause}
          ORDER BY tm.joined_at ASC
          LIMIT ? OFFSET ?`,
      )
      .bind(...rowsArgs, opts.limit, offset)
      .all<{
        user_id: string;
        role: string;
        joined_at: number;
        username: string;
        display_name: string;
        avatar_url: string | null;
      }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n
           FROM team_members tm JOIN users u ON u.id = tm.user_id
          WHERE ${countClause}`,
      )
      .bind(...countArgs)
      .first<{ n: number }>(),
  ]);

  // Resolve groups for this page only — the whole-team variant would undo
  // the pagination it is being called from.
  const groups = await getGroupsForTeamMembers(
    db,
    teamId,
    rows.results.map((r) => r.user_id),
  );

  return {
    members: await Promise.all(
      rows.results.map(async (m) => ({
        ...m,
        avatar_url: await proxyImageUrl(appUrl, db, m.avatar_url),
        unproxied_avatar_url: m.avatar_url,
        groups: groups.get(m.user_id) ?? [],
      })),
    ),
    total: countRow?.n ?? 0,
    page: opts.page,
    limit: opts.limit,
  };
}

// ─── Members ─────────────────────────────────────────────────────────────────
// GET /:id/members — paginated, searchable member list.
//
// The team detail response carries the first page for the initial render;
// everything after that (paging, search, group filter) comes through here.
app.get("/:id/members", async (c) => {
  const id = c.req.param("id");

  const eff = await teamAuthority(c, id);
  if (!eff) return c.json({ error: "not_found" }, 404);

  const team = await c.env.DB.prepare(
    "SELECT restrict_member_list_for_members FROM teams WHERE id = ?",
  )
    .bind(id)
    .first<{ restrict_member_list_for_members: number }>();
  if (!team) return c.json({ error: "not_found" }, 404);

  const viewerUserId =
    team.restrict_member_list_for_members === 1 &&
    eff.role === "member" &&
    !eff.elevated
      ? actorFor(c).id
      : undefined;

  const { page, limit } = readPage(
    c.req.query("page"),
    c.req.query("limit"),
    MEMBER_PAGE_SIZE,
    100,
  );

  const result = await listTeamMembers(c.env.DB, c.env.APP_URL, id, {
    page,
    limit,
    // Capped: the term feeds two LIKEs over the member join, and an
    // unbounded string is a cheap way to make that expensive.
    query: c.req.query("q")?.trim().slice(0, 64) || undefined,
    group: c.req.query("group")?.trim() || undefined,
    visibleToUserId: viewerUserId,
  });

  return c.json(result);
});

// Add member by username
app.post("/:id/members", async (c) => {
  const id = c.req.param("id");

  const eff = await teamAuthority(c, id);
  if (!eff) return c.json({ error: "not_found" }, 404);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "forbidden" }, 403);

  // `user_id` is what the admin panel has to hand; `username` is what the
  // team page's picker produces. Either identifies the account.
  const body = await c.req.json<{
    username?: string;
    user_id?: string;
    role?: string;
  }>();
  if (!body.username && !body.user_id)
    return c.json({ error: "user_required" }, 400);
  let role: string = "member";
  if (body.role === "admin") role = "admin";
  if (body.role === "co-owner" && eff.role === "owner") role = "co-owner";

  const target = await c.env.DB.prepare(
    "SELECT id, username FROM users WHERE kind = 'user' AND (id = ? OR username = ?)",
  )
    .bind(body.user_id ?? "", body.username ?? "")
    .first<{ id: string; username: string }>();
  if (!target) return c.json({ error: "user_not_found" }, 404);

  const existing = await getMember(c.env.DB, id, target.id);
  if (existing) return c.json({ error: "already_member" }, 409);

  // Both gates below are the *team's* policy about who may join it. A site
  // admin adding someone is the site overruling that policy on purpose, so
  // the checks are skipped rather than failed — and what was skipped is
  // written into the audit entry, which is the part the team needs to see.
  const bypassed: string[] = [];

  // A restricted account may only ever belong inside its own origin team's
  // subtree — being *added* by another member is not an exception, or the
  // constraint would be one invitation away from meaningless.
  const targetState = await getRestrictionState(c.env.DB, target.id);
  if (targetState) {
    const joinErr = await checkTeamJoinAllowed(c.env.DB, targetState, id);
    if (joinErr) {
      if (!eff.elevated) return c.json({ error: joinErr }, 403);
      bypassed.push("restricted_account_scope");
    }
  }

  const teamReq = await getEffectiveTeamRequirements(c.env.DB, id);
  if (teamReq) {
    const state = await getUserSecurityState(c.env.DB, target.id);
    const unmet = unmetRequirements(teamReq, state);
    if (unmet.length) {
      if (!eff.elevated) {
        return c.json(
          {
            error: "join_requirements_unmet_user",
            unmet_requirements: unmet,
          },
          403,
        );
      }
      bypassed.push(...unmet);
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
    resourceName: `@${target.username}`,
    metadata: { role, ...(bypassed.length ? { bypassed } : {}) },
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

  return c.json({ ok: true }, 201);
});

app.patch("/:id/members/:userId", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const targetUserId = c.req.param("userId");

  const eff = await teamAuthority(c, id);
  if (!eff) return c.json({ error: "not_found" }, 404);
  if (!hasRole(eff.role, "co-owner"))
    return c.json({ error: "team_owners_required" }, 403);
  // A member cannot promote themselves; a site admin reaching in from outside
  // is not "themselves" in the team's sense, so the guard doesn't apply.
  if (targetUserId === user.id && !eff.elevated)
    return c.json({ error: "cannot_change_own_role" }, 400);

  const body = await c.req.json<{ role: string }>();
  // `owner` is admin-only, and means a transfer: a team has exactly one.
  const allowedRoles = eff.elevated
    ? ["owner", "co-owner", "admin", "member"]
    : ["co-owner", "admin", "member"];
  if (!allowedRoles.includes(body.role))
    return c.json(
      {
        error: "field_one_of",
        params: { field: "role", values: allowedRoles.join(", ") },
      },
      400,
    );

  // Target must be a *direct* member of this team — inherited memberships
  // are managed at the ancestor team they originate from.
  const target = await getMember(c.env.DB, id, targetUserId);
  if (!target) return c.json({ error: "member_not_found" }, 404);
  // A member cannot touch the owner's role — they transfer instead. A site
  // admin can, including straight down, which leaves the team without an
  // owner until someone is promoted.
  //
  // That state is deliberate rather than tolerated: nothing in the schema
  // requires an owner row, `dissolveTeam` already falls back to the acting
  // admin when reassigning apps, and the alternative — refusing, and telling
  // an administrator to promote someone they may not want promoted — is the
  // team owner outranking the site, which is backwards.
  if (target.role === "owner" && !eff.elevated)
    return c.json({ error: "cannot_change_owner_role" }, 403);
  if (target.role === "co-owner" && eff.role !== "owner")
    return c.json({ error: "team_owner_required" }, 403);
  if (body.role === "co-owner" && eff.role !== "owner")
    return c.json({ error: "team_owner_required" }, 403);

  const now = Math.floor(Date.now() / 1000);
  if (body.role === "owner") {
    // Same invariant the transfer endpoint enforces: a restricted account
    // must not end up owning the team that restricts it.
    const restriction = await getRestrictionState(c.env.DB, targetUserId);
    if (restriction && isRestricted(restriction))
      return c.json(
        {
          error: "transfer_to_restricted",
        },
        403,
      );
    const currentOwner = await c.env.DB.prepare(
      "SELECT user_id FROM team_members WHERE team_id = ? AND role = 'owner'",
    )
      .bind(id)
      .first<{ user_id: string }>();
    const statements = [
      c.env.DB.prepare(
        "UPDATE team_members SET role = 'owner' WHERE team_id = ? AND user_id = ?",
      ).bind(id, targetUserId),
    ];
    if (currentOwner)
      statements.push(
        c.env.DB.prepare(
          "UPDATE team_members SET role = 'co-owner' WHERE team_id = ? AND user_id = ?",
        ).bind(id, currentOwner.user_id),
      );
    statements.push(
      c.env.DB.prepare("UPDATE teams SET updated_at = ? WHERE id = ?").bind(
        now,
        id,
      ),
    );
    await c.env.DB.batch(statements);
    auditTeam(c, id, "team.ownership.transfer", {
      resourceType: "user",
      resourceId: targetUserId,
      metadata: { from: currentOwner?.user_id ?? null, to: targetUserId },
    });
    return c.json({ ok: true });
  }

  await c.env.DB.prepare(
    "UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?",
  )
    .bind(body.role, id, targetUserId)
    .run();

  auditTeam(c, id, "team.member.role_change", {
    resourceType: "user",
    resourceId: targetUserId,
    metadata: {
      from: target.role,
      to: body.role,
      // The team now has no owner. Worth its own field rather than something
      // to infer from `from: "owner"` — it is the fact a team reading its own
      // log needs to see, and the fact the admin list renders.
      ...(target.role === "owner" ? { owner_vacated: true } : {}),
    },
  });

  return c.json({
    // Said back, because an administrator who demoted the owner should not
    // have to go and notice.
    owner_vacated: target.role === "owner",
  });
});

// Remove member (owner/admin; cannot remove an owner). Self-leave requires
// direct membership — inherited members "leave" by leaving the ancestor.
app.delete("/:id/members/:userId", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const targetUserId = c.req.param("userId");

  const isSelf = targetUserId === user.id;
  let actorRole: string;
  let elevated = false;
  if (isSelf) {
    const direct = await getMember(c.env.DB, id, user.id);
    if (!direct) return c.json({ error: "not_direct_member" }, 404);
    actorRole = direct.role;
  } else {
    const eff = await teamAuthority(c, id);
    if (!eff) return c.json({ error: "not_found" }, 404);
    if (!hasRole(eff.role, "admin")) return c.json({ error: "forbidden" }, 403);
    actorRole = eff.role;
    elevated = eff.elevated;
  }

  const target = await getMember(c.env.DB, id, targetUserId);
  if (!target) return c.json({ error: "member_not_found" }, 404);

  // A site admin may remove the owner — someone has to be able to, when the
  // owner is the problem. Where there is anyone to promote, the most senior
  // remaining member (longest-serving on a tie) takes the seat in the same
  // batch, so the common case never leaves a team ownerless by accident.
  let successorId: string | null = null;
  if (target.role === "owner" && !isSelf) {
    if (!elevated) return c.json({ error: "cannot_remove_owner" }, 403);
    const { results } = await c.env.DB.prepare(
      `SELECT user_id, role FROM team_members
        WHERE team_id = ? AND user_id != ?
        ORDER BY CASE role WHEN 'co-owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                 joined_at ASC
        LIMIT 1`,
    )
      .bind(id, targetUserId)
      .all<{ user_id: string; role: string }>();
    successorId = results[0]?.user_id ?? null;
    // No one left to promote. The removal still goes ahead and the team is
    // left empty rather than destroyed: "remove this member" should not
    // silently delete a team, and the admin who wants it gone has a delete
    // button. An empty team is a state the rest of the code already handles —
    // it is what a team looks like between creation and its first member.
  }
  // Only owner can remove co-owners
  if (target.role === "co-owner" && !isSelf && actorRole !== "owner")
    return c.json({ error: "team_owner_required" }, 403);

  if (target.role === "owner" && isSelf) {
    // Leaving as owner: only allowed if no other members
    const { results } = await c.env.DB.prepare(
      "SELECT user_id FROM team_members WHERE team_id = ?",
    )
      .bind(id)
      .all<{ user_id: string }>();
    if (results.length > 1) return c.json({ error: "owner_cannot_leave" }, 400);
    // Same protection as the explicit delete: leaving as the last member
    // would otherwise be a second, quieter route to the same destruction.
    // Pending accounts make this reachable even on a team that looks empty —
    // they hold origin_team_id but no membership row yet.
    if (await hasLiveRestrictedAccounts(c.env.DB, id))
      return c.json(
        {
          error: "team_dissolve_admin_only",
        },
        403,
      );
    // Last member — delete the team
    await dissolveTeam(c.env.DB, id, user.id);
    return c.json({ ok: true });
  }

  if (successorId) {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "DELETE FROM team_members WHERE team_id = ? AND user_id = ?",
      ).bind(id, targetUserId),
      c.env.DB.prepare(
        "UPDATE team_members SET role = 'owner' WHERE team_id = ? AND user_id = ?",
      ).bind(id, successorId),
      c.env.DB.prepare("UPDATE teams SET updated_at = ? WHERE id = ?").bind(
        Math.floor(Date.now() / 1000),
        id,
      ),
    ]);
    auditTeam(c, id, "team.ownership.transfer", {
      resourceType: "user",
      resourceId: successorId,
      metadata: {
        from: targetUserId,
        to: successorId,
        reason: "owner_removed",
      },
    });
  } else {
    await c.env.DB.prepare(
      "DELETE FROM team_members WHERE team_id = ? AND user_id = ?",
    )
      .bind(id, targetUserId)
      .run();
  }

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

  return c.json({
    // Who ended up holding the team, if anyone. Null after removing an owner
    // with nobody to promote — the team is now empty and ownerless, which the
    // caller should hear rather than discover.
    new_owner_id: successorId,
    owner_vacated: target.role === "owner" && !isSelf && !successorId,
  });
});

// Transfer ownership to another member (owner only, or a site admin from
// outside the team). A site admin may also name someone who isn't a member
// yet — the alternative is a two-step dance through the add-member endpoint
// that ends in the same place.
app.post("/:id/transfer-ownership", async (c) => {
  const id = c.req.param("id");

  const auth = await teamAuthority(c, id);
  if (!auth) return c.json({ error: "not_found" }, 404);
  if (!hasRole(auth.role, "owner"))
    return c.json({ error: "team_owner_required" }, 403);

  const body = await c.req.json<{ user_id: string }>();
  if (!body.user_id)
    return c.json(
      { error: "field_required", params: { field: "user_id" } },
      400,
    );

  // Whoever holds the title right now — normally the caller, but an admin
  // acting from outside is not a member and must not be the one demoted.
  const currentOwner = await c.env.DB.prepare(
    "SELECT user_id FROM team_members WHERE team_id = ? AND role = 'owner'",
  )
    .bind(id)
    .first<{ user_id: string }>();
  if (currentOwner && body.user_id === currentOwner.user_id)
    return c.json({ error: "already_owner" }, 400);

  // Ownership carries every setting on the team, including the invite
  // registration switches. Handing it to a restricted account would let the
  // restriction be reconfigured from inside — which is exactly as true when
  // a site admin does it, so this one holds for everybody. Checked before the
  // membership row below, or a refused transfer would still leave the target
  // sitting in the team.
  const targetRestriction = await getRestrictionState(c.env.DB, body.user_id);
  if (targetRestriction && isRestricted(targetRestriction))
    return c.json(
      {
        error: "transfer_to_restricted",
      },
      403,
    );

  const now = Math.floor(Date.now() / 1000);
  const target = await getMember(c.env.DB, id, body.user_id);
  if (!target) {
    // Only the site-admin path gets here: a team owner still has to add
    // someone before handing them the team.
    if (!auth.elevated) return c.json({ error: "target_not_member" }, 404);
    const exists = await c.env.DB.prepare(
      "SELECT id FROM users WHERE id = ? AND kind = 'user'",
    )
      .bind(body.user_id)
      .first<{ id: string }>();
    if (!exists) return c.json({ error: "user_not_found" }, 404);
    await c.env.DB.prepare(
      "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)",
    )
      .bind(id, body.user_id, now)
      .run();
  }

  const statements = [
    c.env.DB.prepare(
      "UPDATE team_members SET role = 'owner' WHERE team_id = ? AND user_id = ?",
    ).bind(id, body.user_id),
  ];
  if (currentOwner)
    statements.push(
      c.env.DB.prepare(
        "UPDATE team_members SET role = 'co-owner' WHERE team_id = ? AND user_id = ?",
      ).bind(id, currentOwner.user_id),
    );
  statements.push(
    c.env.DB.prepare("UPDATE teams SET updated_at = ? WHERE id = ?").bind(
      now,
      id,
    ),
  );
  await c.env.DB.batch(statements);

  auditTeam(c, id, "team.ownership.transfer", {
    resourceType: "user",
    resourceId: body.user_id,
    metadata: { from: currentOwner?.user_id ?? null, to: body.user_id },
  });

  return c.json({ ok: true });
});

app.route("/", teamGroupRoutes);

app.route("/", teamInviteRoutes);

app.route("/", teamDomainRoutes);

// ─── Team apps ────────────────────────────────────────────────────────────────

// List team apps
app.get("/:id/apps", async (c) => {
  const id = c.req.param("id");

  const eff = await teamAuthority(c, id);
  if (!eff) return c.json({ error: "not_found" }, 404);

  const { page, limit, offset } = readPage(
    c.req.query("page"),
    c.req.query("limit"),
    20,
  );
  const query = c.req.query("q")?.trim() ?? "";

  const where = query
    ? "team_id = ? AND LOWER(name) LIKE LOWER(?) ESCAPE '\\'"
    : "team_id = ?";
  const args: unknown[] = query ? [id, likePattern(query)] : [id];

  const [rows, countRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT * FROM oauth_apps WHERE ${where}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(...args, limit, offset)
      .all<OAuthAppRow>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM oauth_apps WHERE ${where}`)
      .bind(...args)
      .first<{ n: number }>(),
  ]);

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

  return c.json({ apps, total: countRow?.n ?? 0, page, limit });
});

// Create app for team
app.post("/:id/apps", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  if (user.role !== "admin") {
    const disabled = await getConfigValue(c.env.DB, "disable_user_create_app");
    if (disabled) return c.json({ error: "app_creation_disabled" }, 403);
  }

  const capErr = await guardCapability(c.env.DB, user.id, "app:create");
  if (capErr) return c.json({ error: capErr }, 403);

  const eff = await teamAuthority(c, id);
  if (!eff) return c.json({ error: "not_found" }, 404);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{
    name: string;
    description?: string;
    website_url?: string;
    // Entry objects since migration 0051. This endpoint kept accepting bare
    // strings long after apps.ts moved on, so the dashboard — which sends
    // entries — could not create a team app at all: every value failed the
    // string-only validator with "missing", and the error interpolated the
    // object as [object Object].
    redirect_uris: RedirectUriEntry[];
    allowed_scopes?: string[];
    is_public?: boolean;
  }>();

  if (!body.name)
    return c.json({ error: "field_required", params: { field: "name" } }, 400);
  if (!body.redirect_uris?.length)
    return c.json({ error: "redirect_uri_required" }, 400);

  // parseRedirectUris tolerates the legacy string form too, so API clients
  // written against the old shape keep working.
  const redirectUris = parseRedirectUris(JSON.stringify(body.redirect_uris));
  if (!redirectUris.length)
    return c.json({ error: "redirect_uri_required" }, 400);
  for (const entry of redirectUris) {
    const reason = validateRedirectUriEntry(entry);
    if (reason)
      return c.json(
        { error: `redirect_uri_${reason}`, params: { uri: entry.value } },
        400,
      );
  }

  // Was a five-entry hard-coded allow-list, which silently dropped every
  // other scope — `teams:read`, the whole `team:*` family, `app:*` delegation,
  // domains, gpg, social. Silently: the request still returned 201 and the
  // app simply came out without them. Share the validator apps.ts uses so the
  // two paths cannot drift again.
  const allowedScopes = (
    body.allowed_scopes ?? ["openid", "profile", "email"]
  ).filter(isAllowedScope);

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
      // Keep team-owned app credentials under the same encryption-at-rest
      // policy as personal apps. Only the local plaintext is returned below.
      await encryptSecret(c.env, clientSecret),
      JSON.stringify(redirectUris),
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
    JSON.stringify(redirectUris),
  );
  return c.json(
    {
      app: {
        ...(await safeApp(c.env.APP_URL, c.env.DB, row!, isVerified)),
        client_secret: clientSecret,
      },
    },
    201,
  );
});

// Transfer a personal app into this team
app.post("/:id/apps/transfer", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const eff = await teamAuthority(c, id);
  if (!eff) return c.json({ error: "not_found" }, 404);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{ app_id: string }>();
  const appRow = await c.env.DB.prepare("SELECT * FROM oauth_apps WHERE id = ?")
    .bind(body.app_id)
    .first<OAuthAppRow>();

  if (!appRow) return c.json({ error: "app_not_found" }, 404);
  if (appRow.team_id) return c.json({ error: "app_already_team_owned" }, 409);
  if (appRow.owner_id !== user.id)
    return c.json({ error: "app_not_yours" }, 403);

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

  return c.json({ ok: true });
});

// Remove app from team (back to personal — assigned to the requester)
app.delete("/:id/apps/:appId/transfer", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const appId = c.req.param("appId");

  const eff = await teamAuthority(c, id);
  if (!eff) return c.json({ error: "not_found" }, 404);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "forbidden" }, 403);

  const appRow = await c.env.DB.prepare(
    "SELECT * FROM oauth_apps WHERE id = ? AND team_id = ?",
  )
    .bind(appId, id)
    .first<OAuthAppRow>();
  if (!appRow) return c.json({ error: "app_not_in_team" }, 404);

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    "UPDATE oauth_apps SET team_id = NULL, owner_id = ?, updated_at = ? WHERE id = ?",
  )
    .bind(user.id, now, appId)
    .run();

  return c.json({ ok: true });
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
    // Team members may read app metadata, but the credential itself is
    // write-only after an administrator creates or rotates it.
    has_client_secret: row.client_secret.length > 0,
    // parseRedirectUris, not a bare JSON.parse cast: the column holds entry
    // objects since 0051, and typing it as string[] here made the team app
    // list disagree with the personal one for the same row.
    redirect_uris: parseRedirectUris(row.redirect_uris),
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

export default app;
