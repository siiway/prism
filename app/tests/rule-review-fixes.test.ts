// Regression tests for the review of PR #42 (notification rule expressions).

import { describe, expect, test } from "bun:test";
import {
  buildRuleContext,
  parseRuleExpression,
  wildcardMatch,
} from "../src/shared/ruleExpression";
import { traceRuleset } from "../src/shared/notificationRules";
import { sanitizeRulesArray } from "../src/worker/lib/notificationRules";
import {
  ruleExpressionText,
  ruleToState,
  stateToRule,
} from "../src/web/pages/notifications/ruleEdit";

describe("inherited property names are not fields or operators", () => {
  test.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "%s",
    (name) => {
      expect(parseRuleExpression(`${name} eq "x"`).error?.code).toBe(
        "unknown_field",
      );
      expect(parseRuleExpression(`event ${name} "x"`).error?.code).toBe(
        "bad_operator",
      );
    },
  );
});

describe("context", () => {
  const at = new Date("2026-11-02T10:00:00Z");

  test("profile.updated's changed_fields object gives the field names", () => {
    const ctx = buildRuleContext(
      "profile.updated",
      { changed_fields: { display_name: "New", avatar_url: "" } },
      at,
    );
    expect(ctx["profile.changed_fields"]).toEqual([
      "display_name",
      "avatar_url",
    ]);
  });

  test("oauth.scopes only comes from OAuth events", () => {
    const scopes = ["apps:write"];
    expect(
      buildRuleContext("token.created", { scopes }, at)["oauth.scopes"],
    ).toBeNull();
    expect(
      buildRuleContext("oauth.consent_granted", { scopes }, at)["oauth.scopes"],
    ).toEqual(scopes);
  });

  test("header values are capped", () => {
    const ctx = buildRuleContext(
      "app.created",
      { operator_user_agent: "x".repeat(20_000) },
      at,
    );
    expect((ctx["http.user_agent"] as string).length).toBe(1024);
  });
});

describe("wildcard without backtracking", () => {
  test.each([
    ["*", "", true],
    ["*", "anything", true],
    ["abc", "ABC", true],
    ["abc", "abcd", false],
    ["a*", "a", true],
    ["*a", "ba", true],
    ["a*a", "a", false],
    ["a*a", "aa", true],
    ["a*b*c", "aXXbYYc", true],
    ["a*b*c", "aXXcYYb", false],
    ["*ab*ab*", "xabyab", true],
    ["*ab*ab*", "xaby", false],
    ["prod-*", "Prod-API", true],
    ["*.example.*", "api.example.com", true],
    ["a**b", "ab", true],
  ] as const)("%s ~ %s → %s", (pattern, text, expected) => {
    expect(wildcardMatch(pattern, text)).toBe(expected);
  });

  test("a long pattern against a long value stays fast", () => {
    const pattern = "*a".repeat(255) + "*b";
    const text = "a".repeat(1024);
    const start = performance.now();
    for (let i = 0; i < 200; i++)
      expect(wildcardMatch(pattern, text)).toBe(false);
    expect(performance.now() - start).toBeLessThan(200);
  });
});

describe("duplicate rule ids", () => {
  test("are rejected on save", () => {
    const r = sanitizeRulesArray(
      [
        { id: "same", match: {}, action: { type: "drop" } },
        { id: "same", match: {}, action: { type: "drop" } },
      ],
      ["app.created"],
    );
    expect(r).toEqual({
      error: "rule_duplicate_id",
      params: { field: "rules[1].id", id: "same" },
    });
  });
});

describe("legacy globs with ? become editable conditions", () => {
  const legacy = {
    id: "r1",
    match: { event: "app.*?ed" },
    action: { type: "drop" as const },
  };

  test("named as the events they match", () => {
    expect(ruleExpressionText(legacy)).toBe(
      'event in {"app.created" "app.updated" "app.deleted"}',
    );
    expect(
      ruleExpressionText({ ...legacy, match: { event: "app.creat?d" } }),
    ).toBe('event eq "app.created"');
  });

  test("saving writes the expression only, so the glob can be removed", () => {
    const state = ruleToState(legacy);
    expect(state.match.mode).toBe("builder");
    const saved = stateToRule("r1", state);
    expect(saved.rule?.match).toEqual({
      expression: 'event in {"app.created" "app.updated" "app.deleted"}',
    });
    const broadened = stateToRule("r1", {
      ...state,
      match: { ...state.match, mode: "all" },
    });
    expect(broadened.rule?.match).toEqual({});
  });

  test("the converted rule behaves like the glob", () => {
    const saved = stateToRule("r1", ruleToState(legacy)).rule!;
    for (const event of [
      "app.created",
      "app.updated",
      "app.deleted",
      "domain.added",
    ]) {
      const ctx = buildRuleContext(event, {}, new Date());
      expect(traceRuleset([saved], ctx).steps[0].result).toBe(
        traceRuleset([legacy], ctx).steps[0].result,
      );
    }
  });
});
