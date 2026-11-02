// How the rule pages present expression fields and operators: their labels
// and which value picker each field gets.

import type { RuleField } from "../../../shared/ruleExpression";
import { ALL_EVENT_KEYS, EVENT_GROUPS } from "./catalog";
import type { BuilderOp } from "./ruleBuilder";

export const FIELD_LABEL_KEYS: Record<RuleField, string> = {
  event: "notifications.rule.fieldEvent",
  "event.category": "notifications.rule.fieldCategory",
  "ip.src": "notifications.rule.fieldIp",
  "ip.src.country": "notifications.rule.fieldCountry",
  "http.user_agent": "notifications.rule.fieldUserAgent",
  "resource.name": "notifications.rule.fieldResource",
  "oauth.scopes": "notifications.rule.fieldScopes",
  "profile.changed_fields": "notifications.rule.fieldChangedFields",
  "time.hour": "notifications.rule.fieldHour",
  "time.weekday": "notifications.rule.fieldWeekday",
};

export const OP_LABEL_KEYS: Record<BuilderOp, string> = {
  eq: "notifications.rule.opEq",
  ne: "notifications.rule.opNe",
  contains: "notifications.rule.opContains",
  not_contains: "notifications.rule.opNotContains",
  wildcard: "notifications.rule.opWildcard",
  starts_with: "notifications.rule.opStartsWith",
  ends_with: "notifications.rule.opEndsWith",
  in: "notifications.rule.opIn",
  not_in: "notifications.rule.opNotIn",
  lt: "notifications.rule.opLt",
  le: "notifications.rule.opLe",
  gt: "notifications.rule.opGt",
  ge: "notifications.rule.opGe",
};

/** A fixed list of values for a field, when it has one. */
export interface ValueChoice {
  value: string;
  labelKey?: string;
  /** Shown as-is when there's no label key. */
  text?: string;
}

const WEEKDAYS = [
  "notifications.rule.monday",
  "notifications.rule.tuesday",
  "notifications.rule.wednesday",
  "notifications.rule.thursday",
  "notifications.rule.friday",
  "notifications.rule.saturday",
  "notifications.rule.sunday",
];

const EVENT_LABELS = new Map(
  EVENT_GROUPS.flatMap((g) => g.events.map((e) => [e.value, e.labelKey])),
);

export const CATEGORIES = [
  ...new Set(ALL_EVENT_KEYS.map((e) => e.split(".")[0])),
];

/**
 * Choices for operators that compare against exact values (equals, is in);
 * free-text operators like contains always get a text box.
 */
export function valueChoices(
  field: RuleField,
  op: BuilderOp,
): ValueChoice[] | null {
  const exact = ["eq", "ne", "in", "not_in"].includes(op);
  if (field === "event" && exact)
    return ALL_EVENT_KEYS.map((value) => ({
      value,
      labelKey: EVENT_LABELS.get(value),
    }));
  if (field === "event.category" && exact)
    return CATEGORIES.map((value) => ({ value, text: value }));
  if (field === "time.weekday")
    return WEEKDAYS.map((labelKey, i) => ({ value: String(i + 1), labelKey }));
  return null;
}

/** Placeholder for a free-text value box. */
export function valuePlaceholder(field: RuleField, op: BuilderOp): string {
  const set = op === "in" || op === "not_in";
  switch (field) {
    case "ip.src":
      return set ? "10.0.0.0/8, 2001:db8::/32" : "203.0.113.7";
    case "ip.src.country":
      return set ? "US, DE" : "US";
    case "time.hour":
      return set ? "0..6, 22..23" : "9";
    case "http.user_agent":
      return op === "wildcard" ? "*Firefox*" : "Firefox";
    case "oauth.scopes":
      return set ? "openid, profile" : "openid";
    case "profile.changed_fields":
      return set ? "email, username" : "email";
    case "event":
      return op === "wildcard" ? "security.*" : "security.";
    default:
      return op === "wildcard" ? "prod-*" : "";
  }
}
