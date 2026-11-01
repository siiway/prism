// Validation for notification rulesets users save. The rule shapes and the
// evaluator live in shared/notificationRules.ts (the frontend's trace runs
// the same code); expressions are in shared/ruleExpression.ts.

import type { CodedError } from "./apiError";
import {
  type NotificationRule,
  type RuleAction,
  type RuleMatch,
  type RuleSendChannel,
} from "../../shared/notificationRules";
import {
  parseRuleExpression,
  printRuleExpression,
  type ExprErrorCode,
} from "../../shared/ruleExpression";

export {
  channelKey,
  evaluateRuleset,
  traceRuleset,
  type NotificationLevel,
  type NotificationRule,
  type ResolvedDelivery,
  type RuleAction,
  type RuleMatch,
  type RuleSendChannel,
} from "../../shared/notificationRules";

const RULE_NAME_MAX = 64;

// One literal per reason, so every code the API can send is greppable.
const EXPR_ERRORS: Record<ExprErrorCode, CodedError> = {
  unexpected_end: { error: "rule_expression_unexpected_end" },
  unexpected_token: { error: "rule_expression_unexpected_token" },
  unterminated_string: { error: "rule_expression_unterminated_string" },
  unknown_field: { error: "rule_expression_unknown_field" },
  bad_operator: { error: "rule_expression_bad_operator" },
  bad_value: { error: "rule_expression_bad_value" },
  too_long: { error: "rule_expression_too_long" },
  too_deep: { error: "rule_expression_too_deep" },
  too_many_items: { error: "rule_expression_too_many_items" },
};

/**
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
  const ids = new Set<string>();
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
    // Editors find a rule by its id; two rules sharing one would be edited
    // (and saved) as one.
    if (ids.has(r.id))
      return {
        error: "rule_duplicate_id",
        params: { field: `rules[${i}].id`, id: r.id },
      };
    ids.add(r.id);

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
    if (matchRaw.expression !== undefined) {
      if (typeof matchRaw.expression !== "string")
        return {
          error: "field_must_be_string",
          params: { field: `rules[${i}].match.expression` },
        };
      const parsed = parseRuleExpression(matchRaw.expression);
      if (parsed.error)
        return {
          ...EXPR_ERRORS[parsed.error.code],
          params: {
            field: `rules[${i}].match.expression`,
            at: parsed.error.at,
            token: parsed.error.token ?? "",
          },
        };
      // Stored in canonical form; empty means every event.
      const canonical = printRuleExpression(parsed.expr);
      if (canonical) match.expression = canonical;
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
