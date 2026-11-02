// Ruleset evaluation (src/shared/notificationRules.ts) and validation of saved
// rules (src/worker/lib/notificationRules.ts).

import { describe, expect, test } from "bun:test";
import {
  traceRuleset,
  type NotificationRule,
  type RuleSendChannel,
} from "../src/shared/notificationRules";
import { buildRuleContext } from "../src/shared/ruleExpression";
import { sanitizeRulesArray } from "../src/worker/lib/notificationRules";

const EVENTS = ["app.created", "security.passkey_added", "connection.login"];

const ctx = (event: string, data: Record<string, unknown> = {}) =>
  buildRuleContext(event, data, new Date("2026-11-02T03:00:00Z"));

const send = (
  id: string,
  expression: string | undefined,
  channels: RuleSendChannel[],
  extra: Partial<NotificationRule> = {},
): NotificationRule => ({
  id,
  match: expression === undefined ? {} : { expression },
  action: { type: "send", channels },
  ...extra,
});

describe("traceRuleset", () => {
  const rules: NotificationRule[] = [
    send("all", "", [{ kind: "email", email_id: "primary", level: "brief" }]),
    send("security-full", 'event.category eq "security"', [
      { kind: "email", email_id: "primary", level: "full" },
      { kind: "tg", connection_id: "t1", level: "brief" },
    ]),
    {
      id: "quiet-office",
      match: { expression: "ip.src in {10.0.0.0/8}" },
      action: { type: "drop" },
      stop: true,
    },
    send("never", "", [
      { kind: "discord", connection_id: "d1", level: "full" },
    ]),
  ];

  test("upgrades levels and dedupes", () => {
    const { delivery, steps } = traceRuleset(
      rules,
      ctx("security.passkey_added", { operator_ip: "203.0.113.1" }),
    );
    expect(delivery.emails).toEqual([{ email_id: "primary", level: "full" }]);
    expect(delivery.tgs).toEqual([{ connection_id: "t1", level: "brief" }]);
    expect(delivery.discords).toEqual([{ connection_id: "d1", level: "full" }]);
    expect(steps.map((s) => s.result)).toEqual([
      "matched",
      "matched",
      "no_match",
      "matched",
    ]);
  });

  test("drop clears and stop ends evaluation", () => {
    const { delivery, steps } = traceRuleset(
      rules,
      ctx("security.passkey_added", { operator_ip: "10.1.2.3" }),
    );
    expect(delivery).toEqual({ emails: [], tgs: [], discords: [] });
    expect(steps[2]).toEqual({
      id: "quiet-office",
      result: "matched",
      stopped: true,
    });
    expect(steps[3]).toEqual({ id: "never", result: "not_reached" });
  });

  test("disabled and unreadable rules are skipped", () => {
    const { steps } = traceRuleset(
      [send("off", "", [], { enabled: false }), send("broken", "event eq", [])],
      ctx("app.created"),
    );
    expect(steps.map((s) => s.result)).toEqual(["disabled", "invalid"]);
  });

  test("legacy event globs and account scopes still work", () => {
    const legacy: NotificationRule[] = [
      {
        id: "apps",
        match: { event: "app.*" },
        action: {
          type: "send",
          channels: [
            { kind: "email", email_id: "primary", level: "full" },
            { kind: "email", email_id: "e2", level: "full" },
          ],
        },
      },
      {
        id: "mute-e2",
        match: { event: "app.creat?d", accounts: ["email:e2"] },
        action: { type: "drop" },
      },
    ];
    expect(traceRuleset(legacy, ctx("app.created")).delivery.emails).toEqual([
      { email_id: "primary", level: "full" },
    ]);
    expect(traceRuleset(legacy, ctx("App.created")).delivery.emails).toEqual(
      [],
    );
  });
});

describe("sanitizeRulesArray", () => {
  test("stores expressions in canonical form", () => {
    const r = sanitizeRulesArray(
      [
        {
          id: "r1",
          match: {
            expression: '  event == "app.created" &&  ip.src in { 10.0.0.0/8 }',
          },
          action: { type: "drop" },
        },
        { id: "r2", match: { expression: "   " }, action: { type: "drop" } },
      ],
      EVENTS,
    );
    expect(r.error).toBeUndefined();
    expect(r.rules![0].match.expression).toBe(
      'event eq "app.created" and ip.src in {10.0.0.0/8}',
    );
    expect(r.rules![1].match).toEqual({});
  });

  test("rejects a bad expression with a coded reason", () => {
    const r = sanitizeRulesArray(
      [
        {
          id: "r1",
          match: { expression: 'nope eq "x"' },
          action: { type: "drop" },
        },
      ],
      EVENTS,
    );
    expect(r).toEqual({
      error: "rule_expression_unknown_field",
      params: { field: "rules[0].match.expression", at: 0, token: "nope" },
    });
  });

  test("rejects a non-string expression", () => {
    const r = sanitizeRulesArray(
      [{ id: "r1", match: { expression: 5 }, action: { type: "drop" } }],
      EVENTS,
    );
    expect(r.error).toBe("field_must_be_string");
  });
});
