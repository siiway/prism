// Transparent Control audit-log API.
//
// One router serves all three scopes, each behind its own authorization:
//   • /api/audit/me/*             — the caller's own user-scope log + webhooks
//   • /api/audit/team/:teamId/*   — team-scope log + webhooks (owner/co-owner)
//   • /api/audit/platform/*       — platform-scope log + webhooks (admin)

import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { randomId } from "../lib/crypto";
import { encryptSecret, decryptSecret } from "../lib/secretCrypto";
import { validateOutboundUrl } from "../lib/safeFetch";
import { getEffectiveMember } from "./teams";
import { recordAudit, auditRequestMeta } from "../lib/audit";
import type { AuditScope, AuditEventRow } from "../lib/audit";
import type { Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };

const app = new Hono<AppEnv>();

app.use("*", requireAuth);

const SECRET_MASK = "__prism_secret_unchanged__";
const WEBHOOK_KINDS = new Set(["discord", "telegram", "general"]);
const PAGE_SIZE = 50;

// ─── Shared event querying ────────────────────────────────────────────────────

interface EventFilters {
  from?: number;
  to?: number;
  action?: string;
  actorId?: string;
  resourceType?: string;
  resourceId?: string;
  page: number;
}

function readFilters(c: {
  req: { query: (k: string) => string | undefined };
}): EventFilters {
  const num = (v: string | undefined) => {
    const n = Number(v);
    return v && Number.isFinite(n) ? n : undefined;
  };
  return {
    from: num(c.req.query("from")),
    to: num(c.req.query("to")),
    action: c.req.query("action") || undefined,
    actorId: c.req.query("actor_id") || undefined,
    resourceType: c.req.query("resource_type") || undefined,
    resourceId: c.req.query("resource_id") || undefined,
    page: Math.max(1, num(c.req.query("page")) ?? 1),
  };
}

async function queryEvents(
  env: Env,
  scope: AuditScope,
  scopeId: string | null,
  f: EventFilters,
): Promise<{ events: AuditEventRow[]; total: number }> {
  const where: string[] = ["scope = ?"];
  const args: unknown[] = [scope];
  if (scopeId === null) where.push("scope_id IS NULL");
  else {
    where.push("scope_id = ?");
    args.push(scopeId);
  }
  if (f.from !== undefined) {
    where.push("created_at >= ?");
    args.push(f.from);
  }
  if (f.to !== undefined) {
    where.push("created_at <= ?");
    args.push(f.to);
  }
  if (f.action) {
    where.push("action = ?");
    args.push(f.action);
  }
  if (f.actorId) {
    where.push("actor_id = ?");
    args.push(f.actorId);
  }
  if (f.resourceType) {
    where.push("resource_type = ?");
    args.push(f.resourceType);
  }
  if (f.resourceId) {
    where.push("resource_id = ?");
    args.push(f.resourceId);
  }
  const clause = where.join(" AND ");
  const offset = (f.page - 1) * PAGE_SIZE;

  const [{ results }, countRow] = await Promise.all([
    env.DB.prepare(
      `SELECT * FROM audit_events WHERE ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
      .bind(...args, PAGE_SIZE, offset)
      .all<AuditEventRow>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_events WHERE ${clause}`)
      .bind(...args)
      .first<{ n: number }>(),
  ]);

  return { events: results, total: countRow?.n ?? 0 };
}

/** Hard cap on an export. Large enough to be a real record, small enough that
 *  the response is built in memory without gambling on the worker's limits —
 *  a truncated export that arrives beats a complete one that 500s. */
const EXPORT_LIMIT = 10_000;

/** The same query as {@link queryEvents}, unpaginated up to the cap.
 *
 *  Deliberately a separate function rather than a `page: 0` special case:
 *  paging and exporting want different limits and different failure modes,
 *  and folding them together is how one of them quietly acquires the other's. */
async function exportEvents(
  env: Env,
  scope: AuditScope,
  scopeId: string | null,
  f: EventFilters,
): Promise<AuditEventRow[]> {
  const where: string[] = ["scope = ?"];
  const args: unknown[] = [scope];
  if (scopeId === null) where.push("scope_id IS NULL");
  else {
    where.push("scope_id = ?");
    args.push(scopeId);
  }
  if (f.from !== undefined) {
    where.push("created_at >= ?");
    args.push(f.from);
  }
  if (f.to !== undefined) {
    where.push("created_at <= ?");
    args.push(f.to);
  }
  if (f.action) {
    where.push("action = ?");
    args.push(f.action);
  }
  if (f.actorId) {
    where.push("actor_id = ?");
    args.push(f.actorId);
  }
  if (f.resourceType) {
    where.push("resource_type = ?");
    args.push(f.resourceType);
  }
  if (f.resourceId) {
    where.push("resource_id = ?");
    args.push(f.resourceId);
  }

  const { results } = await env.DB.prepare(
    `SELECT * FROM audit_events WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC, id DESC LIMIT ?`,
  )
    .bind(...args, EXPORT_LIMIT)
    .all<AuditEventRow>();
  return results;
}

/** RFC 4180 quoting: wrap every field, double any embedded quote. Metadata is
 *  a JSON blob and will contain both commas and quotes, so nothing here is
 *  safe to emit bare. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const s = typeof value === "string" ? value : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

const CSV_COLUMNS: Array<keyof AuditEventRow> = [
  "created_at",
  "action",
  "actor_id",
  "actor_name",
  "resource_type",
  "resource_id",
  "resource_name",
  "ip",
  "user_agent",
  "ip_geo",
  "metadata",
];

function auditCsv(events: AuditEventRow[]): string {
  const header = ["timestamp", ...CSV_COLUMNS.slice(1)].join(",");
  const rows = events.map((e) =>
    CSV_COLUMNS.map((col) =>
      // created_at is a unix second; an ISO string is what a spreadsheet and
      // a human both read correctly, and the raw value is in the JSON export.
      col === "created_at"
        ? csvCell(new Date(e.created_at * 1000).toISOString())
        : csvCell(e[col]),
    ).join(","),
  );
  return [header, ...rows].join("\n");
}

/** Distinct action types present in a scope — powers the type filter dropdown. */
async function distinctActions(
  env: Env,
  scope: AuditScope,
  scopeId: string | null,
): Promise<string[]> {
  const { results } = await env.DB.prepare(
    scopeId === null
      ? "SELECT DISTINCT action FROM audit_events WHERE scope = ? AND scope_id IS NULL ORDER BY action"
      : "SELECT DISTINCT action FROM audit_events WHERE scope = ? AND scope_id = ? ORDER BY action",
  )
    .bind(...(scopeId === null ? [scope] : [scope, scopeId]))
    .all<{ action: string }>();
  return results.map((r) => r.action);
}

// ─── Shared webhook CRUD ──────────────────────────────────────────────────────

interface AuditWebhookRow {
  id: string;
  scope: string;
  scope_id: string | null;
  name: string;
  kind: string;
  config: string;
  events: string;
  is_active: number;
  created_at: number;
  updated_at: number;
  last_delivery_at: number | null;
  last_delivery_success: number | null;
  last_delivery_status: number | null;
  last_delivery_body: string | null;
}

/** Mask secret fields before returning a webhook config to its owner. */
function maskConfig(
  kind: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...config };
  if (kind === "discord" && out.webhook_url) out.webhook_url = SECRET_MASK;
  if (kind === "telegram" && out.bot_token) out.bot_token = SECRET_MASK;
  return out;
}

/** Merge an incoming config with the stored one, restoring masked secrets. */
function mergeConfig(
  kind: string,
  incoming: Record<string, unknown>,
  prior: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...incoming };
  if (kind === "discord" && out.webhook_url === SECRET_MASK)
    out.webhook_url = prior.webhook_url;
  if (kind === "telegram" && out.bot_token === SECRET_MASK)
    out.bot_token = prior.bot_token;
  return out;
}

/** Validate a webhook config for a kind. Returns an error string or null. */
function validateConfig(
  kind: string,
  config: Record<string, unknown>,
): string | null {
  if (kind === "discord") {
    const url = String(config.webhook_url ?? "");
    if (!url) return "webhook_url is required";
    if (url !== SECRET_MASK && validateOutboundUrl(url) !== null)
      return "webhook_url is not a valid public URL";
    return null;
  }
  if (kind === "telegram") {
    if (!config.bot_token) return "bot_token is required";
    return null;
  }
  if (kind === "general") {
    const url = String(config.url ?? "");
    // The URL may contain {placeholders}; validate only when it has none.
    if (!url) return "url is required";
    if (!/\{[a-z_]+\}/.test(url) && validateOutboundUrl(url) !== null)
      return "url is not a valid public URL";
    const method = String(config.method ?? "POST").toUpperCase();
    if (!["GET", "POST"].includes(method)) return "method must be GET or POST";
    return null;
  }
  return "unknown webhook kind";
}

async function decryptConfig(
  env: Env,
  row: AuditWebhookRow,
): Promise<Record<string, unknown>> {
  try {
    const raw = (await decryptSecret(env, row.config)) ?? row.config;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function publicWebhook(row: AuditWebhookRow, config: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    config: maskConfig(row.kind, config),
    events: JSON.parse(row.events) as string[],
    is_active: row.is_active === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_delivery:
      row.last_delivery_at != null
        ? {
            at: row.last_delivery_at,
            success: row.last_delivery_success === 1,
            status: row.last_delivery_status,
            body: row.last_delivery_body ?? "",
          }
        : null,
  };
}

async function listWebhooks(
  env: Env,
  scope: AuditScope,
  scopeId: string | null,
) {
  const { results } = await env.DB.prepare(
    scopeId === null
      ? "SELECT * FROM audit_webhooks WHERE scope = ? AND scope_id IS NULL ORDER BY created_at DESC"
      : "SELECT * FROM audit_webhooks WHERE scope = ? AND scope_id = ? ORDER BY created_at DESC",
  )
    .bind(...(scopeId === null ? [scope] : [scope, scopeId]))
    .all<AuditWebhookRow>();
  return Promise.all(
    results.map(async (r) => publicWebhook(r, await decryptConfig(env, r))),
  );
}

interface WebhookBody {
  name?: string;
  kind?: string;
  config?: Record<string, unknown>;
  events?: string[];
  is_active?: boolean;
}

/**
 * Record a webhook lifecycle event (create / update / delete) in the same
 * scope as the webhook itself. The delivery is awaited so the affected hook
 * receives its own event: for create / update this doubles as a live test,
 * and for delete it must run before the row is removed. The caller controls
 * ordering by invoking this after an insert/update but *before* a delete.
 */
async function recordWebhookLifecycle(
  c: import("hono").Context<AppEnv>,
  scope: AuditScope,
  scopeId: string | null,
  action: string,
  wh: { id: string; name: string; kind: string },
): Promise<void> {
  const actor = c.get("user");
  const meta = auditRequestMeta(c);
  await recordAudit(
    c.env,
    c.executionCtx,
    {
      scope,
      scopeId,
      action,
      actorId: actor.id,
      actorName: actor.username,
      resourceType: "webhook",
      resourceId: wh.id,
      resourceName: wh.name,
      ip: meta.ip,
      userAgent: meta.userAgent,
      geo: meta.geo,
      metadata: { name: wh.name, kind: wh.kind },
    },
    { awaitDelivery: true },
  );
}

async function createWebhook(
  c: import("hono").Context<AppEnv>,
  scope: AuditScope,
  scopeId: string | null,
  createdBy: string,
  body: WebhookBody,
): Promise<{ error?: string; status?: number; webhook?: unknown }> {
  const env = c.env;
  const kind = String(body.kind ?? "");
  if (!WEBHOOK_KINDS.has(kind)) return { error: "invalid kind", status: 400 };
  if (!body.name?.trim()) return { error: "name is required", status: 400 };
  const config = body.config ?? {};
  const err = validateConfig(kind, config);
  if (err) return { error: err, status: 400 };

  const now = Math.floor(Date.now() / 1000);
  const id = randomId();
  const events =
    Array.isArray(body.events) && body.events.length ? body.events : ["*"];
  const encrypted = await encryptSecret(env, JSON.stringify(config));

  await env.DB.prepare(
    `INSERT INTO audit_webhooks (id, scope, scope_id, name, kind, config, events, is_active, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  )
    .bind(
      id,
      scope,
      scopeId,
      body.name.trim(),
      kind,
      encrypted,
      JSON.stringify(events),
      createdBy,
      now,
      now,
    )
    .run();

  // Record after the row exists so the new hook receives its own event.
  await recordWebhookLifecycle(c, scope, scopeId, "webhook.create", {
    id,
    name: body.name.trim(),
    kind,
  });

  const row = await env.DB.prepare("SELECT * FROM audit_webhooks WHERE id = ?")
    .bind(id)
    .first<AuditWebhookRow>();
  return { webhook: publicWebhook(row!, await decryptConfig(env, row!)) };
}

async function updateWebhook(
  c: import("hono").Context<AppEnv>,
  scope: AuditScope,
  scopeId: string | null,
  id: string,
  body: WebhookBody,
): Promise<{ error?: string; status?: number; webhook?: unknown }> {
  const env = c.env;
  const row = await env.DB.prepare(
    scopeId === null
      ? "SELECT * FROM audit_webhooks WHERE id = ? AND scope = ? AND scope_id IS NULL"
      : "SELECT * FROM audit_webhooks WHERE id = ? AND scope = ? AND scope_id = ?",
  )
    .bind(...(scopeId === null ? [id, scope] : [id, scope, scopeId]))
    .first<AuditWebhookRow>();
  if (!row) return { error: "Not found", status: 404 };

  const kind = row.kind;
  const priorConfig = await decryptConfig(env, row);
  const config = body.config
    ? mergeConfig(kind, body.config, priorConfig)
    : priorConfig;
  const err = validateConfig(kind, config);
  if (err) return { error: err, status: 400 };

  const now = Math.floor(Date.now() / 1000);
  const events =
    body.events !== undefined
      ? JSON.stringify(body.events.length ? body.events : ["*"])
      : row.events;
  const encrypted = await encryptSecret(env, JSON.stringify(config));
  const name = body.name?.trim() ?? row.name;

  await env.DB.prepare(
    "UPDATE audit_webhooks SET name = ?, config = ?, events = ?, is_active = ?, updated_at = ? WHERE id = ?",
  )
    .bind(
      name,
      encrypted,
      events,
      body.is_active === undefined ? row.is_active : body.is_active ? 1 : 0,
      now,
      id,
    )
    .run();

  // Record after the update so the edited hook is tested with its new config.
  await recordWebhookLifecycle(c, scope, scopeId, "webhook.update", {
    id,
    name,
    kind,
  });

  const updated = await env.DB.prepare(
    "SELECT * FROM audit_webhooks WHERE id = ?",
  )
    .bind(id)
    .first<AuditWebhookRow>();
  return {
    webhook: publicWebhook(updated!, await decryptConfig(env, updated!)),
  };
}

async function deleteWebhook(
  c: import("hono").Context<AppEnv>,
  scope: AuditScope,
  scopeId: string | null,
  id: string,
): Promise<boolean> {
  const env = c.env;
  const row = await env.DB.prepare(
    scopeId === null
      ? "SELECT id, name, kind FROM audit_webhooks WHERE id = ? AND scope = ? AND scope_id IS NULL"
      : "SELECT id, name, kind FROM audit_webhooks WHERE id = ? AND scope = ? AND scope_id = ?",
  )
    .bind(...(scopeId === null ? [id, scope] : [id, scope, scopeId]))
    .first<{ id: string; name: string; kind: string }>();
  if (!row) return false;

  // Record (and deliver) *before* removing the row so the hook still exists
  // to receive its own farewell event.
  await recordWebhookLifecycle(c, scope, scopeId, "webhook.delete", row);

  const res = await env.DB.prepare(
    scopeId === null
      ? "DELETE FROM audit_webhooks WHERE id = ? AND scope = ? AND scope_id IS NULL"
      : "DELETE FROM audit_webhooks WHERE id = ? AND scope = ? AND scope_id = ?",
  )
    .bind(...(scopeId === null ? [id, scope] : [id, scope, scopeId]))
    .run();
  return (res.meta.changes ?? 0) > 0;
}

// ─── Route registration ───────────────────────────────────────────────────────

function registerScope(
  base: string,
  resolveScope: (
    c: import("hono").Context<AppEnv>,
  ) => Promise<
    { ok: true; scope: AuditScope; scopeId: string | null } | { ok: false }
  >,
) {
  app.get(`${base}/events`, async (c) => {
    const r = await resolveScope(c);
    if (!r.ok) return c.json({ error: "Forbidden" }, 403);
    const filters = readFilters(c);
    const { events, total } = await queryEvents(
      c.env,
      r.scope,
      r.scopeId,
      filters,
    );
    const actions = await distinctActions(c.env, r.scope, r.scopeId);
    return c.json({ events, total, page: filters.page, actions });
  });

  // Export, on every scope rather than just the platform one. A team asked to
  // account for something needs its own log in a form it can hand over, and a
  // user asking what an instance holds about them is the same request. The
  // filters are the ones the table already uses, so what you export is what
  // you were looking at.
  app.get(`${base}/export`, async (c) => {
    const r = await resolveScope(c);
    if (!r.ok) return c.json({ error: "Forbidden" }, 403);
    const format = c.req.query("format") === "csv" ? "csv" : "json";
    const events = await exportEvents(c.env, r.scope, r.scopeId, readFilters(c));

    const stamp = new Date().toISOString().slice(0, 10);
    const name = `audit-${r.scope}${r.scopeId ? `-${r.scopeId}` : ""}-${stamp}`;

    if (format === "csv") {
      return new Response(auditCsv(events), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${name}.csv"`,
        },
      });
    }
    return new Response(JSON.stringify(events, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}.json"`,
      },
    });
  });

  app.get(`${base}/webhooks`, async (c) => {
    const r = await resolveScope(c);
    if (!r.ok) return c.json({ error: "Forbidden" }, 403);
    return c.json({ webhooks: await listWebhooks(c.env, r.scope, r.scopeId) });
  });

  app.post(`${base}/webhooks`, async (c) => {
    const r = await resolveScope(c);
    if (!r.ok) return c.json({ error: "Forbidden" }, 403);
    const body = await c.req.json<WebhookBody>();
    const res = await createWebhook(
      c,
      r.scope,
      r.scopeId,
      c.get("user").id,
      body,
    );
    if (res.error)
      return c.json({ error: res.error }, (res.status ?? 400) as 400);
    return c.json({ webhook: res.webhook }, 201);
  });

  app.patch(`${base}/webhooks/:id`, async (c) => {
    const r = await resolveScope(c);
    if (!r.ok) return c.json({ error: "Forbidden" }, 403);
    const body = await c.req.json<WebhookBody>();
    const res = await updateWebhook(
      c,
      r.scope,
      r.scopeId,
      c.req.param("id"),
      body,
    );
    if (res.error)
      return c.json({ error: res.error }, (res.status ?? 400) as 400);
    return c.json({ webhook: res.webhook });
  });

  app.delete(`${base}/webhooks/:id`, async (c) => {
    const r = await resolveScope(c);
    if (!r.ok) return c.json({ error: "Forbidden" }, 403);
    const ok = await deleteWebhook(c, r.scope, r.scopeId, c.req.param("id"));
    if (!ok) return c.json({ error: "Not found" }, 404);
    return c.json({ message: "Deleted" });
  });
}

// user scope — always self
registerScope("/me", async (c) => {
  const user = c.get("user");
  return { ok: true, scope: "user", scopeId: user.id };
});

// user scope by id — the account holder, or a site admin.
//
// The team and platform scopes both let an admin in; the user scope did not,
// which left the one log an operator most often needs (what happened to this
// account?) reachable only by reading the table directly. Everything an admin
// does to an account is written into this same log, so the account holder
// still sees it from their own side.
registerScope("/user/:userId", async (c) => {
  const user = c.get("user");
  const userId = c.req.param("userId");
  if (!userId) return { ok: false };
  if (userId === user.id || user.role === "admin")
    return { ok: true, scope: "user", scopeId: userId };
  return { ok: false };
});

// team scope — owner / co-owner (or platform admin)
registerScope("/team/:teamId", async (c) => {
  const user = c.get("user");
  const teamId = c.req.param("teamId");
  if (!teamId) return { ok: false };
  if (user.role === "admin")
    return { ok: true, scope: "team", scopeId: teamId };
  const member = await getEffectiveMember(c.env.DB, teamId, user.id);
  if (member && (member.role === "owner" || member.role === "co-owner"))
    return { ok: true, scope: "team", scopeId: teamId };
  return { ok: false };
});

// platform scope — admins only
registerScope("/platform", async (c) => {
  const user = c.get("user");
  if (user.role !== "admin") return { ok: false };
  return { ok: true, scope: "platform", scopeId: null };
});

// ─── Admin: migrate legacy webhooks into the new audit-webhook system ──────────

app.get("/platform/legacy-webhooks-status", async (c) => {
  const user = c.get("user");
  if (user.role !== "admin") return c.json({ error: "Forbidden" }, 403);

  const { results } = await c.env.DB.prepare(
    `SELECT w.id, w.name, w.user_id,
            (SELECT 1 FROM audit_webhooks aw WHERE aw.created_by = ? AND aw.name = w.name || ' (migrated)' LIMIT 1) AS migrated
     FROM webhooks w`,
  )
    .bind(user.id)
    .all<{ id: string; name: string; user_id: string | null; migrated: number | null }>();

  const total = results.length;
  const unmigrated = results.filter((r) => !r.migrated).length;

  return c.json({ total, unmigrated });
});

app.post("/platform/migrate-legacy-webhooks", async (c) => {
  const user = c.get("user");
  if (user.role !== "admin") return c.json({ error: "Forbidden" }, 403);

  const { results } = await c.env.DB.prepare(
    "SELECT id, name, url, secret, events, user_id FROM webhooks",
  ).all<{
    id: string;
    name: string;
    url: string;
    secret: string;
    events: string;
    user_id: string | null;
  }>();

  let migrated = 0;
  const now = Math.floor(Date.now() / 1000);
  for (const wh of results) {
    // Skip anything already migrated (same name marker) to keep this idempotent.
    const existing = await c.env.DB.prepare(
      "SELECT id FROM audit_webhooks WHERE created_by = ? AND name = ? LIMIT 1",
    )
      .bind(user.id, `${wh.name} (migrated)`)
      .first();
    if (existing) continue;

    const scope: AuditScope = wh.user_id ? "user" : "platform";
    const scopeId = wh.user_id ?? null;
    const config = {
      url: wh.url,
      method: "POST",
      headers: {},
      body: "{summary}",
    };
    const encrypted = await encryptSecret(c.env, JSON.stringify(config));
    let events = '["*"]';
    try {
      const parsed = JSON.parse(wh.events) as string[];
      if (Array.isArray(parsed) && parsed.length)
        events = JSON.stringify(parsed);
    } catch {
      /* keep default */
    }
    await c.env.DB.prepare(
      `INSERT INTO audit_webhooks (id, scope, scope_id, name, kind, config, events, is_active, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'general', ?, ?, 1, ?, ?, ?)`,
    )
      .bind(
        randomId(),
        scope,
        scopeId,
        `${wh.name} (migrated)`,
        encrypted,
        events,
        user.id,
        now,
        now,
      )
      .run();
    migrated++;
  }

  return c.json({ migrated, total: results.length });
});

export default app;
