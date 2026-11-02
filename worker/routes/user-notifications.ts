// Notification preferences and rulesets: /api/user/me/notifications*.

import { Hono } from "hono";
import { randomId } from "../lib/crypto";
import {
  USER_NOTIFICATION_EVENTS,
  parseNotificationRules,
} from "../lib/notifications";
import {
  sanitizeRulesArray,
  type NotificationRule,
} from "../lib/notificationRules";
import type { CodedError } from "../lib/apiError";
import type {
  NotificationRules,
  UserNotificationPrefsRow,
  Variables,
} from "../types";
import { RULE_NAME_MAX_LENGTH } from "../../shared/limits";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

// ─── Notification Preferences ─────────────────────────────────────────────────

// GET /api/user/me/notifications
app.get("/me/notifications", async (c) => {
  const user = c.get("user");

  // Load prefs row for rules + legacy migration data
  const row = await c.env.DB.prepare(
    "SELECT events, tg_events, notification_rules FROM user_notification_prefs WHERE user_id = ?",
  )
    .bind(user.id)
    .first<
      Pick<
        UserNotificationPrefsRow,
        "events" | "tg_events" | "notification_rules"
      >
    >();

  // First telegram connection for legacy migration
  const firstTg = await c.env.DB.prepare(
    "SELECT id FROM social_connections WHERE user_id = ? AND provider = 'telegram' ORDER BY connected_at ASC LIMIT 1",
  )
    .bind(user.id)
    .first<{ id: string }>();

  const rules = row
    ? parseNotificationRules(
        row.notification_rules,
        row.events,
        row.tg_events,
        firstTg?.id ?? null,
      )
    : {};

  // Build email list: primary + verified alternates
  const primaryRow = await c.env.DB.prepare(
    "SELECT email, email_verified FROM users WHERE id = ?",
  )
    .bind(user.id)
    .first<{ email: string; email_verified: number }>();

  const emails: { id: string; email: string }[] = [];
  if (primaryRow?.email_verified) {
    emails.push({ id: "primary", email: primaryRow.email });
  }
  const { results: altEmails } = await c.env.DB.prepare(
    "SELECT id, email FROM user_emails WHERE user_id = ? AND verified = 1 ORDER BY created_at ASC",
  )
    .bind(user.id)
    .all<{ id: string; email: string }>();
  emails.push(...altEmails);

  // Build telegram connection list
  const { results: tgConns } = await c.env.DB.prepare(
    "SELECT id, provider_user_id, profile_data FROM social_connections WHERE user_id = ? AND provider = 'telegram' ORDER BY connected_at ASC",
  )
    .bind(user.id)
    .all<{ id: string; provider_user_id: string; profile_data: string }>();

  const tg_connections = tgConns.map((conn) => {
    let name = conn.provider_user_id;
    let username: string | null = null;
    try {
      const p = JSON.parse(conn.profile_data) as Record<string, unknown>;
      const fn = p.first_name as string | undefined;
      const ln = p.last_name as string | undefined;
      name = [fn, ln].filter(Boolean).join(" ") || conn.provider_user_id;
      username = (p.username as string | undefined) ?? null;
    } catch {
      // ignore
    }
    return { id: conn.id, name, username };
  });

  // Build discord connection list
  const { results: discordConns } = await c.env.DB.prepare(
    "SELECT id, provider_user_id, profile_data FROM social_connections WHERE user_id = ? AND provider = 'discord' ORDER BY connected_at ASC",
  )
    .bind(user.id)
    .all<{ id: string; provider_user_id: string; profile_data: string }>();

  const discord_connections = discordConns.map((conn) => {
    let name = conn.provider_user_id;
    let username: string | null = null;
    try {
      const p = JSON.parse(conn.profile_data) as Record<string, unknown>;
      const globalName = p.global_name as string | undefined;
      username = (p.username as string | undefined) ?? null;
      name = globalName || username || conn.provider_user_id;
    } catch {
      // ignore
    }
    return { id: conn.id, name, username };
  });

  return c.json({
    rules,
    emails,
    tg_connections,
    discord_connections,
    available: USER_NOTIFICATION_EVENTS,
  });
});

/** The well-formed `{ <idKey>: string, level: "brief" | "full" }` entries of
 *  one notification channel's list; anything else is dropped. */
function channelEntries<K extends "email_id" | "connection_id">(
  list: unknown,
  idKey: K,
): Array<Record<K, string> & { level: "brief" | "full" }> {
  if (!Array.isArray(list)) return [];
  const out: Array<Record<K, string> & { level: "brief" | "full" }> = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const id = (entry as Record<string, unknown>)[idKey];
    const level = (entry as Record<string, unknown>).level;
    if (
      typeof id === "string" &&
      id.length > 0 &&
      (level === "brief" || level === "full")
    ) {
      out.push({ [idKey]: id, level } as Record<K, string> & {
        level: "brief" | "full";
      });
    }
  }
  return out;
}

/**
 * Strip every field that isn't a known event / channel / level. Returns a
 * cleaned NotificationRules object. Shared between the prefs PUT and the
 * notification-rulesets CRUD endpoints so a saved ruleset can never carry
 * a payload the prefs path itself would refuse.
 */
function sanitizeNotificationRules(input: unknown): NotificationRules | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const valid: NotificationRules = {};
  const validEvents = USER_NOTIFICATION_EVENTS as readonly string[];
  for (const [ev, rule] of Object.entries(input as Record<string, unknown>)) {
    if (!validEvents.includes(ev)) continue;
    if (!rule || typeof rule !== "object") continue;
    const cleaned: NonNullable<(typeof valid)[string]> = {};

    const r = rule as { email?: unknown; tg?: unknown; discord?: unknown };
    const email = channelEntries(r.email, "email_id");
    if (email.length) cleaned.email = email;
    const tg = channelEntries(r.tg, "connection_id");
    if (tg.length) cleaned.tg = tg;
    const discord = channelEntries(r.discord, "connection_id");
    if (discord.length) cleaned.discord = discord;

    valid[ev] = cleaned;
  }
  return valid;
}

const RULESET_NAME_RE = /^[\w][\w .,'\-()/]{0,63}$/u;

function validateRulesetName(
  raw: unknown,
): { name: string } & Partial<CodedError> {
  if (typeof raw !== "string")
    return {
      name: "",
      error: "field_must_be_string",
      params: { field: "name" },
    };
  const trimmed = raw.trim();
  if (!trimmed)
    return { name: "", error: "field_required", params: { field: "name" } };
  if (trimmed.length > RULE_NAME_MAX_LENGTH)
    return {
      name: trimmed,
      error: "field_max_length",
      params: { field: "name", max: RULE_NAME_MAX_LENGTH },
    };
  if (!RULESET_NAME_RE.test(trimmed))
    return {
      name: trimmed,
      error: "name_chars_invalid",
    };
  return { name: trimmed };
}

// PUT /api/user/me/notifications
app.put("/me/notifications", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ rules: NotificationRules }>();

  const valid = sanitizeNotificationRules(body.rules);
  if (valid === null)
    return c.json(
      { error: "field_must_be_object", params: { field: "rules" } },
      400,
    );

  await c.env.DB.prepare(
    "INSERT INTO user_notification_prefs (user_id, notification_rules) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET notification_rules = excluded.notification_rules",
  )
    .bind(user.id, JSON.stringify(valid))
    .run();

  return c.json({ rules: valid });
});

// ─── Notification rulesets (rule-engine presets) ─────────────────────────────
//
// A ruleset is an ordered list of NotificationRule entries — see
// worker/lib/notificationRules.ts for the rule shape and the evaluator.
// At most one ruleset per user is `is_active`; activating one
// automatically deactivates any other. When a ruleset is active it drives
// dispatch; otherwise the legacy per-event rules in
// user_notification_prefs.notification_rules apply.

interface RulesetRow {
  id: string;
  name: string;
  rules: string;
  is_active: number;
  created_at: number;
  updated_at: number;
}

function rulesetToJson(row: RulesetRow) {
  let rules: NotificationRule[] = [];
  try {
    const parsed = JSON.parse(row.rules);
    if (Array.isArray(parsed)) rules = parsed as NotificationRule[];
  } catch {
    // ignore — corrupted row, return empty
  }
  return {
    id: row.id,
    name: row.name,
    rules,
    is_active: !!row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// GET /api/user/me/notification-rulesets — list every saved ruleset
app.get("/me/notification-rulesets", async (c) => {
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, rules, is_active, created_at, updated_at FROM notification_rulesets WHERE user_id = ? ORDER BY name COLLATE NOCASE ASC",
  )
    .bind(user.id)
    .all<RulesetRow>();
  return c.json({ rulesets: results.map(rulesetToJson) });
});

// POST /api/user/me/notification-rulesets — save a new ruleset
app.post("/me/notification-rulesets", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    name?: unknown;
    rules?: unknown;
    is_active?: unknown;
  }>();

  const { name, ...nameErr } = validateRulesetName(body.name);
  if (nameErr.error) return c.json(nameErr, 400);

  const validation = sanitizeRulesArray(
    body.rules,
    USER_NOTIFICATION_EVENTS as readonly string[],
  );
  if (validation.error)
    return c.json({ error: validation.error, params: validation.params }, 400);
  const cleanedRules = validation.rules;

  const id = randomId();
  const now = Math.floor(Date.now() / 1000);
  const wantActive = !!body.is_active;
  try {
    if (wantActive) {
      // Single transaction so we never have two active rulesets for a user.
      await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE notification_rulesets SET is_active = 0, updated_at = ? WHERE user_id = ? AND is_active = 1",
        ).bind(now, user.id),
        c.env.DB.prepare(
          "INSERT INTO notification_rulesets (id, user_id, name, rules, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
        ).bind(id, user.id, name, JSON.stringify(cleanedRules), now, now),
      ]);
    } else {
      await c.env.DB.prepare(
        "INSERT INTO notification_rulesets (id, user_id, name, rules, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
      )
        .bind(id, user.id, name, JSON.stringify(cleanedRules), now, now)
        .run();
    }
  } catch (err) {
    if (String(err).includes("UNIQUE"))
      return c.json({ error: "ruleset_name_taken" }, 409);
    throw err;
  }
  return c.json(
    {
      ruleset: {
        id,
        name,
        rules: cleanedRules,
        is_active: wantActive,
        created_at: now,
        updated_at: now,
      },
    },
    201,
  );
});

// PUT /api/user/me/notification-rulesets/:id — rename, replace rules,
// and/or toggle is_active
app.put("/me/notification-rulesets/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json<{
    name?: unknown;
    rules?: unknown;
    is_active?: unknown;
  }>();

  const existing = await c.env.DB.prepare(
    "SELECT id FROM notification_rulesets WHERE id = ? AND user_id = ?",
  )
    .bind(id, user.id)
    .first<{ id: string }>();
  if (!existing) return c.json({ error: "not_found" }, 404);

  const sets: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    const { name, ...nameErr } = validateRulesetName(body.name);
    if (nameErr.error) return c.json(nameErr, 400);
    sets.push("name = ?");
    values.push(name);
  }
  if (body.rules !== undefined) {
    const validation = sanitizeRulesArray(
      body.rules,
      USER_NOTIFICATION_EVENTS as readonly string[],
    );
    if (validation.error)
      return c.json(
        { error: validation.error, params: validation.params },
        400,
      );
    sets.push("rules = ?");
    values.push(JSON.stringify(validation.rules));
  }
  const willToggleActive = body.is_active !== undefined;
  if (willToggleActive) {
    sets.push("is_active = ?");
    values.push(body.is_active ? 1 : 0);
  }
  if (!sets.length) return c.json({ error: "nothing_to_update" }, 400);

  const now = Math.floor(Date.now() / 1000);
  sets.push("updated_at = ?");
  values.push(now, id, user.id);

  try {
    if (willToggleActive && body.is_active) {
      // Deactivate every other ruleset first so there's at most one
      // active per user — see migration 0044.
      await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE notification_rulesets SET is_active = 0, updated_at = ? WHERE user_id = ? AND is_active = 1 AND id != ?",
        ).bind(now, user.id, id),
        c.env.DB.prepare(
          `UPDATE notification_rulesets SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
        ).bind(...values),
      ]);
    } else {
      await c.env.DB.prepare(
        `UPDATE notification_rulesets SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
      )
        .bind(...values)
        .run();
    }
  } catch (err) {
    if (String(err).includes("UNIQUE"))
      return c.json({ error: "ruleset_name_taken" }, 409);
    throw err;
  }

  const row = await c.env.DB.prepare(
    "SELECT id, name, rules, is_active, created_at, updated_at FROM notification_rulesets WHERE id = ?",
  )
    .bind(id)
    .first<RulesetRow>();
  return c.json({ ruleset: row ? rulesetToJson(row) : null });
});

// DELETE /api/user/me/notification-rulesets/:id
app.delete("/me/notification-rulesets/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const result = await c.env.DB.prepare(
    "DELETE FROM notification_rulesets WHERE id = ? AND user_id = ?",
  )
    .bind(id, user.id)
    .run();
  if (!result.meta?.changes) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

export default app;
