// Domain verification routes

import { Hono } from "hono";
import { randomBase64url, randomId } from "../lib/crypto";
import { getConfigValue } from "../lib/config";
import { requireAuth } from "../middleware/auth";
import { deliverUserWebhooks } from "../lib/webhooks";
import { deliverUserEmailNotifications } from "../lib/notifications";
import type { DomainRow, Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

app.use("*", requireAuth);

// List user's domains
app.get("/", async (c) => {
  const user = c.get("user");
  const rows = await c.env.DB.prepare(
    "SELECT * FROM domains WHERE user_id = ? ORDER BY created_at DESC",
  )
    .bind(user.id)
    .all<DomainRow>();
  return c.json({ domains: rows.results });
});

// Add domain
app.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ domain: string; app_id?: string }>();

  if (!body.domain) return c.json({ error: "domain is required" }, 400);

  // Basic domain validation
  const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
  if (!domainRegex.test(body.domain))
    return c.json({ error: "Invalid domain format" }, 400);

  const domain = body.domain.toLowerCase().trim();

  const existing = await c.env.DB.prepare(
    "SELECT id FROM domains WHERE user_id = ? AND domain = ?",
  )
    .bind(user.id, domain)
    .first();
  if (existing) return c.json({ error: "Domain already added" }, 409);

  const verificationToken = randomBase64url(24);
  const id = randomId();
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    "INSERT INTO domains (id, user_id, app_id, domain, verification_token, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(id, user.id, body.app_id ?? null, domain, verificationToken, now)
    .run();

  // Auto-verify if the user already owns a verified parent domain
  const parent = await verifiedParentDomain(c.env.DB, user.id, domain);
  if (parent) {
    const reverifyDays = await getConfigValue(c.env.DB, "domain_reverify_days");
    const nextReverify = now + reverifyDays * 24 * 60 * 60;
    await c.env.DB.prepare(
      "UPDATE domains SET verified = 1, verified_at = ?, next_reverify_at = ? WHERE id = ?",
    )
      .bind(now, nextReverify, id)
      .run();
    return c.json(
      {
        id,
        domain,
        verification_token: verificationToken,
        txt_record: `_prism-verify.${domain}`,
        txt_value: `prism-verify=${verificationToken}`,
        verified: true,
        verified_by_parent: parent,
      },
      201,
    );
  }

  c.executionCtx.waitUntil(
    deliverUserWebhooks(c.env.DB, user.id, "domain.added", {
      domain_id: id,
      domain,
    }).catch(() => {}),
  );
  c.executionCtx.waitUntil(
    deliverUserEmailNotifications(
      c.env.DB,
      user.id,
      "domain.added",
      {
        domain_id: id,
        domain,
      },
      c.env.APP_URL,
    ).catch(() => {}),
  );
  return c.json(
    {
      id,
      domain,
      verification_token: verificationToken,
      txt_record: `_prism-verify.${domain}`,
      txt_value: `prism-verify=${verificationToken}`,
      verified: false,
    },
    201,
  );
});

// Verify domain (check DNS TXT record)
app.post("/:id/verify", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const row = await c.env.DB.prepare(
    "SELECT * FROM domains WHERE id = ? AND user_id = ?",
  )
    .bind(id, user.id)
    .first<DomainRow>();
  if (!row) return c.json({ error: "Domain not found" }, 404);

  const reverifyDays = await getConfigValue(c.env.DB, "domain_reverify_days");
  const now = Math.floor(Date.now() / 1000);
  const nextReverify = now + reverifyDays * 24 * 60 * 60;

  // Auto-verify if the user owns a verified parent domain
  const parent = await verifiedParentDomain(c.env.DB, user.id, row.domain);
  if (parent) {
    await c.env.DB.prepare(
      "UPDATE domains SET verified = 1, verified_at = ?, next_reverify_at = ? WHERE id = ?",
    )
      .bind(now, nextReverify, id)
      .run();
    return c.json({
      verified: true,
      next_reverify_at: nextReverify,
      verified_by_parent: parent,
    });
  }

  const verified = await checkDnsTxtRecord(row.domain, row.verification_token);

  if (verified) {
    await c.env.DB.prepare(
      "UPDATE domains SET verified = 1, verified_at = ?, next_reverify_at = ? WHERE id = ?",
    )
      .bind(now, nextReverify, id)
      .run();
    c.executionCtx.waitUntil(
      deliverUserWebhooks(c.env.DB, user.id, "domain.verified", {
        domain_id: id,
        domain: row.domain,
      }).catch(() => {}),
    );
    c.executionCtx.waitUntil(
      deliverUserEmailNotifications(
        c.env.DB,
        user.id,
        "domain.verified",
        {
          domain_id: id,
          domain: row.domain,
        },
        c.env.APP_URL,
      ).catch(() => {}),
    );
    return c.json({ verified: true, next_reverify_at: nextReverify });
  }

  return c.json(
    {
      verified: false,
      message: `Add TXT record: _prism-verify.${row.domain} = prism-verify=${row.verification_token}`,
    },
    200,
  );
});

// Transfer personal domain to a team
app.post("/:id/transfer", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const row = await c.env.DB.prepare(
    "SELECT * FROM domains WHERE id = ? AND user_id = ? AND team_id IS NULL",
  )
    .bind(id, user.id)
    .first<DomainRow>();
  if (!row) return c.json({ error: "Domain not found" }, 404);

  const body = await c.req.json<{ team_id: string }>();
  if (!body.team_id) return c.json({ error: "team_id is required" }, 400);

  // Requester must be admin+ in the target team
  const member = await c.env.DB.prepare(
    "SELECT role FROM team_members WHERE team_id = ? AND user_id = ?",
  )
    .bind(body.team_id, user.id)
    .first<{ role: string }>();
  if (!member || (member.role !== "owner" && member.role !== "admin"))
    return c.json({ error: "Forbidden: must be team admin or owner" }, 403);

  // Team must not already have this domain
  const conflict = await c.env.DB.prepare(
    "SELECT id FROM domains WHERE team_id = ? AND domain = ?",
  )
    .bind(body.team_id, row.domain)
    .first();
  if (conflict) return c.json({ error: "Team already has this domain" }, 409);

  await c.env.DB.prepare("UPDATE domains SET team_id = ? WHERE id = ?")
    .bind(body.team_id, id)
    .run();

  return c.json({ message: "Domain transferred to team" });
});

// Share personal domain to a team (copy — source stays, target gets a new verified row)
app.post("/:id/share", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const row = await c.env.DB.prepare(
    "SELECT * FROM domains WHERE id = ? AND user_id = ? AND team_id IS NULL",
  )
    .bind(id, user.id)
    .first<DomainRow>();
  if (!row) return c.json({ error: "Domain not found" }, 404);

  const body = await c.req.json<{ team_id: string }>();
  if (!body.team_id) return c.json({ error: "team_id is required" }, 400);

  // Requester must be admin+ in the target team
  const member = await c.env.DB.prepare(
    "SELECT role FROM team_members WHERE team_id = ? AND user_id = ?",
  )
    .bind(body.team_id, user.id)
    .first<{ role: string }>();
  if (!member || (member.role !== "owner" && member.role !== "admin"))
    return c.json({ error: "Forbidden: must be team admin or owner" }, 403);

  // Target team must not already have this domain
  const conflict = await c.env.DB.prepare(
    "SELECT id FROM domains WHERE team_id = ? AND domain = ?",
  )
    .bind(body.team_id, row.domain)
    .first();
  if (conflict) return c.json({ error: "Team already has this domain" }, 409);

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

// Delete domain
app.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT * FROM domains WHERE id = ? AND user_id = ?",
  )
    .bind(id, user.id)
    .first<DomainRow>();
  if (!row) return c.json({ error: "Domain not found" }, 404);

  await c.env.DB.prepare("DELETE FROM domains WHERE id = ?").bind(id).run();
  c.executionCtx.waitUntil(
    deliverUserWebhooks(c.env.DB, user.id, "domain.deleted", {
      domain_id: id,
      domain: row.domain,
    }).catch(() => {}),
  );
  c.executionCtx.waitUntil(
    deliverUserEmailNotifications(
      c.env.DB,
      user.id,
      "domain.deleted",
      {
        domain_id: id,
        domain: row.domain,
      },
      c.env.APP_URL,
    ).catch(() => {}),
  );
  return c.json({ message: "Domain deleted" });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Returns the verified parent domain if the user owns one, otherwise null.
// e.g. "git.siiway.org" → checks "siiway.org"
async function verifiedParentDomain(
  db: D1Database,
  userId: string,
  domain: string,
): Promise<string | null> {
  const parts = domain.split(".");
  // Need at least 3 parts to have a meaningful parent (sub.apex.tld)
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join(".");
    const row = await db
      .prepare(
        "SELECT domain FROM domains WHERE user_id = ? AND domain = ? AND team_id IS NULL AND verified = 1",
      )
      .bind(userId, parent)
      .first<{ domain: string }>();
    if (row) return row.domain;
  }
  return null;
}

// ─── DNS verification ─────────────────────────────────────────────────────────

async function checkDnsTxtRecord(
  domain: string,
  expectedToken: string,
): Promise<boolean> {
  try {
    const hostname = `_prism-verify.${domain}`;
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=TXT`,
      { headers: { Accept: "application/dns-json" } },
    );
    if (!res.ok) return false;

    const data = (await res.json()) as {
      Answer?: Array<{ type: number; data: string }>;
    };

    const expectedValue = `"prism-verify=${expectedToken}"`;
    return (data.Answer ?? []).some(
      (record) => record.type === 16 && record.data === expectedValue,
    );
  } catch {
    return false;
  }
}

export default app;
