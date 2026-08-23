// Notice board.
//
// Two audiences, one table. Administrators write and schedule notices; anyone
// else reads the ones aimed at them. The read side is deliberately the cheap
// path — it runs on every page load for every signed-in user, so it is one
// indexed query with the audience test pushed into SQL rather than a fan-out
// the worker filters afterwards.
//
// Mounted twice: the reader at /api/notices (optional auth — public notices
// are the point of the signed-out pages) and the admin surface under
// /api/admin/notices, which inherits requireAdmin.

import { Hono } from "hono";
import { randomId } from "../lib/crypto";
import { getIp } from "../lib/clientIp";
import { recordAudit, auditRequestMeta } from "../lib/audit";
import { readPage } from "../lib/pagination";
import { optionalAuth } from "../middleware/auth";
import type { NoticeRow, Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };

export const LEVELS = ["info", "warning", "critical"] as const;
export const AUDIENCES = ["public", "users", "admins", "team"] as const;

export type NoticeLevel = (typeof LEVELS)[number];
export type NoticeAudience = (typeof AUDIENCES)[number];

const MAX_TITLE = 120;
const MAX_BODY_BYTES = 8_000;

function serialize(row: NoticeRow) {
  return {
    ...row,
    is_published: row.is_published === 1,
    is_dismissible: row.is_dismissible === 1,
    pinned: row.pinned === 1,
  };
}

// ─── Reader ───────────────────────────────────────────────────────────────────

export const readerRoutes = new Hono<AppEnv>();

readerRoutes.use("*", optionalAuth);

/** The notices this viewer should see right now.
 *
 *  Signed out, that is the `public` ones only — which is the whole reason the
 *  route takes optional rather than required auth. "The instance is down for
 *  maintenance at 02:00" is most useful to the person who cannot sign in.
 *
 *  Dismissals are joined rather than filtered afterwards so a viewer who has
 *  dismissed everything costs one query and returns nothing, instead of
 *  fetching every live notice to throw it away. */
readerRoutes.get("/", async (c) => {
  const user = c.get("user");
  const now = Math.floor(Date.now() / 1000);

  const audiences: string[] = ["public"];
  if (user) {
    audiences.push("users");
    if (user.role === "admin") audiences.push("admins");
  }
  const placeholders = audiences.map(() => "?").join(", ");

  // Team notices need the viewer's memberships, including inherited ones. The
  // recursive walk lives in teams.ts and is not worth a second query here on
  // a hot path: a direct-membership join covers the case a team notice is for
  // (its own members), and a sub-team member who should also see it is
  // reachable by posting to the ancestor they belong to.
  const teamClause = user
    ? `OR (n.audience = 'team' AND n.team_id IN (
           SELECT team_id FROM team_members WHERE user_id = ?
         ))`
    : "";

  const args: unknown[] = [...audiences];
  if (user) args.push(user.id);
  args.push(now, now);
  if (user) args.push(user.id);

  const { results } = await c.env.DB.prepare(
    `SELECT n.*, t.name AS team_name
       FROM notices n
       LEFT JOIN teams t ON t.id = n.team_id
      WHERE n.is_published = 1
        AND (n.audience IN (${placeholders}) ${teamClause})
        AND (n.starts_at IS NULL OR n.starts_at <= ?)
        AND (n.ends_at IS NULL OR n.ends_at > ?)
        ${
          user
            ? `AND n.id NOT IN (
                 SELECT notice_id FROM notice_dismissals WHERE user_id = ?
               )`
            : ""
        }
      ORDER BY n.pinned DESC, n.created_at DESC
      LIMIT 20`,
  )
    .bind(...(args as never[]))
    .all<NoticeRow & { team_name: string | null }>();

  return c.json({ notices: results.map(serialize) });
});

/** Dismiss one notice for the calling user.
 *
 *  Signed-out viewers cannot dismiss — there is nowhere to record it, and a
 *  notice they could hide would come straight back on the next page load,
 *  which is worse than no dismiss button at all. */
readerRoutes.post("/:id/dismiss", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const notice = await c.env.DB.prepare(
    "SELECT id, is_dismissible FROM notices WHERE id = ?",
  )
    .bind(c.req.param("id"))
    .first<{ id: string; is_dismissible: number }>();
  if (!notice) return c.json({ error: "Notice not found" }, 404);
  if (notice.is_dismissible !== 1)
    return c.json({ error: "This notice cannot be dismissed" }, 403);

  await c.env.DB.prepare(
    `INSERT INTO notice_dismissals (notice_id, user_id, dismissed_at)
     VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
  )
    .bind(notice.id, user.id, Math.floor(Date.now() / 1000))
    .run();

  return c.json({ message: "Dismissed" });
});

// ─── Admin ────────────────────────────────────────────────────────────────────

export const adminRoutes = new Hono<AppEnv>();

function auditNotice(
  c: import("hono").Context<AppEnv>,
  action: string,
  notice: { id: string; title: string },
  metadata: Record<string, unknown> = {},
): void {
  const admin = c.get("user");
  const meta = auditRequestMeta(c);
  void recordAudit(c.env, c.executionCtx, {
    scope: "platform",
    scopeId: null,
    action,
    actorId: admin.id,
    actorName: admin.username,
    resourceType: "notice",
    resourceId: notice.id,
    resourceName: notice.title,
    ip: meta.ip ?? getIp(c),
    userAgent: meta.userAgent,
    geo: meta.geo,
    metadata,
  });
}

/** Validate the writable fields. Returns an error string, or null. */
async function validate(
  db: D1Database,
  body: Partial<{
    title: string;
    body: string;
    level: string;
    audience: string;
    team_id: string | null;
    starts_at: number | null;
    ends_at: number | null;
  }>,
): Promise<string | null> {
  if (body.title !== undefined) {
    const t = body.title.trim();
    if (!t) return "title is required";
    if (t.length > MAX_TITLE) return `title must be ${MAX_TITLE} characters or fewer`;
  }
  if (body.body !== undefined) {
    if (!body.body.trim()) return "body is required";
    const bytes = new TextEncoder().encode(body.body).byteLength;
    if (bytes > MAX_BODY_BYTES)
      return `body exceeds the ${MAX_BODY_BYTES}-byte limit`;
  }
  if (body.level !== undefined && !LEVELS.includes(body.level as NoticeLevel))
    return `level must be one of: ${LEVELS.join(", ")}`;
  if (body.audience !== undefined) {
    if (!AUDIENCES.includes(body.audience as NoticeAudience))
      return `audience must be one of: ${AUDIENCES.join(", ")}`;
    if (body.audience === "team") {
      if (!body.team_id) return "team_id is required for a team notice";
      const team = await db
        .prepare("SELECT id FROM teams WHERE id = ?")
        .bind(body.team_id)
        .first<{ id: string }>();
      if (!team) return "Team not found";
    }
  }
  // A window that has already closed would publish to nobody, which reads as
  // the feature being broken rather than the dates being wrong.
  if (
    body.starts_at != null &&
    body.ends_at != null &&
    body.ends_at <= body.starts_at
  )
    return "ends_at must be after starts_at";
  return null;
}

/** Every notice, drafts included. */
adminRoutes.get("/", async (c) => {
  const { page, limit, offset } = readPage(
    c.req.query("page"),
    c.req.query("limit"),
    20,
    100,
  );

  const [rows, count] = await Promise.all([
    c.env.DB.prepare(
      `SELECT n.*, t.name AS team_name, u.username AS created_by_username,
              (SELECT COUNT(*) FROM notice_dismissals d WHERE d.notice_id = n.id)
                AS dismissal_count
         FROM notices n
         LEFT JOIN teams t ON t.id = n.team_id
         LEFT JOIN users u ON u.id = n.created_by
        ORDER BY n.pinned DESC, n.created_at DESC
        LIMIT ? OFFSET ?`,
    )
      .bind(limit, offset)
      .all<NoticeRow & Record<string, unknown>>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM notices").first<{ n: number }>(),
  ]);

  return c.json({
    notices: rows.results.map(serialize),
    total: count?.n ?? 0,
    page,
    limit,
  });
});

adminRoutes.post("/", async (c) => {
  const admin = c.get("user");
  const body = await c.req.json<{
    title: string;
    body: string;
    level?: NoticeLevel;
    audience?: NoticeAudience;
    team_id?: string | null;
    is_published?: boolean;
    starts_at?: number | null;
    ends_at?: number | null;
    is_dismissible?: boolean;
    pinned?: boolean;
  }>();

  const err = await validate(c.env.DB, {
    ...body,
    title: body.title ?? "",
    body: body.body ?? "",
    audience: body.audience ?? "users",
  });
  if (err) return c.json({ error: err }, 400);

  const id = randomId();
  const now = Math.floor(Date.now() / 1000);
  const audience = body.audience ?? "users";

  await c.env.DB.prepare(
    `INSERT INTO notices
       (id, title, body, level, audience, team_id, is_published, starts_at,
        ends_at, is_dismissible, pinned, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      body.title.trim(),
      body.body,
      body.level ?? "info",
      audience,
      audience === "team" ? (body.team_id ?? null) : null,
      body.is_published ? 1 : 0,
      body.starts_at ?? null,
      body.ends_at ?? null,
      body.is_dismissible === false ? 0 : 1,
      body.pinned ? 1 : 0,
      admin.id,
      now,
      now,
    )
    .run();

  auditNotice(
    c,
    body.is_published ? "admin.notice.publish" : "admin.notice.create",
    { id, title: body.title.trim() },
    { audience, level: body.level ?? "info" },
  );

  const created = await c.env.DB.prepare("SELECT * FROM notices WHERE id = ?")
    .bind(id)
    .first<NoticeRow>();
  return c.json({ notice: serialize(created!) }, 201);
});

adminRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT * FROM notices WHERE id = ?")
    .bind(id)
    .first<NoticeRow>();
  if (!existing) return c.json({ error: "Notice not found" }, 404);

  const body = await c.req.json<
    Partial<{
      title: string;
      body: string;
      level: NoticeLevel;
      audience: NoticeAudience;
      team_id: string | null;
      is_published: boolean;
      starts_at: number | null;
      ends_at: number | null;
      is_dismissible: boolean;
      pinned: boolean;
      /** Clear every dismissal so the notice reappears for everyone. */
      reset_dismissals: boolean;
    }>
  >();

  // Validate against the merged result, not the patch: a request that only
  // moves `ends_at` still has to land after the stored `starts_at`.
  const err = await validate(c.env.DB, {
    ...body,
    audience: body.audience ?? (existing.audience as NoticeAudience),
    team_id: body.team_id ?? existing.team_id,
    starts_at: body.starts_at !== undefined ? body.starts_at : existing.starts_at,
    ends_at: body.ends_at !== undefined ? body.ends_at : existing.ends_at,
  });
  if (err) return c.json({ error: err }, 400);

  const updates: string[] = [];
  const values: unknown[] = [];
  const set = (col: string, v: unknown) => {
    updates.push(`${col} = ?`);
    values.push(v);
  };

  if (body.title !== undefined) set("title", body.title.trim());
  if (body.body !== undefined) set("body", body.body);
  if (body.level !== undefined) set("level", body.level);
  if (body.audience !== undefined) {
    set("audience", body.audience);
    // A notice that stops being team-scoped must not keep pointing at a team;
    // the read query would ignore it, but the admin list would still show one.
    set("team_id", body.audience === "team" ? (body.team_id ?? existing.team_id) : null);
  } else if (body.team_id !== undefined && existing.audience === "team") {
    set("team_id", body.team_id);
  }
  if (body.is_published !== undefined) set("is_published", body.is_published ? 1 : 0);
  if (body.starts_at !== undefined) set("starts_at", body.starts_at);
  if (body.ends_at !== undefined) set("ends_at", body.ends_at);
  if (body.is_dismissible !== undefined)
    set("is_dismissible", body.is_dismissible ? 1 : 0);
  if (body.pinned !== undefined) set("pinned", body.pinned ? 1 : 0);

  if (!updates.length && !body.reset_dismissals)
    return c.json({ error: "Nothing to update" }, 400);

  if (updates.length) {
    set("updated_at", Math.floor(Date.now() / 1000));
    await c.env.DB.prepare(`UPDATE notices SET ${updates.join(", ")} WHERE id = ?`)
      .bind(...(values as never[]), id)
      .run();
  }

  // Editing a notice does not un-dismiss it — someone who dismissed a typo
  // does not want it back because the typo was fixed. Bringing it back is a
  // separate, deliberate act.
  let resetCount = 0;
  if (body.reset_dismissals) {
    const before = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM notice_dismissals WHERE notice_id = ?",
    )
      .bind(id)
      .first<{ n: number }>();
    resetCount = before?.n ?? 0;
    await c.env.DB.prepare("DELETE FROM notice_dismissals WHERE notice_id = ?")
      .bind(id)
      .run();
  }

  const wasPublished = existing.is_published === 1;
  const nowPublished = body.is_published ?? wasPublished;
  auditNotice(
    c,
    !wasPublished && nowPublished
      ? "admin.notice.publish"
      : wasPublished && !nowPublished
        ? "admin.notice.unpublish"
        : "admin.notice.update",
    { id, title: body.title?.trim() ?? existing.title },
    { fields: Object.keys(body), dismissals_reset: resetCount },
  );

  const updated = await c.env.DB.prepare("SELECT * FROM notices WHERE id = ?")
    .bind(id)
    .first<NoticeRow>();
  return c.json({ notice: serialize(updated!), dismissals_reset: resetCount });
});

adminRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare(
    "SELECT id, title FROM notices WHERE id = ?",
  )
    .bind(id)
    .first<{ id: string; title: string }>();
  if (!existing) return c.json({ error: "Notice not found" }, 404);

  // Dismissals go with it through ON DELETE CASCADE.
  await c.env.DB.prepare("DELETE FROM notices WHERE id = ?").bind(id).run();
  auditNotice(c, "admin.notice.delete", existing);
  return c.json({ message: "Notice deleted" });
});
