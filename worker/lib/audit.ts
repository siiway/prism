// Transparent Control audit logs.
//
// A single append-only table (audit_events) backs three scopes:
//   • user     — a user's own security-relevant actions + authorizations of
//                the apps they own.
//   • team     — every edit / membership change under a team + authorizations
//                of apps the team owns.
//   • platform — every platform-admin action.
//
// Each recorded event can fan out to scoped "audit webhooks" (Discord /
// Telegram / General) so owners get real-time pushes. Delivery is always
// best-effort and must be wrapped in ctx.waitUntil at the call site.

import { randomId } from "./crypto";
import { decryptSecret } from "./secretCrypto";
import { loggedFetch, loggedSafeFetch } from "./logger";
import { validateOutboundUrl } from "./safeFetch";
import { geoJson } from "./geo";
import type { WaitUntilCtx } from "../types";

export type AuditScope = "user" | "team" | "platform";

export interface AuditInput {
  scope: AuditScope;
  scopeId: string | null;
  action: string;
  actorId?: string | null;
  actorName?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  resourceName?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /** JSON snapshot of the request's Cloudflare geolocation (worker/lib/geo.ts
   *  geoJson). Populated automatically by auditRequestMeta. */
  geo?: string | null;
  metadata?: unknown;
}

export interface AuditEventRow {
  id: string;
  scope: AuditScope;
  scope_id: string | null;
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  resource_type: string | null;
  resource_id: string | null;
  resource_name: string | null;
  ip: string | null;
  user_agent: string | null;
  ip_geo: string | null;
  metadata: string;
  created_at: number;
}

const DELIVERY_TIMEOUT_MS = 10_000;

/**
 * Record one or more audit events and fan them out to matching webhooks.
 * Never throws — failures are swallowed so a logging hiccup can't break the
 * request it is observing. Call inside ctx.waitUntil for non-blocking writes,
 * or await it when ordering matters.
 *
 * Pass `opts.awaitDelivery` to block on the webhook fan-out instead of
 * deferring it to ctx.waitUntil. Webhook lifecycle events use this so the
 * newly-created / edited hook actually receives its own event (a live test)
 * and, for deletions, so delivery completes before the row is removed.
 */
export async function recordAudit(
  env: Env,
  ctx: WaitUntilCtx,
  inputs: AuditInput | AuditInput[],
  opts: { awaitDelivery?: boolean } = {},
): Promise<void> {
  const list = Array.isArray(inputs) ? inputs : [inputs];
  const now = Math.floor(Date.now() / 1000);
  try {
    for (const input of list) {
      const id = randomId();
      await env.DB.prepare(
        `INSERT INTO audit_events
           (id, scope, scope_id, action, actor_id, actor_name, resource_type,
            resource_id, resource_name, ip, user_agent, ip_geo, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          input.scope,
          input.scopeId ?? null,
          input.action,
          input.actorId ?? null,
          input.actorName ?? null,
          input.resourceType ?? null,
          input.resourceId ?? null,
          input.resourceName ?? null,
          input.ip ?? null,
          input.userAgent ?? null,
          input.geo ?? null,
          JSON.stringify(input.metadata ?? {}),
          now,
        )
        .run();

      const delivery = deliverAuditWebhooks(env, {
        ...input,
        id,
        created_at: now,
      }).catch(() => {});
      if (opts.awaitDelivery) await delivery;
      else ctx.waitUntil(delivery);
    }
  } catch {
    // swallow — auditing must never break the observed request
  }
}

// ─── Account deletion ────────────────────────────────────────────────────────

/**
 * Announce that an account is going away, to every team that will notice.
 *
 * Deletion previously emitted at most a platform-scope event, and only from
 * the admin panel — self-deletion and the OAuth `site:user:delete` path were
 * silent. Platform scope alone does not reach team owners, because webhook
 * delivery matches on (scope, scope_id): a team subscribing to its own log
 * would never learn that one of its members had vanished, leaving downstream
 * apps holding a subject id that resolves to nothing.
 *
 * So this fans out one `team.member.account_deleted` per team the user
 * belongs to, alongside the platform-scope record. Apps that already
 * subscribe to their team's audit webhook for membership changes pick it up
 * with no extra wiring.
 *
 * MUST be called *before* the row is deleted — the membership rows it reads
 * are cascade-deleted along with the user.
 */
export async function recordAccountDeletion(
  env: Env,
  ctx: WaitUntilCtx,
  user: { id: string; username: string },
  opts: {
    /** Who performed it: the user themselves, an admin, or the reaper. */
    actorId?: string | null;
    actorName?: string | null;
    /** `self`, `admin`, or `team_dissolved`. */
    cause: "self" | "admin" | "team_dissolved";
    ip?: string | null;
    userAgent?: string | null;
    /** Memberships read before the row was deleted. Callers that must delete
     *  first — because the delete is conditional and may not happen — read
     *  them up front and pass them here. */
    teamIds?: string[];
  },
): Promise<void> {
  let teamIds: string[] = opts.teamIds ?? [];
  if (!opts.teamIds) {
    try {
      const { results } = await env.DB.prepare(
        "SELECT team_id FROM team_members WHERE user_id = ?",
      )
        .bind(user.id)
        .all<{ team_id: string }>();
      teamIds = results.map((r) => r.team_id);
    } catch {
      // A failed lookup must not block the deletion it is describing.
    }
  }

  const base = {
    actorId: opts.actorId ?? null,
    actorName: opts.actorName ?? null,
    resourceType: "user",
    resourceId: user.id,
    resourceName: `@${user.username}`,
    ip: opts.ip ?? null,
    userAgent: opts.userAgent ?? null,
    metadata: { cause: opts.cause },
  };

  const inputs: AuditInput[] = [
    {
      scope: "platform",
      scopeId: null,
      action: "user.account.deleted",
      ...base,
    },
    ...teamIds.map((teamId) => ({
      scope: "team" as const,
      scopeId: teamId,
      action: "team.member.account_deleted",
      ...base,
    })),
  ];

  await recordAudit(env, ctx, inputs);
}

// ─── Metadata extraction from the request ────────────────────────────────────

export function auditRequestMeta(c: {
  req: { header: (h: string) => string | undefined; raw: Request };
}): { ip: string | null; userAgent: string | null; geo: string | null } {
  const ip =
    c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For") ?? null;
  const userAgent = c.req.header("User-Agent") ?? null;
  // Same Cloudflare edge geolocation the sessions view uses, captured at the
  // moment of the audited action. Spread-style callers (`...auditRequestMeta`)
  // pick this up for free; the explicit `ip: meta.ip` callers pass meta.geo.
  return { ip, userAgent, geo: geoJson(c) };
}

// ─── Webhook delivery ────────────────────────────────────────────────────────

interface AuditWebhookRow {
  id: string;
  kind: "discord" | "telegram" | "general";
  config: string;
  events: string;
}

interface DeliveredEvent extends AuditInput {
  id: string;
  created_at: number;
}

// Avatar shown alongside Discord webhook messages.
const DISCORD_AVATAR_URL =
  "https://icons.siiway.org/prism/border/android-chrome-512x512.png";

// How much of the response body to persist for the "last push" summary. The
// UI truncates further based on the viewer's available width.
const MAX_STORED_BODY = 512;

interface DeliveryOutcome {
  success: boolean;
  status: number | null;
  body: string;
}

/** Convert a glob-style event filter (supporting `*` / `?`) to a RegExp. */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

/**
 * True when `action` matches any of the configured event patterns. Patterns
 * may be literal action names (`app.create`), `*` (all), or fnmatch-style
 * globs (`app.*`, `team.member.*`).
 */
export function matchesEventPattern(
  patterns: string[],
  action: string,
): boolean {
  return patterns.some((p) => {
    if (p === "*" || p === action) return true;
    if (!p.includes("*") && !p.includes("?")) return false;
    try {
      return globToRegExp(p).test(action);
    } catch {
      return false;
    }
  });
}

async function summarizeResponse(res: Response): Promise<DeliveryOutcome> {
  let body: string;
  try {
    body = (await res.text()).slice(0, MAX_STORED_BODY);
  } catch {
    body = "";
  }
  return { success: res.ok, status: res.status, body };
}

async function recordDelivery(
  env: Env,
  id: string,
  outcome: DeliveryOutcome,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE audit_webhooks
        SET last_delivery_at = ?, last_delivery_success = ?,
            last_delivery_status = ?, last_delivery_body = ?
      WHERE id = ?`,
  )
    .bind(
      Math.floor(Date.now() / 1000),
      outcome.success ? 1 : 0,
      outcome.status,
      outcome.body,
      id,
    )
    .run()
    .catch(() => {});
}

async function deliverAuditWebhooks(
  env: Env,
  event: DeliveredEvent,
): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT id, kind, config, events FROM audit_webhooks WHERE scope = ? AND is_active = 1 AND ((scope_id IS NULL AND ? IS NULL) OR scope_id = ?)",
  )
    .bind(event.scope, event.scopeId ?? null, event.scopeId ?? null)
    .all<AuditWebhookRow>();

  const matching = results.filter((wh) => {
    let evts: string[];
    try {
      evts = JSON.parse(wh.events) as string[];
    } catch {
      return false;
    }
    return matchesEventPattern(evts, event.action);
  });
  if (!matching.length) return;

  await Promise.all(
    matching.map(async (wh) => {
      let config: Record<string, unknown>;
      try {
        const decrypted = (await decryptSecret(env, wh.config)) ?? wh.config;
        config = JSON.parse(decrypted) as Record<string, unknown>;
      } catch {
        return;
      }
      let outcome: DeliveryOutcome;
      try {
        if (wh.kind === "discord")
          outcome = await deliverDiscord(env, config, event);
        else if (wh.kind === "telegram")
          outcome = await deliverTelegram(env, config, event);
        else outcome = await deliverGeneral(env, config, event);
      } catch (err) {
        outcome = {
          success: false,
          status: null,
          body: err instanceof Error ? err.message : String(err),
        };
      }
      await recordDelivery(env, wh.id, outcome);
    }),
  );
}

function eventSummary(event: DeliveredEvent): string {
  const parts: string[] = [event.action];
  if (event.actorName) parts.push(`by ${event.actorName}`);
  if (event.resourceName) parts.push(`on ${event.resourceName}`);
  return parts.join(" ");
}

/** Values available to {placeholder} interpolation in General webhooks. */
export function auditPlaceholders(
  event: DeliveredEvent,
): Record<string, string> {
  return {
    id: event.id,
    scope: event.scope,
    scope_id: event.scopeId ?? "",
    action: event.action,
    actor_id: event.actorId ?? "",
    actor_name: event.actorName ?? "",
    resource_type: event.resourceType ?? "",
    resource_id: event.resourceId ?? "",
    resource_name: event.resourceName ?? "",
    ip: event.ip ?? "",
    user_agent: event.userAgent ?? "",
    timestamp: String(event.created_at),
    metadata: JSON.stringify(event.metadata ?? {}),
    summary: eventSummary(event),
  };
}

function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) =>
    key in values ? values[key] : m,
  );
}

async function deliverDiscord(
  env: Env,
  config: Record<string, unknown>,
  event: DeliveredEvent,
): Promise<DeliveryOutcome> {
  const url = String(config.webhook_url ?? "");
  if (validateOutboundUrl(url) !== null)
    return { success: false, status: null, body: "invalid webhook_url" };
  const fields = [
    { name: "Action", value: event.action, inline: true },
    event.actorName
      ? { name: "Actor", value: event.actorName, inline: true }
      : null,
    event.resourceName
      ? { name: "Resource", value: event.resourceName, inline: true }
      : null,
    event.ip ? { name: "IP", value: event.ip, inline: true } : null,
  ].filter(Boolean);
  const body = JSON.stringify({
    username: "Prism",
    avatar_url: DISCORD_AVATAR_URL,
    embeds: [
      {
        title: "Prism audit event",
        description: eventSummary(event),
        color: 0x5865f2,
        fields,
        timestamp: new Date(event.created_at * 1000).toISOString(),
      },
    ],
  });
  const res = await loggedSafeFetch(env, url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
  });
  return summarizeResponse(res);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function deliverTelegram(
  env: Env,
  config: Record<string, unknown>,
  event: DeliveredEvent,
): Promise<DeliveryOutcome> {
  const token = String(config.bot_token ?? "");
  const chatId = String(config.chat_id ?? "");
  const threadId = config.thread_id ? String(config.thread_id) : "";
  if (!token || !chatId)
    return { success: false, status: null, body: "missing bot_token/chat_id" };
  const lines = [
    `<b>Prism audit event</b>`,
    `<b>Action:</b> ${escapeHtml(event.action)}`,
    event.actorName ? `<b>Actor:</b> ${escapeHtml(event.actorName)}` : "",
    event.resourceName
      ? `<b>Resource:</b> ${escapeHtml(event.resourceName)}`
      : "",
    event.ip ? `<b>IP:</b> ${escapeHtml(event.ip)}` : "",
  ].filter(Boolean);
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: lines.join("\n"),
    parse_mode: "HTML",
  };
  if (threadId) payload.message_thread_id = Number(threadId);
  const res = await loggedFetch(
    env,
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    },
  );
  return summarizeResponse(res);
}

async function deliverGeneral(
  env: Env,
  config: Record<string, unknown>,
  event: DeliveredEvent,
): Promise<DeliveryOutcome> {
  const values = auditPlaceholders(event);
  const url = interpolate(String(config.url ?? ""), values);
  if (validateOutboundUrl(url) !== null)
    return { success: false, status: null, body: "invalid url" };
  const method = String(config.method ?? "POST").toUpperCase();
  const headers: Record<string, string> = {};
  const rawHeaders = (config.headers ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(rawHeaders)) {
    headers[k] = interpolate(String(v), values);
  }
  const init: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
  };
  if (method !== "GET" && method !== "HEAD" && config.body != null) {
    init.body = interpolate(String(config.body), values);
  }
  const res = await loggedSafeFetch(env, url, init);
  return summarizeResponse(res);
}
