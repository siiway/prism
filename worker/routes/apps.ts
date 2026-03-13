// OAuth application management (CRUD for user-owned apps)

import { Hono } from "hono";
import { randomId, randomBase64url } from "../lib/crypto";
import { requireAuth } from "../middleware/auth";
import { computeIsVerified, computeVerified } from "../lib/domainVerify";
import { validateImageUrl } from "../lib/imageValidation";
import { deliverUserWebhooks } from "../lib/webhooks";
import { deliverUserEmailNotifications } from "../lib/notifications";
import type { OAuthAppRow, TeamMemberRow, Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

app.use("*", requireAuth);

// ─── Auth helpers ─────────────────────────────────────────────────────────────

const ROLE_RANK: Record<string, number> = { owner: 3, admin: 2, member: 1 };

async function getTeamMember(
  db: D1Database,
  teamId: string,
  userId: string,
): Promise<TeamMemberRow | null> {
  return db
    .prepare("SELECT * FROM team_members WHERE team_id = ? AND user_id = ?")
    .bind(teamId, userId)
    .first<TeamMemberRow>();
}

/** Returns true if the user may access the app (read or write). */
async function canAccess(
  db: D1Database,
  row: OAuthAppRow,
  userId: string,
  siteRole: string,
  write: boolean,
): Promise<boolean> {
  if (siteRole === "admin") return true;
  if (row.team_id) {
    const m = await getTeamMember(db, row.team_id, userId);
    if (!m) return false;
    return write ? (ROLE_RANK[m.role] ?? 0) >= ROLE_RANK["admin"] : true;
  }
  return row.owner_id === userId;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// List user's personal apps (team apps are listed via /api/teams/:id/apps)
app.get("/", async (c) => {
  const user = c.get("user");
  const [rows, domainRows] = await Promise.all([
    c.env.DB.prepare(
      "SELECT * FROM oauth_apps WHERE owner_id = ? AND team_id IS NULL ORDER BY created_at DESC",
    )
      .bind(user.id)
      .all<OAuthAppRow>(),
    c.env.DB.prepare(
      "SELECT domain FROM domains WHERE user_id = ? AND verified = 1",
    )
      .bind(user.id)
      .all<{ domain: string }>(),
  ]);
  const verifiedDomains = new Set(domainRows.results.map((r) => r.domain));
  return c.json({
    apps: rows.results.map((row) =>
      safeApp(
        row,
        computeVerified(verifiedDomains, row.website_url, row.redirect_uris),
      ),
    ),
  });
});

// Get single app (personal owner, team member, or site admin)
app.get("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM oauth_apps WHERE id = ?")
    .bind(id)
    .first<OAuthAppRow>();

  if (!row) return c.json({ error: "Not found" }, 404);
  if (!(await canAccess(c.env.DB, row, user.id, user.role, false)))
    return c.json({ error: "Forbidden" }, 403);

  const isVerified = await computeIsVerified(
    c.env.DB,
    row.owner_id,
    row.website_url,
    row.redirect_uris,
    row.team_id,
  );
  return c.json({ app: fullApp(row, isVerified) });
});

// Create personal app
app.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    name: string;
    description?: string;
    website_url?: string;
    redirect_uris: string[];
    allowed_scopes?: string[];
    oidc_fields?: string[];
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

  const id = randomId();
  const clientId = `prism_${randomBase64url(16)}`;
  const clientSecret = randomBase64url(32);
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    `INSERT INTO oauth_apps
       (id, owner_id, name, description, website_url, client_id, client_secret,
        redirect_uris, allowed_scopes, oidc_fields, is_public, is_active, is_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
  )
    .bind(
      id,
      user.id,
      body.name,
      body.description ?? "",
      body.website_url ?? null,
      clientId,
      clientSecret,
      JSON.stringify(body.redirect_uris),
      JSON.stringify(allowedScopes),
      JSON.stringify(body.oidc_fields ?? []),
      body.is_public ? 1 : 0,
      now,
      now,
    )
    .run();

  const row = await c.env.DB.prepare("SELECT * FROM oauth_apps WHERE id = ?")
    .bind(id)
    .first<OAuthAppRow>();

  const isVerified = await computeIsVerified(
    c.env.DB,
    user.id,
    body.website_url ?? null,
    JSON.stringify(body.redirect_uris),
  );
  c.executionCtx.waitUntil(
    deliverUserWebhooks(c.env.DB, user.id, "app.created", {
      app_id: id,
      name: body.name,
    }).catch(() => {}),
  );
  c.executionCtx.waitUntil(
    deliverUserEmailNotifications(
      c.env.DB,
      user.id,
      "app.created",
      {
        app_id: id,
        name: body.name,
      },
      c.env.APP_URL,
    ).catch(() => {}),
  );
  return c.json({ app: fullApp(row!, isVerified) }, 201);
});

// Update app
app.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM oauth_apps WHERE id = ?")
    .bind(id)
    .first<OAuthAppRow>();

  if (!row) return c.json({ error: "Not found" }, 404);
  if (!(await canAccess(c.env.DB, row, user.id, user.role, true)))
    return c.json({ error: "Forbidden" }, 403);

  const body = await c.req.json<{
    name?: string;
    description?: string;
    icon_url?: string;
    website_url?: string;
    redirect_uris?: string[];
    allowed_scopes?: string[];
    oidc_fields?: string[];
    is_public?: boolean;
  }>();

  if (body.icon_url) {
    const imgErr = await validateImageUrl(body.icon_url);
    if (imgErr) return c.json({ error: `icon_url: ${imgErr}` }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const updated = {
    name: body.name ?? row.name,
    description: body.description ?? row.description,
    icon_url: body.icon_url !== undefined ? body.icon_url : row.icon_url,
    website_url:
      body.website_url !== undefined ? body.website_url : row.website_url,
    redirect_uris: body.redirect_uris
      ? JSON.stringify(body.redirect_uris)
      : row.redirect_uris,
    allowed_scopes: body.allowed_scopes
      ? JSON.stringify(body.allowed_scopes)
      : row.allowed_scopes,
    oidc_fields: body.oidc_fields
      ? JSON.stringify(body.oidc_fields)
      : row.oidc_fields,
    is_public:
      body.is_public !== undefined ? (body.is_public ? 1 : 0) : row.is_public,
  };

  await c.env.DB.prepare(
    `UPDATE oauth_apps SET name=?, description=?, icon_url=?, website_url=?, redirect_uris=?, allowed_scopes=?, oidc_fields=?, is_public=?, updated_at=? WHERE id=?`,
  )
    .bind(
      updated.name,
      updated.description,
      updated.icon_url,
      updated.website_url,
      updated.redirect_uris,
      updated.allowed_scopes,
      updated.oidc_fields,
      updated.is_public,
      now,
      id,
    )
    .run();

  const updatedRow = await c.env.DB.prepare(
    "SELECT * FROM oauth_apps WHERE id = ?",
  )
    .bind(id)
    .first<OAuthAppRow>();

  const isVerified = await computeIsVerified(
    c.env.DB,
    row.owner_id,
    updatedRow!.website_url,
    updatedRow!.redirect_uris,
    row.team_id,
  );
  c.executionCtx.waitUntil(
    deliverUserWebhooks(c.env.DB, user.id, "app.updated", { app_id: id }).catch(
      () => {},
    ),
  );
  c.executionCtx.waitUntil(
    deliverUserEmailNotifications(
      c.env.DB,
      user.id,
      "app.updated",
      { app_id: id },
      c.env.APP_URL,
    ).catch(() => {}),
  );
  return c.json({ app: fullApp(updatedRow!, isVerified) });
});

// Rotate client secret
app.post("/:id/rotate-secret", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM oauth_apps WHERE id = ?")
    .bind(id)
    .first<OAuthAppRow>();

  if (!row) return c.json({ error: "Not found" }, 404);
  if (!(await canAccess(c.env.DB, row, user.id, user.role, true)))
    return c.json({ error: "Forbidden" }, 403);

  const newSecret = randomBase64url(32);
  await c.env.DB.prepare(
    "UPDATE oauth_apps SET client_secret = ?, updated_at = ? WHERE id = ?",
  )
    .bind(newSecret, Math.floor(Date.now() / 1000), id)
    .run();

  return c.json({ client_secret: newSecret });
});

// Delete app
app.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM oauth_apps WHERE id = ?")
    .bind(id)
    .first<OAuthAppRow>();

  if (!row) return c.json({ error: "Not found" }, 404);
  if (!(await canAccess(c.env.DB, row, user.id, user.role, true)))
    return c.json({ error: "Forbidden" }, 403);

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM oauth_tokens WHERE client_id = ?").bind(
      row.client_id,
    ),
    c.env.DB.prepare("DELETE FROM oauth_codes WHERE client_id = ?").bind(
      row.client_id,
    ),
    c.env.DB.prepare("DELETE FROM oauth_consents WHERE client_id = ?").bind(
      row.client_id,
    ),
    c.env.DB.prepare("DELETE FROM oauth_apps WHERE id = ?").bind(id),
  ]);

  c.executionCtx.waitUntil(
    deliverUserWebhooks(c.env.DB, user.id, "app.deleted", { app_id: id }).catch(
      () => {},
    ),
  );
  c.executionCtx.waitUntil(
    deliverUserEmailNotifications(
      c.env.DB,
      user.id,
      "app.deleted",
      { app_id: id },
      c.env.APP_URL,
    ).catch(() => {}),
  );
  return c.json({ message: "App deleted" });
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
    oidc_fields: JSON.parse(row.oidc_fields ?? "[]") as string[],
    is_public: row.is_public === 1,
    is_active: row.is_active === 1,
    is_verified: isVerified,
    is_official: row.is_official === 1,
    is_first_party: row.is_first_party === 1,
    team_id: row.team_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function fullApp(row: OAuthAppRow, isVerified: boolean) {
  return { ...safeApp(row, isVerified), client_secret: row.client_secret };
}

export default app;
