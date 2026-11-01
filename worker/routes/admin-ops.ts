// Instance-wide operations.
//
// The rest of the admin surface works one row at a time: this user, that
// team, that app. This file is for the things that are only useful when they
// apply to everything at once, and which an operator otherwise performs by
// writing a DELETE statement into the database console and hoping the WHERE
// clause is right.
//
// Each one is a response to an incident rather than a routine task — a leaked
// client secret, a stolen signing key, a domain whose DNS will never resolve
// again. They are shaped accordingly: narrow, audited, and explicit about how
// much they just destroyed.
//
// Mounted under /api/admin, which already sits behind requireAdmin.

import { Hono } from "hono";
import { getIp } from "../lib/clientIp";
import {
  recordAudit,
  recordAccountDeletion,
  auditRequestMeta,
} from "../lib/audit";
import { isUserLocked } from "../lib/lockdown";
import { readPage, likePattern } from "../lib/pagination";
import { proxyImageUrl } from "../lib/proxyImage";
import {
  grantLike,
  grantMatcher,
  heldScopes,
  parseScopeList,
  stripGrant,
} from "../lib/scopeGrants";
import type { DomainRow, Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

function auditOps(
  c: import("hono").Context<AppEnv>,
  action: string,
  metadata: Record<string, unknown>,
  resource?: { type?: string; id?: string | null; name?: string | null },
): void {
  const admin = c.get("user");
  const meta = auditRequestMeta(c);
  c.executionCtx.waitUntil(
    recordAudit(c.env, c.executionCtx, {
      scope: "platform",
      scopeId: null,
      action,
      actorId: admin.id,
      actorName: admin.username,
      resourceType: resource?.type ?? null,
      resourceId: resource?.id ?? null,
      resourceName: resource?.name ?? null,
      ip: meta.ip ?? getIp(c),
      userAgent: meta.userAgent,
      geo: meta.geo,
      metadata: { ...metadata, site_admin: true },
    }),
  );
}

// ─── Mass revocation ──────────────────────────────────────────────────────────

/** How many rows the operation is about to destroy, gathered before it runs.
 *
 *  D1 reports `changes` per statement, but a caller deciding whether to press
 *  the button needs the number *first*. Both are returned: the estimate the
 *  confirmation was based on, and what actually happened. */
async function countRows(db: D1Database, sql: string, binds: unknown[] = []) {
  const row = await db
    .prepare(sql)
    .bind(...(binds as never[]))
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** What a mass revocation would destroy, without destroying it. */
app.get("/revoke/preview", async (c) => {
  const now = Math.floor(Date.now() / 1000);
  const [sessions, oauthTokens, consents, pats] = await Promise.all([
    countRows(
      c.env.DB,
      "SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?",
      [now],
    ),
    countRows(c.env.DB, "SELECT COUNT(*) AS n FROM oauth_tokens"),
    countRows(c.env.DB, "SELECT COUNT(*) AS n FROM oauth_consents"),
    countRows(c.env.DB, "SELECT COUNT(*) AS n FROM personal_access_tokens"),
  ]);
  return c.json({
    sessions,
    oauth_tokens: oauthTokens,
    oauth_consents: consents,
    personal_access_tokens: pats,
  });
});

/** Sign every account out.
 *
 *  Keeps the caller's own session by default. An operator who signs themselves
 *  out mid-incident has to log back in through whatever they were trying to
 *  contain, so the safe default is the one that leaves them standing —
 *  `include_self` is there for the case where the operator's own session is
 *  what they are worried about. */
app.post("/revoke/sessions", async (c) => {
  const admin = c.get("user");
  const sessionId = c.get("sessionId");
  const body = await c.req
    .json<{ include_self?: boolean }>()
    .catch(() => ({}) as { include_self?: boolean });

  const now = Math.floor(Date.now() / 1000);
  const before = await countRows(
    c.env.DB,
    "SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?",
    [now],
  );

  const result = body.include_self
    ? await c.env.DB.prepare("DELETE FROM sessions").run()
    : await c.env.DB.prepare("DELETE FROM sessions WHERE id != ?")
        .bind(sessionId)
        .run();

  auditOps(c, "admin.revoke.all_sessions", {
    active_before: before,
    deleted: result.meta?.changes ?? null,
    include_self: body.include_self === true,
    actor_session_kept: body.include_self !== true,
  });
  return c.json({
    message: "Sessions revoked",
    deleted: result.meta?.changes ?? 0,
    your_session_kept: body.include_self !== true,
    actor: admin.username,
  });
});

/** Cut one application off entirely.
 *
 *  Tokens, refresh tokens, pending authorization codes and the consent
 *  records behind them. Deleting the consents is the part that matters: leave
 *  them and every user walks straight back through the consent screen without
 *  being asked, which is not what "revoked" means to the person who pressed
 *  this during a leak. */
app.post("/revoke/app/:appId", async (c) => {
  const appId = c.req.param("appId");
  const row = await c.env.DB.prepare(
    "SELECT id, client_id, name FROM oauth_apps WHERE id = ? OR client_id = ?",
  )
    .bind(appId, appId)
    .first<{ id: string; client_id: string; name: string }>();
  if (!row) return c.json({ error: "Application not found" }, 404);

  const body = await c.req
    .json<{ deactivate?: boolean }>()
    .catch(() => ({}) as { deactivate?: boolean });

  const [tokens, consents] = await Promise.all([
    countRows(
      c.env.DB,
      "SELECT COUNT(*) AS n FROM oauth_tokens WHERE client_id = ?",
      [row.client_id],
    ),
    countRows(
      c.env.DB,
      "SELECT COUNT(*) AS n FROM oauth_consents WHERE client_id = ?",
      [row.client_id],
    ),
  ]);

  const statements = [
    c.env.DB.prepare("DELETE FROM oauth_tokens WHERE client_id = ?").bind(
      row.client_id,
    ),
    c.env.DB.prepare("DELETE FROM oauth_codes WHERE client_id = ?").bind(
      row.client_id,
    ),
    c.env.DB.prepare("DELETE FROM oauth_consents WHERE client_id = ?").bind(
      row.client_id,
    ),
  ];
  // Revoking without deactivating leaves the app free to ask again the moment
  // the next user opens it — usually the wrong outcome during a leak, so the
  // caller says which they meant.
  if (body.deactivate)
    statements.push(
      c.env.DB.prepare(
        "UPDATE oauth_apps SET is_active = 0, updated_at = ? WHERE id = ?",
      ).bind(Math.floor(Date.now() / 1000), row.id),
    );
  await c.env.DB.batch(statements);

  auditOps(
    c,
    "admin.revoke.app",
    {
      tokens_revoked: tokens,
      consents_revoked: consents,
      deactivated: body.deactivate === true,
    },
    { type: "app", id: row.id, name: row.name },
  );
  return c.json({
    message: "Application access revoked",
    tokens_revoked: tokens,
    consents_revoked: consents,
    deactivated: body.deactivate === true,
  });
});

/** Revoke every OAuth grant held *by* one account, across all applications.
 *
 *  The mirror of the above, for a compromised user rather than a compromised
 *  app. Personal access tokens are separate and live on the account page —
 *  they are the user's own credentials rather than something granted to a
 *  third party, and lumping them in here would make the button mean two
 *  different things. */
app.post("/revoke/user/:userId/grants", async (c) => {
  const userId = c.req.param("userId");
  const user = await c.env.DB.prepare(
    "SELECT id, username FROM users WHERE id = ? AND kind = 'user'",
  )
    .bind(userId)
    .first<{ id: string; username: string }>();
  if (!user) return c.json({ error: "User not found" }, 404);

  const [tokens, consents] = await Promise.all([
    countRows(
      c.env.DB,
      "SELECT COUNT(*) AS n FROM oauth_tokens WHERE user_id = ?",
      [userId],
    ),
    countRows(
      c.env.DB,
      "SELECT COUNT(*) AS n FROM oauth_consents WHERE user_id = ?",
      [userId],
    ),
  ]);

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM oauth_tokens WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM oauth_codes WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM oauth_consents WHERE user_id = ?").bind(
      userId,
    ),
  ]);

  auditOps(
    c,
    "admin.revoke.user_grants",
    { tokens_revoked: tokens, consents_revoked: consents },
    { type: "user", id: user.id, name: user.username },
  );
  return c.json({
    message: "Authorizations revoked",
    tokens_revoked: tokens,
    consents_revoked: consents,
  });
});

// ─── Domains ──────────────────────────────────────────────────────────────────

/** Every domain on the instance, personal and team-owned.
 *
 *  There was no site-wide view of these at all: domains were reachable only
 *  through the account or team that owned them, which is the wrong index when
 *  the question is "who claims example.com". */
app.get("/domains", async (c) => {
  const { page, limit, offset } = readPage(
    c.req.query("page"),
    c.req.query("limit"),
    20,
    100,
  );
  const query = c.req.query("q")?.trim() ?? "";
  const filter = c.req.query("verified");

  const where: string[] = [];
  const args: unknown[] = [];
  if (query) {
    where.push("LOWER(d.domain) LIKE LOWER(?) ESCAPE '\\'");
    args.push(likePattern(query));
  }
  if (filter === "1" || filter === "0") where.push(`d.verified = ${filter}`);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [rows, count] = await Promise.all([
    c.env.DB.prepare(
      `SELECT d.*, u.username AS owner_username, t.name AS team_name, t.avatar_url AS team_avatar
         FROM domains d
         LEFT JOIN users u ON u.id = d.user_id
         LEFT JOIN teams t ON t.id = d.team_id
         ${whereSql}
        ORDER BY d.created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(...(args as never[]), limit, offset)
      .all<
        DomainRow & {
          owner_username: string | null;
          team_name: string | null;
          team_avatar: string | null;
        }
      >(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM domains d ${whereSql}`)
      .bind(...(args as never[]))
      .first<{ n: number }>(),
  ]);

  return c.json({
    domains: await Promise.all(
      rows.results.map(async (row) => ({
        ...row,
        verified: row.verified === 1,
        team_avatar: await proxyImageUrl(
          c.env.APP_URL,
          c.env.DB,
          row.team_avatar,
        ),
      })),
    ),
    total: count?.n ?? 0,
    page,
    limit,
  });
});

/** Mark a domain verified without a DNS check, or withdraw that.
 *
 *  Ordinary verification proves control of the name. This does not, and says
 *  so in the audit entry: it exists for domains whose DNS an operator cannot
 *  reach from the worker — split-horizon, an internal TLD, a registrar
 *  outage — where the alternative is the domain never working at all. */
app.post("/domains/:id/verify", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM domains WHERE id = ?")
    .bind(id)
    .first<DomainRow>();
  if (!row) return c.json({ error: "Domain not found" }, 404);

  const body = await c.req
    .json<{ verified?: boolean }>()
    .catch(() => ({}) as { verified?: boolean });
  const verified = body.verified !== false;

  await c.env.DB.prepare(
    "UPDATE domains SET verified = ?, verified_at = ? WHERE id = ?",
  )
    .bind(verified ? 1 : 0, verified ? Math.floor(Date.now() / 1000) : null, id)
    .run();

  auditOps(
    c,
    verified ? "admin.domain.force_verify" : "admin.domain.unverify",
    {
      domain: row.domain,
      // The distinction the log needs to keep: this verdict was asserted by an
      // administrator, not demonstrated by a DNS record.
      method: verified ? "admin_override" : null,
      owner_id: row.user_id,
      team_id: row.team_id,
    },
    { type: "domain", id: row.id, name: row.domain },
  );
  return c.json({
    message: verified ? "Domain marked verified" : "Verification withdrawn",
  });
});

app.delete("/domains/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT id, domain, user_id, team_id FROM domains WHERE id = ?",
  )
    .bind(id)
    .first<{
      id: string;
      domain: string;
      user_id: string | null;
      team_id: string | null;
    }>();
  if (!row) return c.json({ error: "Domain not found" }, 404);

  await c.env.DB.prepare("DELETE FROM domains WHERE id = ?").bind(id).run();
  auditOps(
    c,
    "admin.domain.delete",
    { domain: row.domain, owner_id: row.user_id, team_id: row.team_id },
    { type: "domain", id: row.id, name: row.domain },
  );
  return c.json({ message: "Domain deleted" });
});

// ─── Application ownership ────────────────────────────────────────────────────

/** Move an application to another owner.
 *
 *  Apps could move between a user and their own teams through the team
 *  endpoints, but nothing could move one to an unrelated account — which is
 *  what is needed when the owner leaves, or when an app was created under the
 *  wrong identity and its client_id is already deployed somewhere.
 *
 *  `owner_id` for a person, `team_id` for a team. The client_id and secret are
 *  untouched: the point is to keep the integration working. */
app.post("/apps/:id/transfer", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT id, name, owner_id, team_id FROM oauth_apps WHERE id = ? OR client_id = ?",
  )
    .bind(id, id)
    .first<{
      id: string;
      name: string;
      owner_id: string;
      team_id: string | null;
    }>();
  if (!row) return c.json({ error: "Application not found" }, 404);

  const body = await c.req.json<{ owner_id?: string; team_id?: string }>();
  if (!body.owner_id && !body.team_id)
    return c.json({ error: "owner_id or team_id is required" }, 400);
  if (body.owner_id && body.team_id)
    return c.json({ error: "Give owner_id or team_id, not both" }, 400);

  let newOwnerId: string;
  let newTeamId: string | null;
  if (body.team_id) {
    const team = await c.env.DB.prepare(
      "SELECT id, name FROM teams WHERE id = ?",
    )
      .bind(body.team_id)
      .first<{ id: string; name: string }>();
    if (!team) return c.json({ error: "Team not found" }, 404);
    // Team-owned apps hang off the synthetic `kind = 'team'` user row whose id
    // matches the team's, so owner_id and team_id move together.
    newOwnerId = team.id;
    newTeamId = team.id;
  } else {
    const user = await c.env.DB.prepare(
      "SELECT id FROM users WHERE kind = 'user' AND (id = ? OR username = ?)",
    )
      .bind(body.owner_id ?? "", body.owner_id ?? "")
      .first<{ id: string }>();
    if (!user) return c.json({ error: "User not found" }, 404);
    newOwnerId = user.id;
    newTeamId = null;
  }

  if (newOwnerId === row.owner_id && newTeamId === row.team_id)
    return c.json({ error: "The application already has that owner" }, 400);

  await c.env.DB.prepare(
    "UPDATE oauth_apps SET owner_id = ?, team_id = ?, updated_at = ? WHERE id = ?",
  )
    .bind(newOwnerId, newTeamId, Math.floor(Date.now() / 1000), row.id)
    .run();

  auditOps(
    c,
    "admin.app.transfer",
    {
      from: { owner_id: row.owner_id, team_id: row.team_id },
      to: { owner_id: newOwnerId, team_id: newTeamId },
    },
    { type: "app", id: row.id, name: row.name },
  );
  return c.json({ message: "Application transferred" });
});

// ─── Restricted accounts ──────────────────────────────────────────────────────

/** Lift the invite-registration restriction on an account.
 *
 *  The self-serve path (`POST /api/user/me/convert`) requires the holder to
 *  have a verified real address first — a rule about the account proving it is
 *  reachable, which an operator who has confirmed that some other way should
 *  be able to satisfy on their behalf. `require_verified_email: false` says
 *  they did, and the audit entry records that the check was waived. */
app.post("/users/:id/convert", async (c) => {
  const id = c.req.param("id");
  const user = await c.env.DB.prepare(
    `SELECT id, username, email, email_verified, origin_team_id, converted_at
       FROM users WHERE id = ? AND kind = 'user'`,
  )
    .bind(id)
    .first<{
      id: string;
      username: string;
      email: string;
      email_verified: number;
      origin_team_id: string | null;
      converted_at: number | null;
    }>();
  if (!user) return c.json({ error: "User not found" }, 404);
  if (!user.origin_team_id)
    return c.json({ error: "This account is not restricted" }, 400);
  if (user.converted_at)
    return c.json({ error: "This account has already been converted" }, 409);

  const body = await c.req
    .json<{ require_verified_email?: boolean }>()
    .catch(() => ({}) as { require_verified_email?: boolean });
  const requireVerified = body.require_verified_email !== false;
  if (requireVerified && user.email_verified !== 1)
    return c.json(
      {
        error:
          "This account has no verified email. Verify one first, or convert with require_verified_email: false.",
      },
      409,
    );

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    "UPDATE users SET converted_at = ?, origin_join_completed = 1, updated_at = ? WHERE id = ?",
  )
    .bind(now, now, id)
    .run();

  auditOps(
    c,
    "admin.user.converted",
    {
      origin_team_id: user.origin_team_id,
      email_verification_waived: !requireVerified,
    },
    { type: "user", id: user.id, name: user.username },
  );
  return c.json({ message: "Restriction lifted" });
});

// ─── Team invites ─────────────────────────────────────────────────────────────

/** Every outstanding team invite on the instance.
 *
 *  Invites were visible only from inside the team that issued them, which is
 *  the wrong index when a link has leaked and the question is "what else did
 *  this creator hand out". Registration-capable invites — the ones that mint
 *  accounts — are the reason this needs to be one list rather than a tour of
 *  every team page. */
app.get("/team-invites", async (c) => {
  const { page, limit, offset } = readPage(
    c.req.query("page"),
    c.req.query("limit"),
    20,
    100,
  );
  const query = c.req.query("q")?.trim() ?? "";
  const registrationOnly = c.req.query("registration") === "1";
  const now = Math.floor(Date.now() / 1000);

  const where: string[] = ["i.expires_at > ?"];
  const args: unknown[] = [now];
  if (query) {
    where.push(
      "(LOWER(t.name) LIKE LOWER(?) ESCAPE '\\' OR LOWER(i.email) LIKE LOWER(?) ESCAPE '\\')",
    );
    args.push(likePattern(query), likePattern(query));
  }
  if (registrationOnly) where.push("i.allows_registration = 1");
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [rows, count] = await Promise.all([
    c.env.DB.prepare(
      `SELECT i.token, i.team_id, i.role, i.email, i.max_uses, i.uses,
              i.expires_at, i.created_at, i.allows_registration,
              i.allow_existing_members,
              t.name AS team_name, u.username AS created_by_username
         FROM team_invites i
         LEFT JOIN teams t ON t.id = i.team_id
         LEFT JOIN users u ON u.id = i.created_by
         ${whereSql}
        ORDER BY i.created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(...(args as never[]), limit, offset)
      .all<Record<string, unknown>>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM team_invites i
         LEFT JOIN teams t ON t.id = i.team_id ${whereSql}`,
    )
      .bind(...(args as never[]))
      .first<{ n: number }>(),
  ]);

  const inviteTokens = rows.results.map((row) => String(row.token));
  const groupsByInvite = new Map<
    string,
    Array<{ id: string; slug: string; name: string; color: string | null }>
  >();
  if (inviteTokens.length > 0) {
    const placeholders = inviteTokens.map(() => "?").join(", ");
    const groupRows = await c.env.DB.prepare(
      `SELECT ig.invite_token, g.id, g.slug, g.name, g.color
         FROM team_invite_groups ig JOIN team_groups g ON g.id = ig.group_id
         JOIN teams t ON t.id = ig.team_id AND t.enable_groups = 1
        WHERE ig.invite_token IN (${placeholders}) ORDER BY g.name ASC`,
    )
      .bind(...inviteTokens)
      .all<{
        invite_token: string;
        id: string;
        slug: string;
        name: string;
        color: string | null;
      }>();
    for (const group of groupRows.results) {
      const list = groupsByInvite.get(group.invite_token);
      const value = {
        id: group.id,
        slug: group.slug,
        name: group.name,
        color: group.color,
      };
      if (list) list.push(value);
      else groupsByInvite.set(group.invite_token, [value]);
    }
  }

  return c.json({
    // The token is the credential. It is shown because an operator tracing a
    // leaked link needs to match what they were sent against what exists —
    // the same reason `GET /restricted-users?invite_token=` takes one.
    invites: rows.results.map((row) => ({
      ...row,
      allows_registration: row.allows_registration === 1,
      allow_existing_members: row.allow_existing_members === 1,
      groups: groupsByInvite.get(String(row.token)) ?? [],
    })),
    total: count?.n ?? 0,
    page,
    limit,
  });
});

app.delete("/team-invites/:token", async (c) => {
  const token = c.req.param("token");
  const row = await c.env.DB.prepare(
    `SELECT i.token, i.team_id, i.uses, t.name AS team_name
       FROM team_invites i LEFT JOIN teams t ON t.id = i.team_id
      WHERE i.token = ?`,
  )
    .bind(token)
    .first<{
      token: string;
      team_id: string;
      uses: number;
      team_name: string | null;
    }>();
  if (!row) return c.json({ error: "Invite not found" }, 404);

  await c.env.DB.prepare("DELETE FROM team_invites WHERE token = ?")
    .bind(token)
    .run();

  auditOps(
    c,
    "admin.team_invite.revoke",
    { team_id: row.team_id, uses: row.uses },
    { type: "team", id: row.team_id, name: row.team_name },
  );
  return c.json({ message: "Invite revoked" });
});

// ─── Bulk account actions ─────────────────────────────────────────────────────

/** Cap on one bulk call.
 *
 *  Not a performance limit — it is a blast-radius limit. An operator who means
 *  to act on more than this should say so more than once, and a request that
 *  can only ever affect fifty accounts is a mistake you can recover from. */
const BULK_LIMIT = 50;

/** Apply one action to several accounts.
 *
 *  Deliberately not a filter-based "deactivate everyone matching X": the
 *  caller sends explicit ids, so what they confirmed on screen is exactly what
 *  the server acts on. A filter evaluated server-side can match rows that
 *  appeared between the preview and the press. */
app.post("/users/bulk", async (c) => {
  const admin = c.get("user");
  const body = await c.req.json<{
    user_ids: string[];
    action: "deactivate" | "activate" | "delete";
  }>();

  if (!Array.isArray(body.user_ids) || body.user_ids.length === 0)
    return c.json({ error: "user_ids is required" }, 400);
  if (body.user_ids.length > BULK_LIMIT)
    return c.json(
      {
        error: `At most ${BULK_LIMIT} accounts per request`,
        limit: BULK_LIMIT,
      },
      400,
    );
  if (!["deactivate", "activate", "delete"].includes(body.action))
    return c.json(
      { error: "action must be deactivate, activate or delete" },
      400,
    );

  const placeholders = body.user_ids.map(() => "?").join(", ");
  const { results: targets } = await c.env.DB.prepare(
    `SELECT id, username FROM users
      WHERE id IN (${placeholders}) AND kind = 'user'`,
  )
    .bind(...(body.user_ids as never[]))
    .all<{ id: string; username: string }>();

  const skipped: Array<{ id: string; username: string; reason: string }> = [];
  const actionable = targets.filter((t) => {
    // An operator who bulk-deletes themselves out of the instance has no way
    // back, and LOCKDOWN_USERS exists precisely so a list like this cannot
    // take the last administrator with it.
    if (t.id === admin.id) {
      skipped.push({ ...t, reason: "self" });
      return false;
    }
    if (body.action === "delete" && isUserLocked(c.env, t.username)) {
      skipped.push({ ...t, reason: "locked" });
      return false;
    }
    return true;
  });

  const now = Math.floor(Date.now() / 1000);
  let affected = 0;
  for (const target of actionable) {
    if (body.action === "delete") {
      // Per-account so the team fan-out and the deletion record still happen;
      // a bulk DELETE would be faster and would silently skip both.
      await recordAccountDeletion(
        c.env,
        c.executionCtx,
        { id: target.id, username: target.username },
        {
          actorId: admin.id,
          actorName: admin.username,
          cause: "admin",
          ...auditRequestMeta(c),
        },
      );
      await c.env.DB.prepare("DELETE FROM users WHERE id = ?")
        .bind(target.id)
        .run();
    } else {
      await c.env.DB.prepare(
        "UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?",
      )
        .bind(body.action === "activate" ? 1 : 0, now, target.id)
        .run();
      // A deactivated account with live sessions is still signed in.
      if (body.action === "deactivate")
        await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?")
          .bind(target.id)
          .run();
    }
    affected++;
  }

  auditOps(c, `admin.users.bulk_${body.action}`, {
    requested: body.user_ids.length,
    affected,
    skipped,
    usernames: actionable.map((t) => t.username),
  });

  return c.json({
    message: "Done",
    action: body.action,
    affected,
    // Named, not just counted — "3 skipped" is not something an operator can
    // act on, and one of them being their own account matters.
    skipped,
  });
});

// ─── Elevated scope grants ────────────────────────────────────────────────────
//
// `site:*` and `site:team:*` scopes are the highest-privilege grants the OAuth
// layer issues: they let an application act across the instance, and the
// site-team ones deliberately bypass the team owner's consent. Team grants
// (`team:<id>:*`) are smaller but still reach into a team on someone's behalf.
//
// The grant tables are only a record, written each time someone approves an
// app. The authority itself lives in the stored approval (oauth_consents) and
// the tokens issued under it. So the list shows one row per app and account
// (site) or app and team (team), and only while the app still holds the
// authority somewhere; and revoking takes it out of the approval and the
// tokens, not just the record. Revoking the record alone would hide the grant
// and leave all of its effect.

type GrantKind = "site" | "team";

const readKind = (v: string): GrantKind | null =>
  v === "site" || v === "team" ? v : null;

const nowSec = () => Math.floor(Date.now() / 1000);

/** A token is live while it works or can still be refreshed. */
const LIVE = "(t.expires_at > ? OR t.refresh_expires_at > ?)";

/** Site grants, one row per app and account, while the app still holds them. */
app.get("/scope-grants/site", async (c) => {
  const { page, limit, offset } = readPage(
    c.req.query("page"),
    c.req.query("limit"),
    20,
    100,
  );
  const q = c.req.query("q")?.trim();
  const now = nowSec();
  const where = `g.id = (SELECT g2.id FROM site_scope_grants g2
                   WHERE g2.client_id = g.client_id
                     AND g2.grantee_user_id = g.grantee_user_id
                   ORDER BY g2.granted_at DESC, g2.id DESC LIMIT 1)
     AND (EXISTS (SELECT 1 FROM oauth_consents oc
                   WHERE oc.client_id = g.client_id
                     AND oc.user_id = g.grantee_user_id
                     AND oc.scopes LIKE '%site:%')
       OR EXISTS (SELECT 1 FROM oauth_tokens t
                   WHERE t.client_id = g.client_id
                     AND t.user_id = g.grantee_user_id
                     AND t.scopes LIKE '%site:%' AND ${LIVE}))
     ${
       q
         ? `AND (a.name LIKE ? ESCAPE '\\' OR g.client_id LIKE ? ESCAPE '\\'
              OR u.username LIKE ? ESCAPE '\\')`
         : ""
     }`;
  const args: unknown[] = [now, now];
  if (q) args.push(likePattern(q), likePattern(q), likePattern(q));
  const from = `FROM site_scope_grants g
    LEFT JOIN oauth_apps a ON a.client_id = g.client_id
    LEFT JOIN users u ON u.id = g.grantee_user_id`;

  const [rows, count] = await Promise.all([
    c.env.DB.prepare(
      `SELECT g.id, g.client_id, g.scopes, g.granted_at, g.grantee_user_id,
              a.name AS app_name, u.username AS grantee_username
         ${from} WHERE ${where}
        ORDER BY g.granted_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(...(args as never[]), limit, offset)
      .all<{
        id: string;
        client_id: string;
        scopes: string;
        granted_at: number;
        grantee_user_id: string | null;
        app_name: string | null;
        grantee_username: string | null;
      }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${where}`)
      .bind(...(args as never[]))
      .first<{ n: number }>(),
  ]);

  return c.json({
    grants: rows.results.map((row) => ({
      ...row,
      scopes: parseScopeList(row.scopes),
    })),
    total: count?.n ?? 0,
    page,
    limit,
  });
});

/** Team grants, one row per app and team, while the app still holds them.
 *  `?team_id=` narrows it to one team. */
app.get("/scope-grants/team", async (c) => {
  const { page, limit, offset } = readPage(
    c.req.query("page"),
    c.req.query("limit"),
    20,
    100,
  );
  const q = c.req.query("q")?.trim();
  const teamFilter = c.req.query("team_id")?.trim();
  const now = nowSec();
  const held = `'%team:' || g.team_id || ':%'`;
  const where = `g.id = (SELECT g2.id FROM team_scope_grants g2
                   WHERE g2.client_id = g.client_id
                     AND g2.team_id = g.team_id
                   ORDER BY g2.granted_at DESC, g2.id DESC LIMIT 1)
     AND (EXISTS (SELECT 1 FROM oauth_consents oc
                   WHERE oc.client_id = g.client_id AND oc.scopes LIKE ${held})
       OR EXISTS (SELECT 1 FROM oauth_tokens t
                   WHERE t.client_id = g.client_id
                     AND t.scopes LIKE ${held} AND ${LIVE}))
     ${teamFilter ? "AND g.team_id = ?" : ""}
     ${
       q
         ? `AND (a.name LIKE ? ESCAPE '\\' OR g.client_id LIKE ? ESCAPE '\\'
              OR tm.name LIKE ? ESCAPE '\\')`
         : ""
     }`;
  const args: unknown[] = [now, now];
  if (teamFilter) args.push(teamFilter);
  if (q) args.push(likePattern(q), likePattern(q), likePattern(q));
  const from = `FROM team_scope_grants g
    LEFT JOIN oauth_apps a ON a.client_id = g.client_id
    LEFT JOIN teams tm ON tm.id = g.team_id
    LEFT JOIN users u ON u.id = g.grantor_user_id`;

  const [rows, count] = await Promise.all([
    c.env.DB.prepare(
      `SELECT g.id, g.client_id, g.team_id, g.permissions, g.granted_at,
              g.grantor_user_id, a.name AS app_name, tm.name AS team_name,
              u.username AS grantor_username
         ${from} WHERE ${where}
        ORDER BY g.granted_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(...(args as never[]), limit, offset)
      .all<{
        id: string;
        client_id: string;
        team_id: string;
        permissions: string;
        granted_at: number;
        grantor_user_id: string | null;
        app_name: string | null;
        team_name: string | null;
        grantor_username: string | null;
      }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${where}`)
      .bind(...(args as never[]))
      .first<{ n: number }>(),
  ]);

  return c.json({
    grants: rows.results.map((row) => ({
      ...row,
      permissions: parseScopeList(row.permissions),
    })),
    total: count?.n ?? 0,
    page,
    limit,
  });
});

interface GrantRow {
  id: string;
  client_id: string;
  grantee_user_id?: string;
  team_id?: string;
}

async function loadGrant(
  db: D1Database,
  kind: GrantKind,
  id: string,
): Promise<GrantRow | null> {
  return kind === "site"
    ? db
        .prepare(
          "SELECT id, client_id, grantee_user_id FROM site_scope_grants WHERE id = ?",
        )
        .bind(id)
        .first<GrantRow>()
    : db
        .prepare(
          "SELECT id, client_id, team_id FROM team_scope_grants WHERE id = ?",
        )
        .bind(id)
        .first<GrantRow>();
}

/** The approvals, live tokens and pending codes that carry a grant. Site
 *  grants belong to one account; team grants to anyone who approved the app
 *  for that team. LIKE narrows the rows, grantMatcher decides. */
async function grantHolders(db: D1Database, kind: GrantKind, g: GrantRow) {
  const like = grantLike(kind, g.team_id);
  const matches = grantMatcher(kind, g.team_id);
  const carries = (row: { scopes: string }) =>
    parseScopeList(row.scopes).some(matches);
  const byUser = kind === "site" ? " AND user_id = ?" : "";
  const args: unknown[] =
    kind === "site" ? [g.client_id, g.grantee_user_id] : [g.client_id];
  const now = nowSec();

  const [consents, tokens, codes] = await Promise.all([
    db
      .prepare(
        `SELECT id, user_id, scopes FROM oauth_consents
          WHERE client_id = ?${byUser} AND scopes LIKE ?`,
      )
      .bind(...(args as never[]), like)
      .all<{ id: string; user_id: string; scopes: string }>(),
    db
      .prepare(
        `SELECT t.id, t.user_id, t.scopes FROM oauth_tokens t
          WHERE t.client_id = ?${byUser} AND t.scopes LIKE ? AND ${LIVE}`,
      )
      .bind(...(args as never[]), like, now, now)
      .all<{ id: string; user_id: string; scopes: string }>(),
    db
      .prepare(
        `SELECT code, scopes FROM oauth_codes
          WHERE client_id = ?${byUser} AND scopes LIKE ?`,
      )
      .bind(...(args as never[]), like)
      .all<{ code: string; scopes: string }>(),
  ]);
  return {
    consents: consents.results.filter(carries),
    tokens: tokens.results.filter(carries),
    codes: codes.results.filter(carries),
  };
}

/** One grant: who it's for, what the app holds now, and how many live
 *  tokens carry it. Any row of the app-and-account (or app-and-team) pair
 *  finds the same grant. */
app.get("/scope-grants/:kind/:id", async (c) => {
  const kind = readKind(c.req.param("kind"));
  if (!kind) return c.json({ error: "invalid_grant_kind" }, 400);
  const db = c.env.DB;
  const g = await loadGrant(db, kind, c.req.param("id"));
  if (!g) return c.json({ error: "scope_grant_not_found" }, 404);

  const history =
    kind === "site"
      ? db
          .prepare(
            `SELECT id, granted_at, scopes AS listed, admin_user_id AS by_id
               FROM site_scope_grants
              WHERE client_id = ? AND grantee_user_id = ?
              ORDER BY granted_at DESC, id DESC`,
          )
          .bind(g.client_id, g.grantee_user_id)
      : db
          .prepare(
            `SELECT id, granted_at, permissions AS listed, grantor_user_id AS by_id
               FROM team_scope_grants
              WHERE client_id = ? AND team_id = ?
              ORDER BY granted_at DESC, id DESC`,
          )
          .bind(g.client_id, g.team_id);

  const [rows, appRow, holders] = await Promise.all([
    history.all<{
      id: string;
      granted_at: number;
      listed: string;
      by_id: string;
    }>(),
    db
      .prepare("SELECT name FROM oauth_apps WHERE client_id = ?")
      .bind(g.client_id)
      .first<{ name: string }>(),
    grantHolders(db, kind, g),
  ]);
  const latest = rows.results[0];
  const first = rows.results[rows.results.length - 1];
  const userName = async (id: string | null | undefined) =>
    id
      ? ((
          await db
            .prepare("SELECT username FROM users WHERE id = ?")
            .bind(id)
            .first<{ username: string }>()
        )?.username ?? null)
      : null;

  const held = heldScopes(
    kind,
    [...holders.consents, ...holders.tokens].map((r) => r.scopes),
    g.team_id,
  );
  const base = {
    kind,
    id: latest.id,
    client_id: g.client_id,
    app_name: appRow?.name ?? null,
    granted_at: latest.granted_at,
    first_granted_at: first.granted_at,
    times_granted: rows.results.length,
    // What the latest approval listed, for when nothing is held any more.
    listed: parseScopeList(latest.listed),
    held_scopes: held,
    live_tokens: holders.tokens.length,
    accounts: new Set(
      [...holders.consents, ...holders.tokens].map((r) => r.user_id),
    ).size,
  };

  if (kind === "site")
    return c.json({
      grant: {
        ...base,
        grantee_user_id: g.grantee_user_id,
        grantee_username: await userName(g.grantee_user_id),
      },
    });

  const [team, role] = await Promise.all([
    db
      .prepare("SELECT name FROM teams WHERE id = ?")
      .bind(g.team_id)
      .first<{ name: string }>(),
    db
      .prepare(
        "SELECT role FROM team_members WHERE team_id = ? AND user_id = ?",
      )
      .bind(g.team_id, latest.by_id)
      .first<{ role: string }>(),
  ]);
  return c.json({
    grant: {
      ...base,
      team_id: g.team_id,
      team_name: team?.name ?? null,
      grantor_user_id: latest.by_id,
      grantor_username: await userName(latest.by_id),
      // The app acts with this role; null once the grantor has left.
      grantor_role: role?.role ?? null,
    },
  });
});

/** Withdraw a grant. `:kind` is `site` or `team`.
 *
 *  Takes the grant's scopes out of every stored approval that has them (an
 *  approval left with nothing is deleted), deletes the tokens and unused
 *  codes that carry them, and clears the record. The app keeps anything else
 *  it was approved for, and has to ask again for the rest. */
app.delete("/scope-grants/:kind/:id", async (c) => {
  const kind = readKind(c.req.param("kind"));
  if (!kind) return c.json({ error: "invalid_grant_kind" }, 400);
  const db = c.env.DB;
  const g = await loadGrant(db, kind, c.req.param("id"));
  if (!g) return c.json({ error: "scope_grant_not_found" }, 404);

  const holders = await grantHolders(db, kind, g);
  const statements = [
    ...holders.consents.map((row) => {
      const rest = stripGrant(row.scopes, kind, g.team_id);
      return rest
        ? db
            .prepare("UPDATE oauth_consents SET scopes = ? WHERE id = ?")
            .bind(rest, row.id)
        : db.prepare("DELETE FROM oauth_consents WHERE id = ?").bind(row.id);
    }),
    ...holders.tokens.map((row) =>
      db.prepare("DELETE FROM oauth_tokens WHERE id = ?").bind(row.id),
    ),
    ...holders.codes.map((row) =>
      db.prepare("DELETE FROM oauth_codes WHERE code = ?").bind(row.code),
    ),
    kind === "site"
      ? db
          .prepare(
            "DELETE FROM site_scope_grants WHERE client_id = ? AND grantee_user_id = ?",
          )
          .bind(g.client_id, g.grantee_user_id)
      : db
          .prepare(
            "DELETE FROM team_scope_grants WHERE client_id = ? AND team_id = ?",
          )
          .bind(g.client_id, g.team_id),
  ];
  await db.batch(statements);

  auditOps(
    c,
    "admin.scope_grant.revoke",
    {
      kind,
      client_id: g.client_id,
      ...(kind === "site"
        ? { user_id: g.grantee_user_id }
        : { team_id: g.team_id }),
      approvals: holders.consents.length,
      tokens: holders.tokens.length,
    },
    { type: "scope_grant", id: g.id, name: g.client_id },
  );
  return c.json({
    approvals: holders.consents.length,
    tokens: holders.tokens.length,
  });
});

// ─── Sessions ─────────────────────────────────────────────────────────────────

/** One account's live sessions, with where each has been used from.
 *
 *  The account detail endpoint already returns bare session rows. This adds
 *  the IP history behind each one — the same data the user sees on their own
 *  security page — because "is this login the attacker's" is a question about
 *  where a session has been, not when it was created. */
app.get("/users/:id/sessions", async (c) => {
  const userId = c.req.param("id");
  const now = Math.floor(Date.now() / 1000);

  const { results: sessions } = await c.env.DB.prepare(
    `SELECT id, user_agent, ip_address, created_at, expires_at
       FROM sessions WHERE user_id = ? AND expires_at > ?
      ORDER BY created_at DESC LIMIT 100`,
  )
    .bind(userId, now)
    .all<{
      id: string;
      user_agent: string | null;
      ip_address: string | null;
      created_at: number;
      expires_at: number;
    }>();

  if (!sessions.length) return c.json({ sessions: [] });

  // One query for the whole page rather than one per session.
  const placeholders = sessions.map(() => "?").join(", ");
  const { results: ips } = await c.env.DB.prepare(
    `SELECT session_id, ip_address, geo, first_seen, last_seen
       FROM session_ips WHERE session_id IN (${placeholders})
      ORDER BY last_seen DESC`,
  )
    .bind(...(sessions.map((s) => s.id) as never[]))
    .all<{
      session_id: string;
      ip_address: string | null;
      geo: string | null;
      first_seen: number;
      last_seen: number;
    }>();

  const bySession = new Map<string, typeof ips>();
  for (const row of ips) {
    const list = bySession.get(row.session_id) ?? [];
    list.push(row);
    bySession.set(row.session_id, list);
  }

  return c.json({
    sessions: sessions.map((s) => ({
      ...s,
      ips: (bySession.get(s.id) ?? []).map((row) => ({
        ip_address: row.ip_address,
        geo: row.geo ? (JSON.parse(row.geo) as unknown) : null,
        first_seen: row.first_seen,
        last_seen: row.last_seen,
      })),
    })),
  });
});

/** End one session.
 *
 *  `DELETE /users/:id/sessions` already ends all of them. Ending one is the
 *  finer instrument: an account with a session from somewhere it shouldn't be
 *  does not need its owner logged out of everything else to fix that. */
app.delete("/users/:id/sessions/:sessionId", async (c) => {
  const userId = c.req.param("id");
  const user = await c.env.DB.prepare(
    "SELECT id, username FROM users WHERE id = ? AND kind = 'user'",
  )
    .bind(userId)
    .first<{ id: string; username: string }>();
  if (!user) return c.json({ error: "User not found" }, 404);

  const row = await c.env.DB.prepare(
    "SELECT id, ip_address FROM sessions WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("sessionId"), userId)
    .first<{ id: string; ip_address: string | null }>();
  if (!row) return c.json({ error: "Session not found" }, 404);

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(row.id),
    c.env.DB.prepare("DELETE FROM session_ips WHERE session_id = ?").bind(
      row.id,
    ),
  ]);

  auditOps(
    c,
    "admin.session.revoke",
    { session_id: row.id, ip: row.ip_address },
    { type: "user", id: user.id, name: user.username },
  );
  return c.json({ message: "Session ended" });
});

export default app;
