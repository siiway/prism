import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

class SqliteD1Statement {
  private values: unknown[] = [];

  constructor(
    private readonly db: Database,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async run() {
    const results = this.db.query(this.sql).all(...this.values);
    const { changes } = this.db.query("SELECT changes() AS changes").get() as {
      changes: number;
    };
    return { success: true, results, meta: { changes } };
  }

  async first<T>(columnName?: string) {
    const row =
      (this.db.query(this.sql).get(...this.values) as T | null) ?? null;
    if (row === null || columnName === undefined) return row;
    return Object(row)[columnName] ?? null;
  }

  async all<T>() {
    return {
      success: true,
      results: this.db.query(this.sql).all(...this.values) as T[],
    };
  }
}

class SqliteD1 {
  constructor(private readonly db: Database) {}

  prepare(sql: string) {
    return new SqliteD1Statement(this.db, sql);
  }
}

let sqlite: Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE oauth_consents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      scopes TEXT NOT NULL,
      granted_at INTEGER NOT NULL,
      auto_authorize INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, client_id)
    );

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      notify_on_auto_authorization INTEGER NOT NULL DEFAULT 0
    );
  `);
  db = new SqliteD1(sqlite) as unknown as D1Database;
});

afterEach(() => sqlite.close());

describe("OAuth auto_authorize & notification logic", () => {
  test("exact scope match enables auto_authorize eligibility", async () => {
    const now = Math.floor(Date.now() / 1000);
    const rememberedScopes = ["openid", "profile", "email"];

    await db
      .prepare(
        `INSERT INTO oauth_consents (id, user_id, client_id, scopes, granted_at, auto_authorize)
         VALUES ('c1', 'u1', 'app1', ?, ?, 1)`,
      )
      .bind(JSON.stringify(rememberedScopes), now)
      .run();

    const consent = await db
      .prepare(
        "SELECT scopes, auto_authorize FROM oauth_consents WHERE user_id = 'u1' AND client_id = 'app1'",
      )
      .first<{ scopes: string; auto_authorize: number }>();

    expect(consent?.auto_authorize).toBe(1);
    const parsedScopes: string[] = JSON.parse(consent!.scopes);

    // Test exact match (order permutation)
    const requested1 = ["email", "openid", "profile"];
    const isExactMatch1 =
      parsedScopes.length === requested1.length &&
      new Set(parsedScopes).size === requested1.length &&
      parsedScopes.every((s) => requested1.includes(s));
    expect(isExactMatch1).toBe(true);

    // Test scope change (subset) - should NOT auto authorize
    const requested2 = ["openid", "profile"];
    const isExactMatch2 =
      parsedScopes.length === requested2.length &&
      new Set(parsedScopes).size === requested2.length &&
      parsedScopes.every((s) => requested2.includes(s));
    expect(isExactMatch2).toBe(false);

    // Test scope change (superset) - should NOT auto authorize
    const requested3 = ["openid", "profile", "email", "offline_access"];
    const isExactMatch3 =
      parsedScopes.length === requested3.length &&
      new Set(parsedScopes).size === requested3.length &&
      parsedScopes.every((s) => requested3.includes(s));
    expect(isExactMatch3).toBe(false);
  });

  test("updating consent to disable auto_authorize works", async () => {
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare(
        `INSERT INTO oauth_consents (id, user_id, client_id, scopes, granted_at, auto_authorize)
         VALUES ('c1', 'u1', 'app1', '["openid"]', ?, 1)`,
      )
      .bind(now)
      .run();

    await db
      .prepare(
        "UPDATE oauth_consents SET auto_authorize = 0 WHERE user_id = 'u1' AND client_id = 'app1'",
      )
      .run();

    const consent = await db
      .prepare(
        "SELECT auto_authorize FROM oauth_consents WHERE user_id = 'u1' AND client_id = 'app1'",
      )
      .first<{ auto_authorize: number }>();

    expect(consent?.auto_authorize).toBe(0);
  });
});
