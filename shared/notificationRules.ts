// Notification ruleset evaluation, shared by the Worker (dispatch) and the
// frontend (the ruleset page's trace). Validation of what users save lives
// in worker/lib/notificationRules.ts.
//
// A ruleset is an ordered array of NotificationRule. When an event fires the
// rules are walked top to bottom; every rule that matches applies its action,
// and the result is the deduped list of destinations to deliver to.
//
// A rule matches when all of these hold:
//   • match.expression (shared/ruleExpression.ts) is true for the event. An
//     empty or missing expression matches every event.
//   • match.event, a legacy glob ("*", "app.*", "security.totp_enabled"),
//     matches the event name. New rules use an expression instead.
//
// Actions:
//   • send appends each channel, keyed by (kind, id); seeing the same channel
//     again at a higher level upgrades it (full > brief).
//   • drop clears the channels collected so far: all of them, or only the
//     accounts in match.accounts.
//   • match.accounts (legacy for send) limits a rule's effect to those
//     accounts: send ignores channels outside the list.
//   • stop: true ends evaluation after this rule matches.
//
// Disabled rules, and rules whose expression doesn't parse, are skipped.

import {
  evaluateRuleExpression,
  parseRuleExpression,
  type RuleContext,
  type RuleExpr,
} from "./ruleExpression";

export type NotificationLevel = "brief" | "full";

export interface RuleMatch {
  /** Rule expression; empty or missing matches every event. */
  expression?: string;
  /** Legacy event glob. */
  event?: string;
  /**
   * Account keys: "email:<email_id>", "tg:<connection_id>" or
   * "discord:<connection_id>". Empty or missing means every account.
   */
  accounts?: string[];
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

/** What happened to one rule during evaluation. */
export type RuleTraceStep =
  | { id: string; result: "matched"; stopped: boolean }
  | { id: string; result: "no_match" | "disabled" | "invalid" | "not_reached" };

/** Render a channel as the account key match.accounts uses. */
export function channelKey(c: RuleSendChannel): string {
  if (c.kind === "email") return `email:${c.email_id}`;
  if (c.kind === "discord") return `discord:${c.connection_id}`;
  return `tg:${c.connection_id}`;
}

// Parsed expressions, kept across events in the same isolate or page.
const parsed = new Map<string, RuleExpr | null | false>();

function compiled(expression: string): RuleExpr | null | false {
  let hit = parsed.get(expression);
  if (hit === undefined) {
    const r = parseRuleExpression(expression);
    hit = r.error ? false : r.expr;
    if (parsed.size > 500) parsed.clear();
    parsed.set(expression, hit);
  }
  return hit;
}

/** Whether a rule's match holds for an event; null when it can't be read. */
export function ruleMatches(
  rule: NotificationRule,
  ctx: RuleContext,
): boolean | null {
  const glob = rule.match?.event;
  if (glob && glob !== "*" && !legacyGlob(glob, String(ctx.event ?? ""))) {
    return false;
  }
  const expression = rule.match?.expression?.trim();
  if (!expression) return true;
  const expr = compiled(expression);
  if (expr === false) return null;
  return evaluateRuleExpression(expr, ctx);
}

/** Case-sensitive glob with `*` and `?`, as rules saved before expressions. */
function legacyGlob(pattern: string, text: string): boolean {
  let p = 0;
  let s = 0;
  let star = -1;
  let mark = 0;
  while (s < text.length) {
    if (p < pattern.length && pattern[p] === "*") {
      star = p++;
      mark = s;
    } else if (
      p < pattern.length &&
      (pattern[p] === "?" || pattern[p] === text[s])
    ) {
      p++;
      s++;
    } else if (star >= 0) {
      p = star + 1;
      s = ++mark;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === "*") p++;
  return p === pattern.length;
}

function upgrade(
  prev: NotificationLevel | undefined,
  next: NotificationLevel,
): NotificationLevel {
  return prev === "full" || next === "full" ? "full" : "brief";
}

/** Walk the ruleset for one event, recording what each rule did. */
export function traceRuleset(
  rules: NotificationRule[],
  ctx: RuleContext,
): { delivery: ResolvedDelivery; steps: RuleTraceStep[] } {
  const emailMap = new Map<string, NotificationLevel>();
  const tgMap = new Map<string, NotificationLevel>();
  const discordMap = new Map<string, NotificationLevel>();
  const steps: RuleTraceStep[] = [];
  let stopped = false;

  for (const rule of rules) {
    if (stopped) {
      steps.push({ id: rule.id, result: "not_reached" });
      continue;
    }
    if (rule.enabled === false) {
      steps.push({ id: rule.id, result: "disabled" });
      continue;
    }
    const hit = ruleMatches(rule, ctx);
    if (hit === null) {
      steps.push({ id: rule.id, result: "invalid" });
      continue;
    }
    if (!hit) {
      steps.push({ id: rule.id, result: "no_match" });
      continue;
    }

    const scoped =
      rule.match.accounts && rule.match.accounts.length > 0
        ? new Set(rule.match.accounts)
        : null;

    if (rule.action.type === "drop") {
      if (scoped) {
        for (const key of scoped) {
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
        if (scoped && !scoped.has(channelKey(ch))) continue;
        if (ch.kind === "email") {
          emailMap.set(
            ch.email_id,
            upgrade(emailMap.get(ch.email_id), ch.level),
          );
        } else if (ch.kind === "tg") {
          tgMap.set(
            ch.connection_id,
            upgrade(tgMap.get(ch.connection_id), ch.level),
          );
        } else if (ch.kind === "discord") {
          discordMap.set(
            ch.connection_id,
            upgrade(discordMap.get(ch.connection_id), ch.level),
          );
        }
      }
    }

    stopped = !!rule.stop;
    steps.push({ id: rule.id, result: "matched", stopped });
  }

  return {
    delivery: {
      emails: [...emailMap].map(([email_id, level]) => ({ email_id, level })),
      tgs: [...tgMap].map(([connection_id, level]) => ({
        connection_id,
        level,
      })),
      discords: [...discordMap].map(([connection_id, level]) => ({
        connection_id,
        level,
      })),
    },
    steps,
  };
}

export function evaluateRuleset(
  rules: NotificationRule[],
  ctx: RuleContext,
): ResolvedDelivery {
  return traceRuleset(rules, ctx).delivery;
}
