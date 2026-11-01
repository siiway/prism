// Rule engine for notification_rulesets.
//
// A ruleset is an ordered array of NotificationRule. When an event fires
// the engine walks the rules top-to-bottom, applies actions for every
// match, and returns the deduped channel list to actually deliver to.
//
//   • match.event is a glob: "*", "app.*", "security.totp_enabled".
//     Matching is anchored — "app" matches "app", not "appx". "*" matches
//     everything; "?" matches a single character. No regex syntax beyond
//     these two wildcards.
//
//   • match.accounts is an optional list of account keys ("email:<id>",
//     "tg:<id>" or "discord:<id>"). When non-empty, the rule's *effect* is filtered to
//     those accounts only — `send` channels not in the list are ignored,
//     `drop` only clears those accounts. Other accounts pass through as
//     if this rule didn't fire. When empty/missing the rule applies to
//     every account uniformly.
//
//   • action.type === "send" appends each channel to a running set,
//     keyed by (kind, id). Re-encountering the same channel at a higher
//     level upgrades it (full > brief).
//
//   • action.type === "drop" empties the channel set. Used to mute a
//     specific event after a broader rule above already enrolled it.
//
//   • stop: true halts evaluation after this rule fires.
//
// Disabled rules are skipped without affecting state.

import type { CodedError } from "./apiError";

export type NotificationLevel = "brief" | "full";

export interface RuleMatch {
  event?: string;
  /**
   * Account-key filter. Each entry is "email:<email_id>",
   * "tg:<connection_id>" or "discord:<connection_id>". Empty/missing means
   * the rule's effect is not scoped to any particular account.
   */
  accounts?: string[];
}

/** Helper: render a channel as the account key the rule's match uses. */
export function channelKey(c: RuleSendChannel): string {
  if (c.kind === "email") return `email:${c.email_id}`;
  if (c.kind === "discord") return `discord:${c.connection_id}`;
  return `tg:${c.connection_id}`;
}

export interface RuleSendChannelEmail {
  kind: "email";
  email_id: string;
  level: NotificationLevel;
}

export interface RuleSendChannelTg {
  kind: "tg";
  connection_id: string;
  level: NotificationLevel;
}

export interface RuleSendChannelDiscord {
  kind: "discord";
  connection_id: string;
  level: NotificationLevel;
}

export type RuleSendChannel =
  RuleSendChannelEmail | RuleSendChannelTg | RuleSendChannelDiscord;

export type RuleAction =
  { type: "drop" } | { type: "send"; channels: RuleSendChannel[] };

export interface NotificationRule {
  id: string;
  name?: string;
  enabled?: boolean;
  match: RuleMatch;
  action: RuleAction;
  stop?: boolean;
}

export interface ResolvedDelivery {
  emails: Array<{ email_id: string; level: NotificationLevel }>;
  tgs: Array<{ connection_id: string; level: NotificationLevel }>;
  discords: Array<{ connection_id: string; level: NotificationLevel }>;
}

const RULE_NAME_MAX = 64;

function compileGlob(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const expanded = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${expanded}$`);
}

function matchEvent(pattern: string | undefined, event: string): boolean {
  if (!pattern || pattern === "*") return true;
  return compileGlob(pattern).test(event);
}

function upgradeLevel(
  prev: NotificationLevel | undefined,
  next: NotificationLevel,
): NotificationLevel {
  if (prev === "full" || next === "full") return "full";
  return "brief";
}

/** Walk the ruleset for one event; returns the deduped delivery list. */
export function evaluateRuleset(
  rules: NotificationRule[],
  event: string,
): ResolvedDelivery {
  const emailMap = new Map<string, NotificationLevel>();
  const tgMap = new Map<string, NotificationLevel>();
  const discordMap = new Map<string, NotificationLevel>();

  for (const rule of rules) {
    if (rule.enabled === false) continue;
    if (!matchEvent(rule.match?.event, event)) continue;

    const scopedAccounts =
      rule.match.accounts && rule.match.accounts.length > 0
        ? new Set(rule.match.accounts)
        : null;

    if (rule.action.type === "drop") {
      if (scopedAccounts) {
        // Per-account drop: only clear the listed accounts; others stay.
        for (const key of scopedAccounts) {
          if (key.startsWith("email:")) emailMap.delete(key.slice(6));
          else if (key.startsWith("discord:")) discordMap.delete(key.slice(8));
          else if (key.startsWith("tg:")) tgMap.delete(key.slice(3));
        }
      } else {
        emailMap.clear();
        tgMap.clear();
        discordMap.clear();
      }
    } else {
      for (const ch of rule.action.channels) {
        // Per-account send: silently skip channels that don't belong to
        // the scoped accounts. The rule's send list is treated as the
        // *candidate* set; the match.accounts filter culls it.
        if (scopedAccounts && !scopedAccounts.has(channelKey(ch))) continue;
        if (ch.kind === "email") {
          emailMap.set(
            ch.email_id,
            upgradeLevel(emailMap.get(ch.email_id), ch.level),
          );
        } else if (ch.kind === "tg") {
          tgMap.set(
            ch.connection_id,
            upgradeLevel(tgMap.get(ch.connection_id), ch.level),
          );
        } else if (ch.kind === "discord") {
          discordMap.set(
            ch.connection_id,
            upgradeLevel(discordMap.get(ch.connection_id), ch.level),
          );
        }
      }
    }

    if (rule.stop) break;
  }

  return {
    emails: [...emailMap].map(([email_id, level]) => ({ email_id, level })),
    tgs: [...tgMap].map(([connection_id, level]) => ({
      connection_id,
      level,
    })),
    discords: [...discordMap].map(([connection_id, level]) => ({
      connection_id,
      level,
    })),
  };
}

/**
 * Validate + normalize a value the user POSTed as the `rules` array.
 * Returns either a sanitized rules list or a rejection reason. Strict
 * about every field — anything we don't recognize is dropped silently
 * (forward-compat) but anything malformed is a 400.
 */
export function sanitizeRulesArray(
  input: unknown,
  knownEvents: readonly string[],
):
  | { rules: NotificationRule[]; error?: undefined }
  | ({ rules?: undefined } & CodedError) {
  if (!Array.isArray(input))
    return { error: "field_must_be_array", params: { field: "rules" } };
  if (input.length > 200)
    return { error: "too_many_rules", params: { max: 200 } };

  const out: NotificationRule[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i];
    if (!raw || typeof raw !== "object")
      return {
        error: "field_must_be_object",
        params: { field: `rules[${i}]` },
      };
    const r = raw as Record<string, unknown>;

    if (typeof r.id !== "string" || !r.id)
      return { error: "field_required", params: { field: `rules[${i}].id` } };

    let name: string | undefined;
    if (r.name !== undefined) {
      if (typeof r.name !== "string")
        return {
          error: "field_must_be_string",
          params: { field: `rules[${i}].name` },
        };
      const trimmed = r.name.trim();
      if (trimmed.length > RULE_NAME_MAX)
        return {
          error: "field_max_length",
          params: { field: `rules[${i}].name`, max: RULE_NAME_MAX },
        };
      name = trimmed || undefined;
    }

    const enabled = r.enabled === undefined ? true : !!r.enabled;
    const stop = r.stop === undefined ? false : !!r.stop;

    const matchRaw = (r.match ?? {}) as Record<string, unknown>;
    if (
      typeof matchRaw !== "object" ||
      matchRaw === null ||
      Array.isArray(matchRaw)
    )
      return {
        error: "field_must_be_object",
        params: { field: `rules[${i}].match` },
      };
    const match: RuleMatch = {};
    if (matchRaw.event !== undefined) {
      if (typeof matchRaw.event !== "string")
        return {
          error: "field_must_be_string",
          params: { field: `rules[${i}].match.event` },
        };
      const ev = matchRaw.event.trim();
      if (ev.length > 128)
        return {
          error: "field_max_length",
          params: { field: `rules[${i}].match.event`, max: 128 },
        };
      // If the pattern has no wildcards it must match a known event so
      // typos surface fast. Wildcards (e.g. security.*) bypass this.
      if (!ev.includes("*") && !ev.includes("?") && !knownEvents.includes(ev))
        return {
          error: "rule_unknown_event",
          params: { field: `rules[${i}].match.event`, event: ev },
        };
      match.event = ev;
    }
    if (matchRaw.accounts !== undefined) {
      if (!Array.isArray(matchRaw.accounts))
        return {
          error: "field_must_be_array",
          params: { field: `rules[${i}].match.accounts` },
        };
      if (matchRaw.accounts.length > 50)
        return {
          error: "field_max_items",
          params: { field: `rules[${i}].match.accounts`, max: 50 },
        };
      const accounts: string[] = [];
      for (let k = 0; k < matchRaw.accounts.length; k++) {
        const key = matchRaw.accounts[k];
        if (
          typeof key !== "string" ||
          (!key.startsWith("email:") &&
            !key.startsWith("tg:") &&
            !key.startsWith("discord:")) ||
          key.length < 5 ||
          key.length > 128
        ) {
          return {
            error: "field_one_of",
            params: {
              field: `rules[${i}].match.accounts[${k}]`,
              values: "email:<id>, tg:<id>, discord:<id>",
            },
          };
        }
        accounts.push(key);
      }
      if (accounts.length > 0) match.accounts = accounts;
    }

    const actionRaw = r.action as Record<string, unknown> | undefined;
    if (!actionRaw || typeof actionRaw !== "object")
      return {
        error: "field_required",
        params: { field: `rules[${i}].action` },
      };

    let action: RuleAction;
    if (actionRaw.type === "drop") {
      action = { type: "drop" };
    } else if (actionRaw.type === "send") {
      if (!Array.isArray(actionRaw.channels))
        return {
          error: "field_must_be_array",
          params: { field: `rules[${i}].action.channels` },
        };
      if (actionRaw.channels.length > 50)
        return {
          error: "field_max_items",
          params: { field: `rules[${i}].action.channels`, max: 50 },
        };
      const channels: RuleSendChannel[] = [];
      for (let j = 0; j < actionRaw.channels.length; j++) {
        const c = actionRaw.channels[j] as Record<string, unknown>;
        if (!c || typeof c !== "object")
          return {
            error: "field_must_be_object",
            params: { field: `rules[${i}].action.channels[${j}]` },
          };
        if (c.level !== "brief" && c.level !== "full")
          return {
            error: "field_one_of",
            params: {
              field: `rules[${i}].action.channels[${j}].level`,
              values: "brief, full",
            },
          };
        if (c.kind === "email") {
          if (typeof c.email_id !== "string" || !c.email_id)
            return {
              error: "field_required",
              params: { field: `rules[${i}].action.channels[${j}].email_id` },
            };
          channels.push({
            kind: "email",
            email_id: c.email_id,
            level: c.level,
          });
        } else if (c.kind === "tg") {
          if (typeof c.connection_id !== "string" || !c.connection_id)
            return {
              error: "field_required",
              params: {
                field: `rules[${i}].action.channels[${j}].connection_id`,
              },
            };
          channels.push({
            kind: "tg",
            connection_id: c.connection_id,
            level: c.level,
          });
        } else if (c.kind === "discord") {
          if (typeof c.connection_id !== "string" || !c.connection_id)
            return {
              error: "field_required",
              params: {
                field: `rules[${i}].action.channels[${j}].connection_id`,
              },
            };
          channels.push({
            kind: "discord",
            connection_id: c.connection_id,
            level: c.level,
          });
        } else {
          return {
            error: "field_one_of",
            params: {
              field: `rules[${i}].action.channels[${j}].kind`,
              values: "email, tg, discord",
            },
          };
        }
      }
      action = { type: "send", channels };
    } else {
      return {
        error: "field_one_of",
        params: { field: `rules[${i}].action.type`, values: "send, drop" },
      };
    }

    out.push({ id: r.id, name, enabled, stop, match, action });
  }
  return { rules: out };
}
