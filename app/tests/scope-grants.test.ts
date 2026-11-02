import { describe, expect, test } from "bun:test";
import {
  grantMatcher,
  heldScopes,
  parseScopeList,
  stripGrant,
} from "../src/worker/lib/scopeGrants";

describe("parseScopeList", () => {
  test("reads JSON arrays and space-separated lists", () => {
    expect(parseScopeList('["openid","site:user:read"]')).toEqual([
      "openid",
      "site:user:read",
    ]);
    expect(parseScopeList("openid  profile")).toEqual(["openid", "profile"]);
    expect(parseScopeList(null)).toEqual([]);
  });
});

describe("grantMatcher", () => {
  test("team grants only match their own team", () => {
    const m = grantMatcher("team", "t1");
    expect(m("team:t1:read")).toBe(true);
    expect(m("team:t10:read")).toBe(false);
    expect(m("site:team:read")).toBe(false);
  });
});

describe("heldScopes", () => {
  test("merges lists and strips the team prefix", () => {
    expect(
      heldScopes(
        "team",
        ['["openid","team:t1:read"]', '["team:t1:member:read","team:t2:read"]'],
        "t1",
      ),
    ).toEqual(["member:read", "read"]);
    expect(heldScopes("site", ['["openid","site:config:read"]'])).toEqual([
      "site:config:read",
    ]);
  });
});

describe("stripGrant", () => {
  test("keeps the other scopes", () => {
    expect(stripGrant('["openid","site:user:read"]', "site")).toBe(
      '["openid"]',
    );
    expect(
      stripGrant('["openid","team:t1:read","team:t2:read"]', "team", "t1"),
    ).toBe('["openid","team:t2:read"]');
  });
  test("returns null when nothing is left", () => {
    expect(stripGrant('["site:user:read"]', "site")).toBeNull();
  });
});
