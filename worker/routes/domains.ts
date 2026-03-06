// Domain verification routes

import { Hono } from "hono";
import { randomBase64url, randomId } from "../lib/crypto";
import { getConfigValue } from "../lib/config";
import { requireAuth } from "../middleware/auth";
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

  const verified = await checkDnsTxtRecord(row.domain, row.verification_token);

  if (verified) {
    const reverifyDays = await getConfigValue(c.env.DB, "domain_reverify_days");
    const now = Math.floor(Date.now() / 1000);
    const nextReverify = now + reverifyDays * 24 * 60 * 60;

    await c.env.DB.prepare(
      "UPDATE domains SET verified = 1, verified_at = ?, next_reverify_at = ? WHERE id = ?",
    )
      .bind(now, nextReverify, id)
      .run();

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
  return c.json({ message: "Domain deleted" });
});

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
