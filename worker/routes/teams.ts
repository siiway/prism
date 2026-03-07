// Team management — collaborative app ownership

import { Hono } from "hono";
import { randomId, randomBase64url } from "../lib/crypto";
import { requireAuth } from "../middleware/auth";
import { computeIsVerified } from "../lib/domainVerify";
import type { OAuthAppRow, TeamMemberRow, TeamRow, Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

app.use("*", requireAuth);

// ─── Role helpers ─────────────────────────────────────────────────────────────

const ROLE_RANK: Record<string, number> = { owner: 3, admin: 2, member: 1 };

function hasRole(
  memberRole: string,
  required: "member" | "admin" | "owner",
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

// ─── Team CRUD ────────────────────────────────────────────────────────────────

// List teams the current user belongs to
app.get("/", async (c) => {
  const user = c.get("user");
  const rows = await c.env.DB.prepare(
    `SELECT t.*, tm.role
     FROM teams t
     JOIN team_members tm ON tm.team_id = t.id
     WHERE tm.user_id = ?
     ORDER BY t.created_at DESC`,
  )
    .bind(user.id)
    .all<TeamRow & { role: string }>();

  return c.json({ teams: rows.results });
});

// Create team
app.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    name: string;
    description?: string;
    avatar_url?: string;
  }>();

  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);

  const id = randomId();
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO teams (id, name, description, avatar_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      body.name.trim(),
      body.description ?? "",
      body.avatar_url ?? null,
      now,
      now,
    ),
    c.env.DB.prepare(
      `INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)`,
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
       FROM team_members tm
       JOIN users u ON u.id = tm.user_id
       WHERE tm.team_id = ?
       ORDER BY tm.joined_at ASC`,
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
    team: { ...team, my_role: member.role },
    members: members.results,
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
  }>();

  const team = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ?")
    .bind(id)
    .first<TeamRow>();
  if (!team) return c.json({ error: "Not found" }, 404);

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    "UPDATE teams SET name=?, description=?, avatar_url=?, updated_at=? WHERE id=?",
  )
    .bind(
      body.name?.trim() ?? team.name,
      body.description ?? team.description,
      body.avatar_url !== undefined ? body.avatar_url : team.avatar_url,
      now,
      id,
    )
    .run();

  const updated = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ?")
    .bind(id)
    .first<TeamRow>();
  return c.json({ team: { ...updated!, my_role: member.role } });
});

// Delete team (owner only) — cascades to memberships; apps lose team_id (SET NULL)
app.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const member = await getMember(c.env.DB, id, user.id);
  if (!member) return c.json({ error: "Not found" }, 404);
  if (!hasRole(member.role, "owner"))
    return c.json({ error: "Only the team owner can delete the team" }, 403);

  // Disown team apps (hand back to creator)
  await c.env.DB.prepare(
    "UPDATE oauth_apps SET team_id = NULL WHERE team_id = ?",
  )
    .bind(id)
    .run();

  await c.env.DB.prepare("DELETE FROM teams WHERE id = ?").bind(id).run();

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
  const role = body.role === "admin" ? "admin" : "member";

  const target = await c.env.DB.prepare(
    "SELECT id FROM users WHERE username = ?",
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

  return c.json({ message: "Member added" }, 201);
});

// Change member role (owner only; cannot change another owner's role)
app.patch("/:id/members/:userId", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const targetUserId = c.req.param("userId");

  const member = await getMember(c.env.DB, id, user.id);
  if (!member) return c.json({ error: "Not found" }, 404);
  if (!hasRole(member.role, "owner"))
    return c.json({ error: "Only owners can change roles" }, 403);
  if (targetUserId === user.id)
    return c.json({ error: "Cannot change your own role" }, 400);

  const body = await c.req.json<{ role: string }>();
  if (!["admin", "member"].includes(body.role))
    return c.json({ error: "Role must be admin or member" }, 400);

  const target = await getMember(c.env.DB, id, targetUserId);
  if (!target) return c.json({ error: "Member not found" }, 404);
  if (target.role === "owner")
    return c.json({ error: "Cannot change owner role" }, 403);

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

  if (target.role === "owner" && !isSelf) {
    return c.json({ error: "Cannot remove the team owner" }, 403);
  }
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
    await c.env.DB.prepare(
      "UPDATE oauth_apps SET team_id = NULL WHERE team_id = ?",
    )
      .bind(id)
      .run();
    await c.env.DB.prepare("DELETE FROM teams WHERE id = ?").bind(id).run();
    return c.json({ message: "Team deleted" });
  }

  await c.env.DB.prepare(
    "DELETE FROM team_members WHERE team_id = ? AND user_id = ?",
  )
    .bind(id, targetUserId)
    .run();

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
      "UPDATE team_members SET role = 'admin' WHERE team_id = ? AND user_id = ?",
    ).bind(id, user.id),
    c.env.DB.prepare("UPDATE teams SET updated_at = ? WHERE id = ?").bind(
      now,
      id,
    ),
  ]);

  return c.json({ message: "Ownership transferred" });
});

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
      return safeApp(row, isVerified);
    }),
  );

  return c.json({ apps });
});

// Create app for team
app.post("/:id/apps", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

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
      user.id,
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
  return c.json({ app: fullApp(row!, isVerified) }, 201);
});

// Transfer a personal app into this team (app owner must be a team admin/owner)
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
  if (appRow.owner_id !== user.id)
    return c.json({ error: "You can only transfer apps you created" }, 403);
  if (appRow.team_id)
    return c.json({ error: "App already belongs to a team" }, 400);

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    "UPDATE oauth_apps SET team_id = ?, updated_at = ? WHERE id = ?",
  )
    .bind(id, now, body.app_id)
    .run();

  return c.json({ message: "App transferred to team" });
});

// Remove app from team (back to personal, admin/owner only)
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
    "UPDATE oauth_apps SET team_id = NULL, updated_at = ? WHERE id = ?",
  )
    .bind(now, appId)
    .run();

  return c.json({ message: "App moved back to personal" });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeApp(row: OAuthAppRow, isVerified: boolean) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon_url: row.icon_url,
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

function fullApp(row: OAuthAppRow, isVerified: boolean) {
  return { ...safeApp(row, isVerified), client_secret: row.client_secret };
}

export default app;
