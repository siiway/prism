// The expression builder's model (src/web/pages/notifications/ruleBuilder.ts):
// groups of conditions to expressions and back.

import { describe, expect, test } from "bun:test";
import {
  exprToGroups,
  groupsToExpr,
  type Condition,
  type Groups,
} from "../src/web/pages/notifications/ruleBuilder";
import {
  parseRuleExpression,
  printRuleExpression,
} from "../src/shared/ruleExpression";

const c = (
  field: Condition["field"],
  op: Condition["op"],
  value: string,
  key = `${field}${op}`,
): Condition => ({
  key,
  field,
  op,
  value,
});

const text = (groups: Groups) => printRuleExpression(groupsToExpr(groups).expr);

const parse = (src: string) => {
  const r = parseRuleExpression(src);
  if (r.error) throw new Error(r.error.code);
  return r.expr;
};

describe("groupsToExpr", () => {
  test("no conditions means every event", () => {
    expect(text([])).toBe("");
    expect(text([[]])).toBe("");
  });

  test("groups are OR-ed, conditions AND-ed", () => {
    expect(
      text([
        [
          c("event.category", "eq", "security"),
          c("ip.src", "not_in", "10.0.0.0/8, 192.168.1.1"),
        ],
        [c("resource.name", "starts_with", "prod-")],
      ]),
    ).toBe(
      'event.category eq "security" and not ip.src in {10.0.0.0/8 192.168.1.1} or starts_with(resource.name, "prod-")',
    );
  });

  test("operators per type", () => {
    expect(text([[c("time.hour", "in", "0..6, 22 .. 23, 12")]])).toBe(
      "time.hour in {0..6 22..23 12}",
    );
    expect(text([[c("http.user_agent", "not_contains", "Firefox")]])).toBe(
      'not http.user_agent contains "Firefox"',
    );
    expect(text([[c("oauth.scopes", "in", "admin, openid")]])).toBe(
      'oauth.scopes in {"admin" "openid"}',
    );
    expect(text([[c("time.weekday", "ge", "6")]])).toBe("time.weekday ge 6");
  });

  test("invalid values are reported and left out", () => {
    const { expr, invalid } = groupsToExpr([
      [
        c("ip.src", "eq", "1.2.3", "a"),
        c("time.hour", "eq", "nine", "b"),
        c("time.hour", "in", "9..3", "c"),
        c("resource.name", "eq", "", "d"),
        c("event", "eq", "app.created", "e"),
      ],
    ]);
    expect([...invalid]).toEqual(["a", "b", "c", "d"]);
    expect(printRuleExpression(expr)).toBe('event eq "app.created"');
  });

  test("the printed text parses back to the same tree", () => {
    const groups: Groups = [
      [
        c("event", "in", "app.created, app.deleted"),
        c("ip.src.country", "ne", "DE"),
      ],
      [c("profile.changed_fields", "contains", "email")],
    ];
    const { expr } = groupsToExpr(groups);
    expect(parse(printRuleExpression(expr))).toEqual(expr);
  });
});

describe("exprToGroups", () => {
  const strip = (g: Groups | null) =>
    g?.map((grp) => grp.map(({ field, op, value }) => ({ field, op, value })));

  test("round-trips builder-shaped expressions", () => {
    const src =
      'event.category eq "security" and not ip.src in {10.0.0.0/8} or not http.user_agent contains "bot" and time.hour in {0..6 23}';
    const groups = exprToGroups(parse(src));
    expect(strip(groups)).toEqual([
      [
        { field: "event.category", op: "eq", value: "security" },
        { field: "ip.src", op: "not_in", value: "10.0.0.0/8" },
      ],
      [
        { field: "http.user_agent", op: "not_contains", value: "bot" },
        { field: "time.hour", op: "in", value: "0..6, 23" },
      ],
    ]);
    expect(text(groups!)).toBe(printRuleExpression(parse(src)));
  });

  test("empty expression is an empty builder", () => {
    expect(exprToGroups(null)).toEqual([]);
  });

  test.each([
    'not (event eq "a" or event eq "b")',
    '(event eq "a" or event eq "b") and time.hour eq 1',
    'not event eq "a"',
    'resource.name in {"a,b" "c"}',
  ])("can't show %s", (src) => {
    expect(exprToGroups(parse(src))).toBeNull();
  });
});
