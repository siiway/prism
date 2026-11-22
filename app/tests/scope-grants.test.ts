import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  grantMatcher,
  heldScopes,
  likeAny,
  parseScopeList,
  SITE_GRANT_LIKES,
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

describe("site grant LIKE patterns", () => {
  test("find site-level scopes, not app scopes that mention them", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (id TEXT, scopes TEXT)");
    const rows: [string, string][] = [
      ["json-site", '["openid","site:user:read"]'],
      ["json-admin", '["admin:config:read"]'],
      ["legacy", "openid admin:users:read"],
      ["legacy-first", "site:team:read openid"],
      ["app-admin", '["openid","app:x:admin:panel"]'],
      ["app-site", "openid app:x:site:map"],
    ];
    for (const r of rows) db.run("INSERT INTO t VALUES (?, ?)", r);
    const found = (
      db
        .query(
          `SELECT id FROM t WHERE ${likeAny("scopes", SITE_GRANT_LIKES)} ORDER BY id`,
        )
        .all(...SITE_GRANT_LIKES) as { id: string }[]
    ).map((r) => r.id);
    expect(found).toEqual([
      "json-admin",
      "json-site",
      "legacy",
      "legacy-first",
    ]);
  });
});
