// A rule as the rule page edits it, and back. Rules saved before
// expressions existed are folded in: an event glob becomes an `event`
// condition (a glob with `?` becomes the list of events it matches), and an
// account scope on a send rule just narrows its destinations. Saving writes
// only the expression, so the old glob can be widened or removed.

import type { TFunction } from "i18next";
import {
  channelKey,
  legacyGlob,
  type NotificationRule,
} from "../../../shared/notificationRules";
import {
  parseRuleExpression,
  printRuleExpression,
  type RuleExpr,
} from "../../../shared/ruleExpression";
import type { ActionState } from "./ActionCard";
import { ALL_EVENT_KEYS } from "./catalog";
import { destKey, type Destination } from "./destinations";
import { matchExpression, matchStateFor, type MatchState } from "./ruleBuilder";

export interface RuleEditState {
  name: string;
  enabled: boolean;
  match: MatchState;
  action: ActionState;
}

/** A legacy event glob as an `event` condition with the same effect. */
function globCondition(glob: string): RuleExpr {
  const event = (v: string, op: "eq" | "wildcard" = "eq"): RuleExpr => ({
    kind: "cmp",
    field: "event",
    op,
    value: { t: "string", v },
  });
  if (!glob.includes("?"))
    return event(glob, glob.includes("*") ? "wildcard" : "eq");
  // `?` (one character) has no expression form, but the events are a
  // fixed list, so name the ones it matches. None matching keeps a
  // condition that, like the glob, never holds.
  const hits = ALL_EVENT_KEYS.filter((e) => legacyGlob(glob, e));
  if (hits.length === 0) return event(glob);
  if (hits.length === 1) return event(hits[0]);
  return {
    kind: "in",
    field: "event",
    items: hits.map((v) => ({ t: "string", v })),
  };
}

/** The rule's whole condition as one expression, legacy glob included. */
export function ruleExpressionText(rule: NotificationRule): string {
  const glob = rule.match.event;
  const expression = rule.match.expression ?? "";
  if (!glob || glob === "*") return expression;
  const term = globCondition(glob);
  const rest = parseRuleExpression(expression);
  // Keep an unreadable expression visible (and failing) next to the glob.
  if (rest.error) return `${printRuleExpression(term)} and (${expression})`;
  return printRuleExpression(
    rest.expr ? { kind: "and", items: [term, rest.expr] } : term,
  );
}

export function newRuleState(): RuleEditState {
  return {
    name: "",
    enabled: true,
    match: matchStateFor(""),
    action: {
      type: "send",
      channels: [],
      muteAll: true,
      muteAccounts: [],
      stop: false,
    },
  };
}

export function ruleToState(rule: NotificationRule): RuleEditState {
  const accounts = rule.match.accounts ?? [];
  return {
    name: rule.name ?? "",
    enabled: rule.enabled !== false,
    match: matchStateFor(ruleExpressionText(rule)),
    action:
      rule.action.type === "send"
        ? {
            type: "send",
            channels: accounts.length
              ? rule.action.channels.filter((c) =>
                  accounts.includes(channelKey(c)),
                )
              : rule.action.channels,
            muteAll: true,
            muteAccounts: [],
            stop: !!rule.stop,
          }
        : {
            type: "drop",
            channels: [],
            muteAll: accounts.length === 0,
            muteAccounts: accounts,
            stop: !!rule.stop,
          },
  };
}

export type RuleStateError = "match" | "action";

/** The rule to save, or which part needs fixing. */
export function stateToRule(
  id: string,
  s: RuleEditState,
): { rule: NotificationRule; error?: undefined } | { error: RuleStateError } {
  const m = matchExpression(s.match);
  if (m.error) return { error: "match" };
  const a = s.action;
  if (a.type === "send" && a.channels.length === 0) return { error: "action" };
  if (a.type === "drop" && !a.muteAll && a.muteAccounts.length === 0)
    return { error: "action" };
  const match: NotificationRule["match"] = {};
  if (m.expression) match.expression = m.expression;
  if (a.type === "drop" && !a.muteAll) match.accounts = a.muteAccounts;
  return {
    rule: {
      id,
      name: s.name.trim() || undefined,
      enabled: s.enabled,
      stop: a.stop,
      match,
      action:
        a.type === "send"
          ? { type: "send", channels: a.channels }
          : { type: "drop" },
    },
  };
}

/** "Send to a@b.c (Full), @tg (Brief)" / "Mute all destinations". */
export function actionSummary(
  rule: NotificationRule,
  destinations: Destination[],
  t: TFunction,
): string {
  const label = (key: string) => {
    const d = destinations.find((x) => destKey(x) === key);
    return d ? d.label : t("notifications.rule.removedDestination");
  };
  const accounts = rule.match.accounts ?? [];
  if (rule.action.type === "drop") {
    return accounts.length
      ? t("notifications.rule.summaryMuteSome", {
          list: accounts.map(label).join(", "),
        })
      : t("notifications.rule.summaryMuteAll");
  }
  const channels = accounts.length
    ? rule.action.channels.filter((c) => accounts.includes(channelKey(c)))
    : rule.action.channels;
  return t("notifications.rule.summarySend", {
    list: channels
      .map(
        (c) =>
          `${label(channelKey(c))} (${t(
            c.level === "full"
              ? "notifications.levelFull"
              : "notifications.levelBrief",
          )})`,
      )
      .join(", "),
  });
}

/** A fresh id for a new rule. */
export function newRuleId(): string {
  return `r_${Math.random().toString(36).slice(2, 10)}`;
}
