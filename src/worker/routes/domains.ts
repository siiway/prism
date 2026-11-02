// Domain verification routes

import { guardCapability } from "../lib/userCapabilities";
import { Hono, type Context } from "hono";
import { readPage, likePattern } from "../lib/pagination";
import { requireAuth } from "../middleware/auth";
import { auditRequestAction } from "../lib/audit";
import {
  deliverUserEmailNotifications,
  notificationActorMetaFromHeaders,
} from "../lib/notifications";
import {
  copyDomain,
  createDomain,
  parseDomainInput,
  readRequestedMethod,
  verifyDomain,
} from "../lib/domains";
import type { DomainRow, Variables } from "../types";
import { hasRole, teamAuthority } from "../lib/teams";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

app.use("*", requireAuth);

/** One of the caller's personal domains, or null. */
function loadOwnDomain(c: Context<AppEnv>, id: string) {
  return c.env.DB.prepare(
    "SELECT * FROM domains WHERE id = ? AND user_id = ? AND team_id IS NULL",
  )
    .bind(id, c.get("user").id)
    .first<DomainRow>();
}

/** Audit a change to one of the caller's domains and email them about it. */
function recordDomainEvent(
  c: Context<AppEnv>,
  event: "added" | "verified" | "deleted",
  domainId: string,
  domain: string,
  extra: Record<string, unknown> = {},
) {
  const user = c.get("user");
  const action = { added: "add", verified: "verify", deleted: "delete" }[event];
  auditRequestAction(
    c,
    {
      action: `domain.${action}`,
      resourceType: "domain",
      resourceId: domainId,
      resourceName: domain,
      metadata: { domain, ...extra },
    },
    [{ scope: "user", scopeId: user.id }],
  );
  c.executionCtx.waitUntil(
    deliverUserEmailNotifications(
      c.env,
      user.id,
      `domain.${event}`,
      {
        domain_id: domainId,
        domain,
        ...extra,
        ...notificationActorMetaFromHeaders(c.req.raw.headers),
      },
      c.env.APP_URL,
    ).catch(() => {}),
  );
}

/**
 * The team a personal domain is being moved or copied to, from the body's
 * `team_id`. The caller must be admin+ there (or a site admin), and the team
 * must not already have the domain.
 */
async function targetTeam(
  c: Context<AppEnv>,
  row: DomainRow,
): Promise<string | Response> {
  const body = await c.req.json<{ team_id: string }>();
  if (!body.team_id)
    return c.json(
      { error: "field_required", params: { field: "team_id" } },
      400,
    );
  const member = await teamAuthority(c, body.team_id);
  if (!member || !hasRole(member.role, "admin"))
    return c.json({ error: "team_admin_required" }, 403);
  const conflict = await c.env.DB.prepare(
    "SELECT id FROM domains WHERE team_id = ? AND domain = ?",
  )
    .bind(body.team_id, row.domain)
    .first();
  if (conflict) return c.json({ error: "team_has_domain" }, 409);
  return body.team_id;
}

// List user's domains
app.get("/", async (c) => {
  const user = c.get("user");
  const { page, limit, offset } = readPage(
    c.req.query("page"),
    c.req.query("limit"),
    20,
  );
  const query = c.req.query("q")?.trim() ?? "";

  const where = query
    ? "user_id = ? AND team_id IS NULL AND LOWER(domain) LIKE LOWER(?) ESCAPE '\\'"
    : "user_id = ? AND team_id IS NULL";
  const args: unknown[] = query ? [user.id, likePattern(query)] : [user.id];

  const [rows, countRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT * FROM domains WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(...args, limit, offset)
      .all<DomainRow>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM domains WHERE ${where}`)
      .bind(...args)
      .first<{ n: number }>(),
  ]);
  return c.json({
    domains: rows.results,
    total: countRow?.n ?? 0,
    page,
    limit,
  });
});

// One of your domains
app.get("/:id", async (c) => {
  const row = await loadOwnDomain(c, c.req.param("id"));
  if (!row) return c.json({ error: "domain_not_found" }, 404);
  return c.json({ domain: row });
});

// Add domain
app.post("/", async (c) => {
  const user = c.get("user");

  const capErr = await guardCapability(c.env.DB, user.id, "domain:create");
  if (capErr) return c.json({ error: capErr }, 403);

  const body = await c.req.json<{ domain: string; app_id?: string }>();
  if (!body.domain)
    return c.json(
      { error: "field_required", params: { field: "domain" } },
      400,
    );
  const domain = parseDomainInput(body.domain);
  if (!domain) return c.json({ error: "domain_invalid" }, 400);

  const existing = await c.env.DB.prepare(
    "SELECT id FROM domains WHERE user_id = ? AND domain = ? AND team_id IS NULL",
  )
    .bind(user.id, domain)
    .first();
  if (existing) return c.json({ error: "domain_exists" }, 409);

  const created = await createDomain(c.env.DB, {
    userId: user.id,
    teamId: null,
    domain,
    appId: body.app_id,
  });
  recordDomainEvent(c, "added", created.id, domain);
  return c.json(created, 201);
});

// Verify domain. Body: { method?: "dns-txt" | "http-file" | "html-meta" }
// If method is omitted, every method is tried until one succeeds.
app.post("/:id/verify", async (c) => {
  const row = await loadOwnDomain(c, c.req.param("id"));
  if (!row) return c.json({ error: "domain_not_found" }, 404);

  const method = await readRequestedMethod(c);
  if (method === "invalid")
    return c.json({ error: "verification_method_invalid" }, 400);

  const outcome = await verifyDomain(c.env.DB, row, method);
  if ("verification_method" in outcome)
    recordDomainEvent(c, "verified", row.id, row.domain, {
      verification_method: outcome.verification_method,
    });
  return c.json(outcome);
});

// Transfer personal domain to a team
app.post("/:id/transfer", async (c) => {
  const row = await loadOwnDomain(c, c.req.param("id"));
  if (!row) return c.json({ error: "domain_not_found" }, 404);

  const teamId = await targetTeam(c, row);
  if (teamId instanceof Response) return teamId;

  await c.env.DB.prepare("UPDATE domains SET team_id = ? WHERE id = ?")
    .bind(teamId, row.id)
    .run();
  return c.json({ ok: true });
});

// Share personal domain to a team (copy — source stays, target gets a new verified row)
app.post("/:id/share", async (c) => {
  const row = await loadOwnDomain(c, c.req.param("id"));
  if (!row) return c.json({ error: "domain_not_found" }, 404);

  const teamId = await targetTeam(c, row);
  if (teamId instanceof Response) return teamId;

  return c.json(
    await copyDomain(c.env.DB, row, { userId: c.get("user").id, teamId }),
  );
});

// Delete domain
app.delete("/:id", async (c) => {
  const row = await loadOwnDomain(c, c.req.param("id"));
  if (!row) return c.json({ error: "domain_not_found" }, 404);

  await c.env.DB.prepare("DELETE FROM domains WHERE id = ?").bind(row.id).run();
  recordDomainEvent(c, "deleted", row.id, row.domain);
  return c.json({ ok: true });
});

export default app;
