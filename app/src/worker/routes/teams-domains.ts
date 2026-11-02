// Team domains: /api/teams/:id/domains — adding, verifying and removing the
// domains a team owns.

import { Hono, type Context } from "hono";
import { getConfigValue } from "../lib/config";
import {
  copyDomain,
  addDomain,
  readRequestedMethod,
  verifyDomain,
} from "../lib/domains";
import { readPage, likePattern } from "../lib/pagination";
import type { DomainRow, Variables } from "../types";
import { getTeamAncestors, hasRole, teamAuthority } from "../lib/teams";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

/**
 * The caller's authority over the `:id` team: any member may read its
 * domains, and changing them takes admin+.
 */
async function requireTeamDomainAccess(
  c: Context<AppEnv>,
  write: boolean,
): Promise<Response | null> {
  const eff = await teamAuthority(c, c.req.param("id")!);
  if (!eff) return c.json({ error: "not_team_member" }, 403);
  if (write && !hasRole(eff.role, "admin"))
    return c.json({ error: "forbidden" }, 403);
  return null;
}

/** The `:domainId` domain of the `:id` team, after the access check. */
async function loadTeamDomain(
  c: Context<AppEnv>,
  write: boolean,
): Promise<DomainRow | Response> {
  const denied = await requireTeamDomainAccess(c, write);
  if (denied) return denied;
  const row = await c.env.DB.prepare(
    "SELECT * FROM domains WHERE id = ? AND team_id = ?",
  )
    .bind(c.req.param("domainId"), c.req.param("id"))
    .first<DomainRow>();
  return row ?? c.json({ error: "domain_not_found" }, 404);
}

/** Whether `userId` already has `domain` among their personal domains. */
async function ownsPersonally(
  db: D1Database,
  userId: string,
  domain: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT id FROM domains WHERE user_id = ? AND team_id IS NULL AND domain = ?",
    )
    .bind(userId, domain)
    .first();
  return !!row;
}

// ─── Team domains ─────────────────────────────────────────────────────────────

// List team domains. Includes domains owned by this team plus, as read-only
// `inherited_from`-tagged entries, every domain owned by an ancestor team
// (sub-teams inherit ancestor domains for verification + display). Honors
// the `inherit_team_domains` site config — when disabled the response
// contains direct domains only.
app.get(":id/domains", async (c) => {
  const id = c.req.param("id");
  const denied = await requireTeamDomainAccess(c, false);
  if (denied) return denied;

  const { page, limit, offset } = readPage(
    c.req.query("page"),
    c.req.query("limit"),
    20,
  );
  const query = c.req.query("q")?.trim() ?? "";

  const ownWhere = query
    ? "team_id = ? AND LOWER(domain) LIKE LOWER(?) ESCAPE '\\'"
    : "team_id = ?";
  const ownArgs: unknown[] = query ? [id, likePattern(query)] : [id];

  const [own, countRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT * FROM domains WHERE ${ownWhere} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(...ownArgs, limit, offset)
      .all<DomainRow>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM domains WHERE ${ownWhere}`)
      .bind(...ownArgs)
      .first<{ n: number }>(),
  ]);

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
      inherited = results
        .filter(
          (r) => !query || r.domain.toLowerCase().includes(query.toLowerCase()),
        )
        .map((r) => ({ ...r, inherited_from: r.team_id! }));
    }
  }

  return c.json({
    domains: [
      ...own.results.map((d) => ({ ...d, inherited_from: null })),
      ...inherited,
    ],
    total: (countRow?.n ?? 0) + inherited.length,
    page,
    limit,
  });
});

// One domain the team owns. Any member can read it, like the list.
app.get(":id/domains/:domainId", async (c) => {
  const row = await loadTeamDomain(c, false);
  if (row instanceof Response) return row;
  return c.json({ domain: row });
});

// Add team domain
app.post(":id/domains", async (c) => {
  const id = c.req.param("id");
  const denied = await requireTeamDomainAccess(c, true);
  if (denied) return denied;

  const body = await c.req.json<{ domain: string }>();
  const added = await addDomain(c.env.DB, {
    userId: c.get("user").id,
    teamId: id,
    domain: body.domain,
  });
  if (!added.ok) return c.json(added.body, added.status);
  return c.json(added.created, 201);
});

// Verify team domain. Body: { method?: "dns-txt" | "http-file" | "html-meta" }
// If method is omitted, every method is tried until one succeeds.
app.post(":id/domains/:domainId/verify", async (c) => {
  const row = await loadTeamDomain(c, true);
  if (row instanceof Response) return row;

  const method = await readRequestedMethod(c);
  if (method === "invalid")
    return c.json({ error: "verification_method_invalid" }, 400);

  return c.json(await verifyDomain(c.env.DB, row, method));
});

// Delete team domain
app.delete(":id/domains/:domainId", async (c) => {
  const row = await loadTeamDomain(c, true);
  if (row instanceof Response) return row;

  await c.env.DB.prepare("DELETE FROM domains WHERE id = ?").bind(row.id).run();
  return c.json({ ok: true });
});

// Return team domain to its creator's personal domains
app.post(":id/domains/:domainId/to-personal", async (c) => {
  const row = await loadTeamDomain(c, true);
  if (row instanceof Response) return row;

  if (await ownsPersonally(c.env.DB, row.user_id, row.domain))
    return c.json({ error: "domain_adder_owns_it" }, 409);

  await c.env.DB.prepare("UPDATE domains SET team_id = NULL WHERE id = ?")
    .bind(row.id)
    .run();
  return c.json({ ok: true });
});

// Share team domain to another team (copy — keeps source, creates new row in target)
app.post(":id/domains/:domainId/share-to-team", async (c) => {
  const row = await loadTeamDomain(c, true);
  if (row instanceof Response) return row;

  const body = await c.req.json<{ team_id: string }>();
  if (!body.team_id)
    return c.json(
      { error: "field_required", params: { field: "team_id" } },
      400,
    );
  if (body.team_id === row.team_id)
    return c.json({ error: "share_same_team" }, 400);

  // Requester must be admin+ in the target team (effective)
  const targetEff = await teamAuthority(c, body.team_id);
  if (!targetEff || !hasRole(targetEff.role, "admin"))
    return c.json({ error: "target_team_admin_required" }, 403);

  const conflict = await c.env.DB.prepare(
    "SELECT id FROM domains WHERE team_id = ? AND domain = ?",
  )
    .bind(body.team_id, row.domain)
    .first();
  if (conflict) return c.json({ error: "team_has_domain" }, 409);

  return c.json(
    await copyDomain(c.env.DB, row, {
      userId: c.get("user").id,
      teamId: body.team_id,
    }),
  );
});

// Share team domain to personal (copy — keeps team source, creates personal row for requester)
app.post(":id/domains/:domainId/share-to-personal", async (c) => {
  const user = c.get("user");
  const row = await loadTeamDomain(c, true);
  if (row instanceof Response) return row;

  if (await ownsPersonally(c.env.DB, user.id, row.domain))
    return c.json({ error: "domain_already_yours" }, 409);

  return c.json(
    await copyDomain(c.env.DB, row, { userId: user.id, teamId: null }),
  );
});

export default app;
