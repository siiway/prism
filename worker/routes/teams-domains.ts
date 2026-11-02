// Team domains: /api/teams/:id/domains — adding, verifying and removing the
// domains a team owns.

import { Hono } from "hono";
import { randomId, randomBase64url } from "../lib/crypto";
import {
  checkMethod,
  isVerificationMethod,
  methodInstructions,
  tryAnyMethod,
  type VerificationMethod,
} from "../lib/domainOwnership";
import { getConfigValue } from "../lib/config";
import { readPage, likePattern } from "../lib/pagination";
import type { DomainRow, Variables } from "../types";
import { getTeamAncestors, hasRole, teamAuthority } from "../lib/teams";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

// ─── Team domains ─────────────────────────────────────────────────────────────

const DOMAIN_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

// List team domains. Includes domains owned by this team plus, as read-only
// `inherited_from`-tagged entries, every domain owned by an ancestor team
// (sub-teams inherit ancestor domains for verification + display). Honors
// the `inherit_team_domains` site config — when disabled the response
// contains direct domains only.
app.get(":id/domains", async (c) => {
  const id = c.req.param("id");
  const eff = await teamAuthority(c, id);
  if (!eff) return c.json({ error: "not_team_member" }, 403);

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
  const id = c.req.param("id");
  const eff = await teamAuthority(c, id);
  if (!eff) return c.json({ error: "not_team_member" }, 403);
  const row = await c.env.DB.prepare(
    "SELECT * FROM domains WHERE id = ? AND team_id = ?",
  )
    .bind(c.req.param("domainId"), id)
    .first<DomainRow>();
  if (!row) return c.json({ error: "domain_not_found" }, 404);
  return c.json({ domain: row });
});

// Add team domain
app.post(":id/domains", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const eff = await teamAuthority(c, id);
  if (!eff) return c.json({ error: "not_team_member" }, 403);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{ domain: string }>();
  if (!body.domain)
    return c.json(
      { error: "field_required", params: { field: "domain" } },
      400,
    );
  if (!DOMAIN_REGEX.test(body.domain))
    return c.json({ error: "domain_invalid" }, 400);

  const domain = body.domain.toLowerCase().trim();

  const existing = await c.env.DB.prepare(
    "SELECT id FROM domains WHERE team_id = ? AND domain = ?",
  )
    .bind(id, domain)
    .first();
  if (existing) return c.json({ error: "domain_exists" }, 409);

  const verificationToken = randomBase64url(24);
  const domainId = randomId();
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    "INSERT INTO domains (id, user_id, created_by, team_id, domain, verification_token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(domainId, user.id, user.id, id, domain, verificationToken, now)
    .run();

  const instructions = methodInstructions(domain, verificationToken);

  // Auto-verify if the team already owns a verified parent domain
  const parent = await verifiedTeamParentDomain(c.env.DB, id, domain);
  if (parent) {
    const reverifyDays = await getConfigValue(c.env.DB, "domain_reverify_days");
    const nextReverify = now + reverifyDays * 24 * 60 * 60;
    await c.env.DB.prepare(
      "UPDATE domains SET verified = 1, verified_at = ?, next_reverify_at = ? WHERE id = ?",
    )
      .bind(now, nextReverify, domainId)
      .run();
    return c.json(
      {
        id: domainId,
        domain,
        verification_token: verificationToken,
        ...instructions,
        verified: true,
        verified_by_parent: parent,
      },
      201,
    );
  }

  return c.json(
    {
      id: domainId,
      domain,
      verification_token: verificationToken,
      ...instructions,
      verified: false,
    },
    201,
  );
});

// Verify team domain. Body: { method?: "dns-txt" | "http-file" | "html-meta" }
// If method is omitted, every method is tried until one succeeds.
app.post(":id/domains/:domainId/verify", async (c) => {
  const id = c.req.param("id");
  const domainId = c.req.param("domainId");
  const eff = await teamAuthority(c, id);
  if (!eff) return c.json({ error: "not_team_member" }, 403);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "forbidden" }, 403);

  const row = await c.env.DB.prepare(
    "SELECT * FROM domains WHERE id = ? AND team_id = ?",
  )
    .bind(domainId, id)
    .first<DomainRow>();
  if (!row) return c.json({ error: "domain_not_found" }, 404);

  let requestedMethod: VerificationMethod | null = null;
  try {
    const body = (await c.req
      .json<{ method?: unknown }>()
      .catch(() => ({}))) as {
      method?: unknown;
    };
    if (body.method !== undefined) {
      if (!isVerificationMethod(body.method))
        return c.json({ error: "verification_method_invalid" }, 400);
      requestedMethod = body.method;
    }
  } catch {
    // empty body — treat as auto
  }

  const reverifyDays = await getConfigValue(c.env.DB, "domain_reverify_days");
  const now = Math.floor(Date.now() / 1000);
  const nextReverify = now + reverifyDays * 24 * 60 * 60;

  const parent = await verifiedTeamParentDomain(c.env.DB, id, row.domain);
  if (parent) {
    await c.env.DB.prepare(
      "UPDATE domains SET verified = 1, verified_at = ?, next_reverify_at = ?, verification_method = NULL WHERE id = ?",
    )
      .bind(now, nextReverify, domainId)
      .run();
    return c.json({
      verified: true,
      next_reverify_at: nextReverify,
      verified_by_parent: parent,
    });
  }

  const succeededMethod: VerificationMethod | null = requestedMethod
    ? (await checkMethod(requestedMethod, row.domain, row.verification_token))
      ? requestedMethod
      : null
    : await tryAnyMethod(row.domain, row.verification_token);

  if (succeededMethod) {
    await c.env.DB.prepare(
      "UPDATE domains SET verified = 1, verified_at = ?, next_reverify_at = ?, verification_method = ? WHERE id = ?",
    )
      .bind(now, nextReverify, succeededMethod, domainId)
      .run();
    return c.json({
      verified: true,
      next_reverify_at: nextReverify,
      verification_method: succeededMethod,
    });
  }

  const instructions = methodInstructions(row.domain, row.verification_token);
  return c.json({
    verified: false,
    attempted_method: requestedMethod,
    instructions,
  });
});

// Delete team domain
app.delete(":id/domains/:domainId", async (c) => {
  const id = c.req.param("id");
  const domainId = c.req.param("domainId");
  const eff = await teamAuthority(c, id);
  if (!eff) return c.json({ error: "not_team_member" }, 403);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "forbidden" }, 403);

  const row = await c.env.DB.prepare(
    "SELECT id FROM domains WHERE id = ? AND team_id = ?",
  )
    .bind(domainId, id)
    .first();
  if (!row) return c.json({ error: "domain_not_found" }, 404);

  await c.env.DB.prepare("DELETE FROM domains WHERE id = ?")
    .bind(domainId)
    .run();
  return c.json({ ok: true });
});

// Return team domain to its creator's personal domains
app.post(":id/domains/:domainId/to-personal", async (c) => {
  const id = c.req.param("id");
  const domainId = c.req.param("domainId");
  const eff = await teamAuthority(c, id);
  if (!eff) return c.json({ error: "not_team_member" }, 403);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "forbidden" }, 403);

  const row = await c.env.DB.prepare(
    "SELECT * FROM domains WHERE id = ? AND team_id = ?",
  )
    .bind(domainId, id)
    .first<import("../types").DomainRow>();
  if (!row) return c.json({ error: "domain_not_found" }, 404);

  // Check if the creator already has this domain personally
  const conflict = await c.env.DB.prepare(
    "SELECT id FROM domains WHERE user_id = ? AND team_id IS NULL AND domain = ?",
  )
    .bind(row.user_id, row.domain)
    .first();
  if (conflict) return c.json({ error: "domain_adder_owns_it" }, 409);

  await c.env.DB.prepare("UPDATE domains SET team_id = NULL WHERE id = ?")
    .bind(domainId)
    .run();

  return c.json({ ok: true });
});

// Share team domain to another team (copy — keeps source, creates new row in target)
app.post(":id/domains/:domainId/share-to-team", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const domainId = c.req.param("domainId");
  const eff = await teamAuthority(c, id);
  if (!eff) return c.json({ error: "not_team_member" }, 403);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "forbidden" }, 403);

  const row = await c.env.DB.prepare(
    "SELECT * FROM domains WHERE id = ? AND team_id = ?",
  )
    .bind(domainId, id)
    .first<DomainRow>();
  if (!row) return c.json({ error: "domain_not_found" }, 404);

  const body = await c.req.json<{ team_id: string }>();
  if (!body.team_id)
    return c.json(
      { error: "field_required", params: { field: "team_id" } },
      400,
    );
  if (body.team_id === id) return c.json({ error: "share_same_team" }, 400);

  // Requester must be admin+ in the target team (effective)
  const targetEff = await teamAuthority(c, body.team_id);
  if (!targetEff || !hasRole(targetEff.role, "admin"))
    return c.json({ error: "target_team_admin_required" }, 403);

  // Target team must not already have this domain
  const conflict = await c.env.DB.prepare(
    "SELECT id FROM domains WHERE team_id = ? AND domain = ?",
  )
    .bind(body.team_id, row.domain)
    .first();
  if (conflict) return c.json({ error: "team_has_domain" }, 409);

  const newId = randomId();
  const newToken = randomBase64url(24);
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    `INSERT INTO domains
      (id, user_id, created_by, team_id, domain, verification_token,
       verified, verified_at, next_reverify_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      newId,
      user.id,
      user.id,
      body.team_id,
      row.domain,
      newToken,
      row.verified,
      row.verified_at ?? null,
      row.next_reverify_at ?? null,
      now,
    )
    .run();

  return c.json({ id: newId, domain: row.domain, verified: !!row.verified });
});

// Share team domain to personal (copy — keeps team source, creates personal row for requester)
app.post(":id/domains/:domainId/share-to-personal", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const domainId = c.req.param("domainId");
  const eff = await teamAuthority(c, id);
  if (!eff) return c.json({ error: "not_team_member" }, 403);
  if (!hasRole(eff.role, "admin")) return c.json({ error: "forbidden" }, 403);

  const row = await c.env.DB.prepare(
    "SELECT * FROM domains WHERE id = ? AND team_id = ?",
  )
    .bind(domainId, id)
    .first<DomainRow>();
  if (!row) return c.json({ error: "domain_not_found" }, 404);

  // User must not already own this domain personally
  const conflict = await c.env.DB.prepare(
    "SELECT id FROM domains WHERE user_id = ? AND team_id IS NULL AND domain = ?",
  )
    .bind(user.id, row.domain)
    .first();
  if (conflict) return c.json({ error: "domain_already_yours" }, 409);

  const newId = randomId();
  const newToken = randomBase64url(24);
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    `INSERT INTO domains
      (id, user_id, created_by, team_id, domain, verification_token,
       verified, verified_at, next_reverify_at, created_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      newId,
      user.id,
      user.id,
      row.domain,
      newToken,
      row.verified,
      row.verified_at ?? null,
      row.next_reverify_at ?? null,
      now,
    )
    .run();

  return c.json({ id: newId, domain: row.domain, verified: !!row.verified });
});

async function verifiedTeamParentDomain(
  db: D1Database,
  teamId: string,
  domain: string,
): Promise<string | null> {
  // When `inherit_team_domains` is disabled we only consult the team's
  // own verified domains for auto-verification, matching the listing
  // behavior.
  const inheritDomains = await getConfigValue(db, "inherit_team_domains");
  const teamIds = inheritDomains
    ? (await getTeamAncestors(db, teamId)).map((a) => a.id)
    : [teamId];
  if (!teamIds.length) return null;
  const placeholders = teamIds.map(() => "?").join(",");
  const parts = domain.split(".");
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join(".");
    const row = await db
      .prepare(
        `SELECT domain FROM domains
         WHERE team_id IN (${placeholders}) AND domain = ? AND verified = 1
         LIMIT 1`,
      )
      .bind(...teamIds, parent)
      .first<{ domain: string }>();
    if (row) return row.domain;
  }
  return null;
}

export default app;
