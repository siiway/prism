// Team member groups: /api/teams/:id/groups — defining groups and assigning
// members to them.

import { Hono } from "hono";
import { randomId } from "../lib/crypto";
import type {
  TeamGroupRow,
  TeamRolePermissions,
  TeamRow,
  Variables,
} from "../types";
import {
  MAX_GROUPS_PER_MEMBER,
  MAX_GROUPS_PER_TEAM,
  MAX_GROUP_DESCRIPTION_LENGTH,
  MAX_GROUP_NAME_LENGTH,
  canAssignGroup,
  canManageGroups,
  effectiveCapabilities,
  getMemberGroups,
  getSiteRolePermissions,
  listTeamGroups,
  serializeTeamGroup,
  validateGroupColor,
  validateGroupSlug,
} from "../lib/teamGroups";
import { getMember, hasRole, teamAuthority, auditTeam } from "../lib/teams";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

// ─── Member groups ────────────────────────────────────────────────────────────
//
// Groups are pure labels — they never widen what anyone can do inside Prism.
// What they *do* affect is downstream authorization, which is why who may
// hand them out is itself configurable (see src/worker/lib/teamGroups.ts) and why
// every mutation here is audited.

/** Shared preamble for the group endpoints: the caller's effective role plus
 *  the two inputs every capability check needs. Returns null when the caller
 *  has no membership at all. */
async function groupContext(
  c: import("hono").Context<AppEnv>,
  teamId: string,
): Promise<{
  team: TeamRow;
  role: string;
  siteDefaults: TeamRolePermissions;
} | null> {
  const db = c.env.DB;
  const eff = await teamAuthority(c, teamId);
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

/** groupContext for changing group definitions: groups are on for the team
 *  and the caller's role may manage them. */
async function groupManager(c: import("hono").Context<AppEnv>, teamId: string) {
  const ctx = await groupContext(c, teamId);
  if (!ctx) return c.json({ error: "not_found" }, 404);
  if (ctx.team.enable_groups !== 1)
    return c.json({ error: "member_groups_disabled" }, 403);
  if (!canManageGroups(ctx.role, ctx.team.role_permissions, ctx.siteDefaults))
    return c.json({ error: "forbidden" }, 403);
  return ctx;
}

function findGroup(db: D1Database, teamId: string, groupId: string) {
  return db
    .prepare("SELECT * FROM team_groups WHERE id = ? AND team_id = ?")
    .bind(groupId, teamId)
    .first<TeamGroupRow>();
}

// List group definitions. Readable by any member — a member seeing which
// labels exist is harmless, and the client needs the capability flags to
// decide what to render.
app.get("/:id/groups", async (c) => {
  const id = c.req.param("id");

  const ctx = await groupContext(c, id);
  if (!ctx) return c.json({ error: "not_found" }, 404);

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
  const id = c.req.param("id");

  const ctx = await groupManager(c, id);
  if (ctx instanceof Response) return ctx;

  const body = await c.req.json<{
    slug?: string;
    name?: string;
    description?: string;
    color?: string | null;
    admin_assignable?: boolean | null;
  }>();

  const slug = (body.slug ?? "").trim().toLowerCase();
  const slugErr = validateGroupSlug(slug);
  if (slugErr) return c.json(slugErr, 400);

  const name = (body.name ?? "").trim();
  if (!name)
    return c.json({ error: "field_required", params: { field: "name" } }, 400);
  if (name.length > MAX_GROUP_NAME_LENGTH)
    return c.json(
      {
        error: "field_max_length",
        params: { field: "name", max: MAX_GROUP_NAME_LENGTH },
      },
      400,
    );

  const description = (body.description ?? "").trim();
  if (description.length > MAX_GROUP_DESCRIPTION_LENGTH)
    return c.json(
      {
        error: "field_max_length",
        params: { field: "description", max: MAX_GROUP_DESCRIPTION_LENGTH },
      },
      400,
    );

  const color = body.color ?? null;
  const colorErr = validateGroupColor(color);
  if (colorErr) return c.json(colorErr, 400);

  // The per-group exception overrides the owner's capability set, so only
  // the owner may set it — otherwise a manager could exempt themselves.
  if (body.admin_assignable !== undefined && !hasRole(ctx.role, "owner"))
    return c.json({ error: "team_owner_required" }, 403);

  const existing = await listTeamGroups(c.env.DB, id);
  if (existing.length >= MAX_GROUPS_PER_TEAM)
    return c.json(
      { error: "team_group_limit", params: { max: MAX_GROUPS_PER_TEAM } },
      400,
    );
  if (existing.some((g) => g.slug === slug))
    return c.json({ error: "group_slug_taken" }, 409);

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
      return c.json({ error: "group_slug_taken" }, 409);
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
  const id = c.req.param("id");
  const groupId = c.req.param("groupId");

  const ctx = await groupManager(c, id);
  if (ctx instanceof Response) return ctx;

  const group = await findGroup(c.env.DB, id, groupId);
  if (!group) return c.json({ error: "group_not_found" }, 404);

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
    return c.json({ error: "group_slug_immutable" }, 400);

  const updates: string[] = ["updated_at = ?"];
  const values: unknown[] = [Math.floor(Date.now() / 1000)];

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name)
      return c.json({ error: "field_empty", params: { field: "name" } }, 400);
    if (name.length > MAX_GROUP_NAME_LENGTH)
      return c.json(
        {
          error: "field_max_length",
          params: { field: "name", max: MAX_GROUP_NAME_LENGTH },
        },
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
          error: "field_max_length",
          params: { field: "description", max: MAX_GROUP_DESCRIPTION_LENGTH },
        },
        400,
      );
    updates.push("description = ?");
    values.push(description);
  }
  if (body.color !== undefined) {
    const colorErr = validateGroupColor(body.color);
    if (colorErr) return c.json(colorErr, 400);
    updates.push("color = ?");
    values.push(body.color || null);
  }
  if (body.admin_assignable !== undefined) {
    if (!hasRole(ctx.role, "owner"))
      return c.json({ error: "team_owner_required" }, 403);
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
  const id = c.req.param("id");
  const groupId = c.req.param("groupId");

  const ctx = await groupManager(c, id);
  if (ctx instanceof Response) return ctx;

  const group = await findGroup(c.env.DB, id, groupId);
  if (!group) return c.json({ error: "group_not_found" }, 404);

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

  return c.json({ ok: true });
});

// Replace a member's group set. A full replacement rather than add/remove
// deltas keeps the dashboard's multi-select honest — the client sends the
// state it wants and the server reconciles.
app.put("/:id/members/:userId/groups", async (c) => {
  const id = c.req.param("id");
  const targetUserId = c.req.param("userId");

  const ctx = await groupContext(c, id);
  if (!ctx) return c.json({ error: "not_found" }, 404);
  if (ctx.team.enable_groups !== 1)
    return c.json({ error: "member_groups_disabled" }, 403);

  // Direct membership only — inherited members carry labels from the
  // ancestor they originate at, and that's where they're managed.
  const target = await getMember(c.env.DB, id, targetUserId);
  if (!target) return c.json({ error: "member_not_found" }, 404);

  const body = await c.req.json<{ group_ids?: unknown }>();
  if (!Array.isArray(body.group_ids))
    return c.json(
      { error: "field_must_be_array", params: { field: "group_ids" } },
      400,
    );
  const requested = [
    ...new Set(
      body.group_ids.filter((g): g is string => typeof g === "string"),
    ),
  ];
  if (requested.length > MAX_GROUPS_PER_MEMBER)
    return c.json(
      {
        error: "member_group_limit",
        params: { max: MAX_GROUPS_PER_MEMBER },
      },
      400,
    );

  const defined = await listTeamGroups(c.env.DB, id);
  const byId = new Map(defined.map((g) => [g.id, g]));
  const unknownId = requested.find((gid) => !byId.has(gid));
  if (unknownId) return c.json({ error: "group_not_found" }, 400);

  const { results: currentRows } = await c.env.DB.prepare(
    "SELECT group_id FROM team_member_groups WHERE team_id = ? AND user_id = ?",
  )
    .bind(id, targetUserId)
    .all<{ group_id: string }>();
  const current = new Set(currentRows.map((r) => r.group_id));
  const next = new Set(requested);

  const added = requested.filter((gid) => !current.has(gid));
  const removed = [...current].filter((gid) => !next.has(gid));
  if (added.length === 0 && removed.length === 0) return c.json({ ok: true });

  // Only the groups actually changing are permission-checked. Checking the
  // whole set instead would mean an admin barred from one sensitive group
  // could no longer edit *any* label on a member already holding it.
  for (const gid of [...added, ...removed]) {
    const group = byId.get(gid);
    // A group that vanished between the read and here — treat as unknown.
    if (!group) return c.json({ error: "group_not_found" }, 400);
    if (
      !canAssignGroup(
        ctx.role,
        group,
        ctx.team.role_permissions,
        ctx.siteDefaults,
      )
    )
      return c.json(
        { error: "group_not_assignable", params: { group: group.slug } },
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

export default app;
