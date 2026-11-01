// Notification rule expressions (shared/ruleExpression.ts): parsing, type
// checks, limits, canonical printing and evaluation.

import { describe, expect, test } from "bun:test";
import {
  LIMITS,
  buildRuleContext,
  evaluateRuleExpression,
  parseRuleExpression,
  printRuleExpression,
  wildcardMatch,
  type RuleContext,
} from "../shared/ruleExpression";

function parse(src: string) {
  const r = parseRuleExpression(src);
  if (r.error) throw new Error(`${r.error.code} at ${r.error.at}: ${src}`);
  return r.expr;
}

function matches(src: string, ctx: RuleContext) {
  return evaluateRuleExpression(parse(src), ctx);
}

describe("parse and print", () => {
  test("empty means every event", () => {
    expect(parseRuleExpression("   ")).toEqual({ expr: null });
    expect(evaluateRuleExpression(null, {})).toBe(true);
  });

  test.each([
    'event eq "app.created"',
    'event.category eq "security" and not ip.src in {10.0.0.0/8 192.168.0.0/16}',
    '(resource.name wildcard "prod-*" or http.user_agent contains "curl") and time.hour in {0..6 22..23}',
    'starts_with(event, "connection.") or ends_with(resource.name, ".dev")',
    'not (event eq "a" or event eq "b")',
    'oauth.scopes contains "admin" and ip.src eq 2001:db8::1',
    'resource.name eq "say \\"hi\\" \\\\ bye"',
  ])("round-trips %s", (src) => {
    const expr = parse(src);
    const printed = printRuleExpression(expr);
    expect(parse(printed)).toEqual(expr);
    expect(printRuleExpression(parse(printed))).toBe(printed);
  });

  test("symbols mean the same as words", () => {
    expect(parse('!(event == "a") && time.hour >= 9 || time.hour < 2')).toEqual(
      parse('not (event eq "a") and time.hour ge 9 or time.hour lt 2'),
    );
  });

  test("and binds tighter than or, not tighter than and", () => {
    expect(
      printRuleExpression(
        parse('event eq "a" or event eq "b" and not event eq "c"'),
      ),
    ).toBe('event eq "a" or event eq "b" and not event eq "c"');
    const e = parse('event eq "a" or event eq "b" and event eq "c"');
    expect(e?.kind).toBe("or");
  });
});

describe("errors", () => {
  test.each([
    ['nope eq "x"', "unknown_field", 0],
    ['event gt "x"', "bad_operator", 6],
    ["event eq 5", "bad_value", 9],
    ['time.hour eq "9"', "bad_value", 13],
    ['ip.src eq "1.2.3.4"', "bad_value", 10],
    ["ip.src eq 1.2.3.999", "bad_value", 10],
    ["ip.src in {10.0.0.0/33}", "bad_value", 11],
    ['oauth.scopes eq "x"', "bad_operator", 13],
    ['starts_with(time.hour, "1")', "bad_operator", 12],
    ['event eq "x', "unterminated_string", 9],
    ['event eq "x" and', "unexpected_end", 16],
    ['event eq "x" event', "unexpected_token", 13],
    ["time.hour in {}", "bad_value", 14],
    ["time.hour in {9..3}", "bad_value", 17],
    ['(event eq "x"', "unexpected_end", 13],
  ] as const)("%s → %s", (src, code, at) => {
    const r = parseRuleExpression(src);
    expect(r.error?.code).toBe(code);
    expect(r.error?.at).toBe(at);
  });

  test("limits", () => {
    expect(parseRuleExpression("x".repeat(LIMITS.length + 1)).error?.code).toBe(
      "too_long",
    );
    const deep =
      "(".repeat(LIMITS.depth + 1) +
      'event eq "a"' +
      ")".repeat(LIMITS.depth + 1);
    expect(parseRuleExpression(deep).error?.code).toBe("too_deep");
    const set = `time.hour in {${Array.from({ length: LIMITS.setItems + 1 }, (_, i) => i).join(" ")}}`;
    expect(parseRuleExpression(set).error?.code).toBe("too_many_items");
    expect(
      parseRuleExpression(`event eq "${"a".repeat(LIMITS.string + 1)}"`).error
        ?.code,
    ).toBe("too_long");
  });

  test("condition count is limited", () => {
    const many = Array.from(
      { length: LIMITS.conditions + 1 },
      () => "time.hour eq 1",
    ).join(" or ");
    expect(many.length).toBeLessThan(LIMITS.length);
    expect(parseRuleExpression(many).error?.code).toBe("too_many_items");
  });
});

describe("evaluation", () => {
  const ctx: RuleContext = {
    event: "security.passkey_added",
    "event.category": "security",
    "ip.src": "203.0.113.7",
    "ip.src.country": "DE",
    "http.user_agent": "Mozilla/5.0 Firefox/130.0",
    "resource.name": "Prod-Key",
    "oauth.scopes": ["openid", "profile"],
    "profile.changed_fields": null,
    "time.hour": 23,
    "time.weekday": 6,
  };

  test("strings", () => {
    expect(matches('event eq "security.passkey_added"', ctx)).toBe(true);
    expect(matches('event ne "security.passkey_added"', ctx)).toBe(false);
    expect(matches('http.user_agent contains "Firefox"', ctx)).toBe(true);
    expect(matches('http.user_agent contains "firefox"', ctx)).toBe(false);
    expect(matches('resource.name wildcard "prod-*"', ctx)).toBe(true);
    expect(matches('starts_with(event, "security.")', ctx)).toBe(true);
    expect(matches('ends_with(event, "_removed")', ctx)).toBe(false);
    expect(matches('ip.src.country in {"DE" "FR"}', ctx)).toBe(true);
  });

  test("IP addresses and CIDR, v4 and v6", () => {
    expect(matches("ip.src eq 203.0.113.7", ctx)).toBe(true);
    expect(matches("ip.src in {203.0.113.0/24}", ctx)).toBe(true);
    expect(matches("ip.src in {10.0.0.0/8 192.168.0.0/16}", ctx)).toBe(false);
    expect(matches("ip.src eq ::ffff:203.0.113.7", ctx)).toBe(true);
    const v6 = { "ip.src": "2001:db8:abcd::42" };
    expect(matches("ip.src in {2001:db8::/32}", v6)).toBe(true);
    expect(matches("ip.src in {2001:db9::/32}", v6)).toBe(false);
    expect(matches("ip.src eq 2001:DB8:ABCD:0:0:0:0:42", v6)).toBe(true);
    expect(matches("ip.src in {0.0.0.0/0}", v6)).toBe(false);
    expect(matches("ip.src in {::/0}", v6)).toBe(true);
  });

  test("integers and ranges", () => {
    expect(matches("time.hour in {0..6 22..23}", ctx)).toBe(true);
    expect(matches("time.hour ge 9 and time.hour le 17", ctx)).toBe(false);
    expect(matches("time.weekday in {6 7}", ctx)).toBe(true);
  });

  test("arrays", () => {
    expect(matches('oauth.scopes contains "openid"', ctx)).toBe(true);
    expect(matches('oauth.scopes in {"admin" "profile"}', ctx)).toBe(true);
    expect(matches('oauth.scopes in {"admin"}', ctx)).toBe(false);
  });

  test("missing values only satisfy ne", () => {
    expect(matches('profile.changed_fields contains "email"', ctx)).toBe(false);
    expect(matches('ip.src.country eq "DE"', {})).toBe(false);
    expect(matches('ip.src.country ne "DE"', {})).toBe(true);
    expect(matches('ip.src.country in {"DE"}', {})).toBe(false);
    expect(matches("ip.src ne 1.2.3.4", {})).toBe(true);
  });

  test("logic", () => {
    expect(
      matches('not event eq "x" and (time.hour eq 1 or time.hour eq 23)', ctx),
    ).toBe(true);
  });
});

describe("wildcard", () => {
  test("basics", () => {
    expect(wildcardMatch("*", "")).toBe(true);
    expect(wildcardMatch("a*c", "ABC")).toBe(true);
    expect(wildcardMatch("a*c", "abd")).toBe(false);
    expect(wildcardMatch("*.example.*", "api.example.com")).toBe(true);
    expect(wildcardMatch("a?c", "abc")).toBe(false);
  });

  test("pathological patterns stay fast", () => {
    const start = performance.now();
    expect(wildcardMatch("*a*a*a*a*a*a*a*a*b", "a".repeat(512))).toBe(false);
    expect(performance.now() - start).toBeLessThan(100);
  });
});

describe("context", () => {
  test("built from an event payload", () => {
    const ctx = buildRuleContext(
      "oauth.consent_granted",
      {
        app_name: "Widget",
        scopes: ["openid", "email"],
        operator_ip: "198.51.100.1",
        operator_country: "JP",
        operator_user_agent: "curl/8",
      },
      new Date("2026-11-01T22:30:00Z"), // a Sunday
    );
    expect(ctx).toEqual({
      event: "oauth.consent_granted",
      "event.category": "oauth",
      "ip.src": "198.51.100.1",
      "ip.src.country": "JP",
      "http.user_agent": "curl/8",
      "resource.name": "Widget",
      "oauth.scopes": ["openid", "email"],
      "profile.changed_fields": null,
      "time.hour": 22,
      "time.weekday": 7,
    });
  });
});
