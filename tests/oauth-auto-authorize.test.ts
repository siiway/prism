import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import oauthRoutes from "../worker/routes/oauth";
import { signJWT } from "../worker/lib/jwt";
import { SESSION_COOKIE } from "../worker/lib/cookies";

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
    const result = this.db.query(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  async first<T>(columnName?: string) {
    const row = (this.db.query(this.sql).get(...this.values) as T | null) ?? null;
    if (row === null || columnName === undefined) return row;
    return Object(row)[columnName] ?? null;
  }

  async all<T>() {
    return {
      success: true,
      results: this.db.query(this.sql).all(...this.values) as T[],
    };
  }

  async raw<T>() {
    return this.db.query(this.sql).values(...this.values) as T[];
  }
}

class SqliteD1 {
  constructor(private readonly db: Database) {}

  prepare(sql: string) {
    return new SqliteD1Statement(this.db, sql);
  }
}

class MemoryKv {
  private readonly values = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial))
      this.values.set(key, value);
  }

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string) {
    this.values.set(key, value);
  }

  async delete(key: string) {
    this.values.delete(key);
  }
}

const jwtSecret = "test-jwt-secret-oauth";
const executionCtx = {
  waitUntil(promise: Promise<unknown>) {
    void promise.catch(() => undefined);
  },
  passThroughOnException() {},
} as ExecutionContext;

let sqlite: Database;
let db: D1Database;
let app: Hono;

function testEnv(): Env {
  return {
    DB: db,
    APP_URL: "https://prism.example",
    KV_CACHE: new MemoryKv() as unknown as KVNamespace,
    KV_SESSIONS: new MemoryKv({
      "system:jwt_secret": jwtSecret,
    }) as unknown as KVNamespace,
  } as unknown as Env;
}

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE site_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'user',
      username TEXT NOT NULL,
      display_name TEXT,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      avatar_url TEXT,
      origin_team_id TEXT,
      origin_join_completed INTEGER,
      converted_at INTEGER,
      email_verified INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      notify_on_auto_authorization INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE domains (
      domain TEXT PRIMARY KEY,
      user_id TEXT,
      team_id TEXT,
      verified INTEGER NOT NULL DEFAULT 1,
      verified_at INTEGER
    );

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      amr TEXT
    );

    CREATE TABLE oauth_apps (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL UNIQUE,
      client_secret_hash TEXT,
      name TEXT NOT NULL,
      description TEXT,
      icon_url TEXT,
      website_url TEXT,
      owner_id TEXT NOT NULL,
      team_id TEXT,
      redirect_uris TEXT NOT NULL,
      allowed_scopes TEXT NOT NULL,
      optional_scopes TEXT,
      is_first_party INTEGER NOT NULL DEFAULT 0,
      is_official INTEGER NOT NULL DEFAULT 0,
      is_verified INTEGER NOT NULL DEFAULT 0,
      is_public INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      access_whitelist_enabled INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE oauth_consents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      scopes TEXT NOT NULL,
      granted_at INTEGER NOT NULL,
      auto_authorize INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, client_id)
    );

    CREATE TABLE oauth_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      scopes TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      refresh_token_hash TEXT,
      refresh_expires_at INTEGER
    );

    CREATE TABLE oauth_codes (
      code TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      scopes TEXT NOT NULL,
      code_challenge TEXT,
      code_challenge_method TEXT,
      nonce TEXT,
      resource TEXT,
      auth_time INTEGER,
      amr TEXT,
      session_id TEXT,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      scope_id TEXT,
      action TEXT NOT NULL,
      actor_id TEXT,
      actor_name TEXT,
      resource_type TEXT,
      resource_id TEXT,
      resource_name TEXT,
      ip TEXT,
      user_agent TEXT,
      geo TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  db = new SqliteD1(sqlite) as unknown as D1Database;

  app = new Hono();
  app.route("/oauth", oauthRoutes);
});

afterEach(() => sqlite.close());

async function makeSessionCookie(userId: string, username: string): Promise<string> {
  const sessionId = `s_${userId}`;
  const now = Math.floor(Date.now() / 1000);
  sqlite.run(
    "INSERT OR REPLACE INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, 'hash', ?, ?)",
    [sessionId, userId, now, now + 3600],
  );
  const jwt = await signJWT(
    {
      sub: userId,
      role: "user",
      sessionId,
      email: `${username}@example.com`,
      username,
      display_name: username,
      avatar_url: null,
    },
    jwtSecret,
    3600,
  );
  return `${SESSION_COOKIE}=${jwt}`;
}

describe("OAuth auto-authorization with production routes", () => {
  test("GET /oauth/app-info calculates auto_authorize_eligible accurately based on DB record and scopes", async () => {
    const now = Math.floor(Date.now() / 1000);
    sqlite.run(
      `INSERT INTO users (id, username, email, created_at, updated_at) VALUES ('u1', 'alice', 'alice@example.com', ?, ?)`,
      [now, now],
    );
    sqlite.run(
      `INSERT INTO oauth_apps (id, client_id, name, owner_id, redirect_uris, allowed_scopes, created_at, updated_at)
       VALUES ('app_1', 'client_1', 'Test App', 'u1', '["https://example.com/cb"]', '["openid","profile","email"]', ?, ?)`,
      [now, now],
    );

    const cookie = await makeSessionCookie("u1", "alice");

    // Case 1: No prior consent in DB -> auto_authorize_eligible = false
    const res1 = await app.fetch(
      new Request(
        "https://prism.example/oauth/app-info?client_id=client_1&redirect_uri=https://example.com/cb&response_type=code&scope=openid%20profile",
        { headers: { Cookie: cookie } },
      ),
      testEnv(),
      executionCtx,
    );
    expect(res1.status).toBe(200);
    const body1 = await res1.json<{ auto_authorize_eligible: boolean }>();
    expect(body1.auto_authorize_eligible).toBe(false);

    // Case 2: Prior consent with auto_authorize = 1 and exact scope match ["openid", "profile"]
    sqlite.run(
      `INSERT INTO oauth_consents (id, user_id, client_id, scopes, granted_at, auto_authorize)
       VALUES ('c1', 'u1', 'client_1', '["openid","profile"]', ?, 1)`,
      [now],
    );

    const res2 = await app.fetch(
      new Request(
        "https://prism.example/oauth/app-info?client_id=client_1&redirect_uri=https://example.com/cb&response_type=code&scope=profile%20openid",
        { headers: { Cookie: cookie } },
      ),
      testEnv(),
      executionCtx,
    );
    expect(res2.status).toBe(200);
    const body2 = await res2.json<{ auto_authorize_eligible: boolean }>();
    expect(body2.auto_authorize_eligible).toBe(true);

    // Case 3: Scope changed (e.g. requesting email now) -> auto_authorize_eligible = false
    const res3 = await app.fetch(
      new Request(
        "https://prism.example/oauth/app-info?client_id=client_1&redirect_uri=https://example.com/cb&response_type=code&scope=openid%20profile%20email",
        { headers: { Cookie: cookie } },
      ),
      testEnv(),
      executionCtx,
    );
    expect(res3.status).toBe(200);
    const body3 = await res3.json<{ auto_authorize_eligible: boolean }>();
    expect(body3.auto_authorize_eligible).toBe(false);

    // Case 4: prompt=consent forces UI -> auto_authorize_eligible = false
    const res4 = await app.fetch(
      new Request(
        "https://prism.example/oauth/app-info?client_id=client_1&redirect_uri=https://example.com/cb&response_type=code&scope=openid%20profile&prompt=consent",
        { headers: { Cookie: cookie } },
      ),
      testEnv(),
      executionCtx,
    );
    expect(res4.status).toBe(200);
    const body4 = await res4.json<{ auto_authorize_eligible: boolean }>();
    expect(body4.auto_authorize_eligible).toBe(false);
  });

  test("POST /oauth/authorize derives authorization_mode and auto_authorize in DB correctly", async () => {
    const now = Math.floor(Date.now() / 1000);
    sqlite.run(
      `INSERT INTO users (id, username, email, created_at, updated_at) VALUES ('u1', 'alice', 'alice@example.com', ?, ?)`,
      [now, now],
    );
    sqlite.run(
      `INSERT INTO oauth_apps (id, client_id, name, owner_id, redirect_uris, allowed_scopes, created_at, updated_at)
       VALUES ('app_1', 'client_1', 'Test App', 'u1', '["https://example.com/cb"]', '["openid","profile","email"]', ?, ?)`,
      [now, now],
    );

    const cookie = await makeSessionCookie("u1", "alice");

    // Approve with authorization_mode: "always"
    const approveRes = await app.fetch(
      new Request("https://prism.example/oauth/authorize", {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: "client_1",
          redirect_uri: "https://example.com/cb",
          scope: "openid profile",
          action: "approve",
          authorization_mode: "always",
        }),
      }),
      testEnv(),
      executionCtx,
    );

    expect(approveRes.status).toBe(200);
    const consent = sqlite
      .query("SELECT auto_authorize, scopes FROM oauth_consents WHERE user_id = 'u1' AND client_id = 'client_1'")
      .get() as { auto_authorize: number; scopes: string };
    expect(consent.auto_authorize).toBe(1);
    expect(JSON.parse(consent.scopes)).toEqual(["openid", "profile"]);

    // Next time, approve with authorization_mode: "once" resets auto_authorize to 0
    const approveOnceRes = await app.fetch(
      new Request("https://prism.example/oauth/authorize", {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: "client_1",
          redirect_uri: "https://example.com/cb",
          scope: "openid profile",
          action: "approve",
          authorization_mode: "once",
        }),
      }),
      testEnv(),
      executionCtx,
    );

    expect(approveOnceRes.status).toBe(200);
    const consentAfter = sqlite
      .query("SELECT auto_authorize FROM oauth_consents WHERE user_id = 'u1' AND client_id = 'client_1'")
      .get() as { auto_authorize: number };
    expect(consentAfter.auto_authorize).toBe(0);
  });

  test("PATCH /oauth/consents/:clientId disables auto_authorize", async () => {
    const now = Math.floor(Date.now() / 1000);
    sqlite.run(
      `INSERT INTO users (id, username, email, created_at, updated_at) VALUES ('u1', 'alice', 'alice@example.com', ?, ?)`,
      [now, now],
    );
    sqlite.run(
      `INSERT INTO oauth_consents (id, user_id, client_id, scopes, granted_at, auto_authorize)
       VALUES ('c1', 'u1', 'client_1', '["openid"]', ?, 1)`,
      [now],
    );

    const cookie = await makeSessionCookie("u1", "alice");

    const patchRes = await app.fetch(
      new Request("https://prism.example/oauth/consents/client_1", {
        method: "PATCH",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ auto_authorize: false }),
      }),
      testEnv(),
      executionCtx,
    );

    expect(patchRes.status).toBe(200);
    const row = sqlite
      .query("SELECT auto_authorize FROM oauth_consents WHERE user_id = 'u1' AND client_id = 'client_1'")
      .get() as { auto_authorize: number };
    expect(row.auto_authorize).toBe(0);
  });
});
