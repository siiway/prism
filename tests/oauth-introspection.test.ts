import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import oauthRoutes from "../worker/routes/oauth";

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

  async first<T>() {
    return (this.db.query(this.sql).get(...this.values) as T | null) ?? null;
  }
}

class SqliteD1 {
  constructor(private readonly db: Database) {}

  prepare(sql: string) {
    return new SqliteD1Statement(this.db, sql);
  }
}

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
  } as unknown as Env;
}

function basic(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function introspect(
  clientId: string,
  clientSecret: string,
  token = "workbench-token",
) {
  return app.fetch(
    new Request("https://prism.example/oauth/introspect", {
      method: "POST",
      headers: {
        Authorization: basic(clientId, clientSecret),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token }),
    }),
    testEnv(),
    executionCtx,
  );
}

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE oauth_apps (
      client_id TEXT PRIMARY KEY,
      client_secret TEXT NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      token_endpoint_auth_method TEXT
    );

    CREATE TABLE oauth_tokens (
      id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL UNIQUE,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      scopes TEXT NOT NULL,
      resource TEXT,
      dpop_jkt TEXT,
      auth_time INTEGER,
      amr TEXT,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'user',
      is_active INTEGER NOT NULL DEFAULT 1
    );
  `);

  const insertApp = sqlite.prepare(
    "INSERT INTO oauth_apps (client_id, client_secret) VALUES (?, ?)",
  );
  insertApp.run("workbench", "workbench-secret");
  insertApp.run("glint", "glint-secret");
  insertApp.run("unrelated", "unrelated-secret");
  sqlite.run("INSERT INTO users (id) VALUES ('user-id')");

  const now = Math.floor(Date.now() / 1000);
  sqlite.run(
    `INSERT INTO oauth_tokens
       (id, access_token, client_id, user_id, scopes, expires_at, created_at)
     VALUES ('token-id', 'workbench-token', 'workbench', 'user-id', ?, ?, ?)`,
    [JSON.stringify(["openid", "app:glint:workbench"]), now + 3600, now],
  );

  db = new SqliteD1(sqlite) as unknown as D1Database;
  app = new Hono();
  app.route("/oauth", oauthRoutes);
});

afterEach(() => sqlite.close());

describe("OAuth token introspection authorization", () => {
  test("allows the issuing client to introspect its own token", async () => {
    const response = await introspect("workbench", "workbench-secret");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      active: true,
      client_id: "workbench",
      scope: "openid app:glint:workbench",
    });
  });

  test("allows a resource app named by a cross-app scope", async () => {
    const response = await introspect("glint", "glint-secret");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      active: true,
      client_id: "workbench",
      sub: "user-id",
      aud: ["https://prism.example", "glint"],
    });
  });

  test("includes stored resource indicators in the audience", async () => {
    sqlite.run("UPDATE oauth_tokens SET resource = ? WHERE id = 'token-id'", [
      JSON.stringify(["https://api.example/resource"]),
    ]);

    const response = await introspect("glint", "glint-secret");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      active: true,
      aud: ["https://prism.example", "glint", "https://api.example/resource"],
    });
  });

  test("reports tokens for inactive users as inactive", async () => {
    sqlite.run("UPDATE users SET is_active = 0 WHERE id = 'user-id'");

    const response = await introspect("glint", "glint-secret");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ active: false });
  });

  test("still requires the resource app to be confidential", async () => {
    sqlite.run("UPDATE oauth_apps SET is_public = 1 WHERE client_id = 'glint'");

    const response = await introspect("glint", "glint-secret");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_client" });
  });

  test("hides the token from clients not named by its scopes", async () => {
    const response = await introspect("unrelated", "unrelated-secret");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ active: false });
  });

  test("requires an exact, well-formed cross-app scope namespace", async () => {
    sqlite.run("UPDATE oauth_tokens SET scopes = ? WHERE id = 'token-id'", [
      JSON.stringify(["app:glint-other:workbench", "app:glint"]),
    ]);

    const response = await introspect("glint", "glint-secret");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ active: false });
  });
});
