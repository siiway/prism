import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import appsRoutes from "../src/worker/routes/apps";
import oauthRoutes from "../src/worker/routes/oauth";
import { signJWT } from "../src/worker/lib/jwt";
import { SESSION_COOKIE } from "../src/worker/lib/cookies";
import { d1, executionCtx, MemoryKv, migratedDatabase } from "./setup/d1";

const jwtSecret = "test-jwt-secret-owner-rules";
let sqlite: Database;
let app: Hono;

beforeEach(() => {
  sqlite = migratedDatabase();
  const now = Math.floor(Date.now() / 1000);
  sqlite.run(
    `INSERT INTO users (id, username, email, created_at, updated_at) VALUES
       ('owner', 'owner', 'owner@example.com', ?, ?),
       ('mallory', 'mallory', 'mallory@example.com', ?, ?)`,
    [now, now, now, now],
  );
  sqlite.run(
    "INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES ('s1', 'mallory', 'h', ?, ?)",
    [now, now + 3600],
  );
  sqlite.run(
    `INSERT INTO oauth_apps (id, client_id, client_secret, name, owner_id, redirect_uris, allowed_scopes, created_at, updated_at)
     VALUES ('target', 'target_client', 'x', 'Target', 'owner', '["https://t.example/cb"]', '["openid"]', ?, ?)`,
    [now, now],
  );
  sqlite.run(
    `INSERT INTO app_scope_access_rules (id, app_id, rule_type, target_id, created_at)
     VALUES ('r1', 'target', 'owner_deny', 'mallory', ?)`,
    [now],
  );
  app = new Hono();
  app.route("/api/apps", appsRoutes);
  app.route("/oauth", oauthRoutes);
});

afterEach(() => sqlite.close());

async function post(path: string, body: unknown) {
  const jwt = await signJWT(
    {
      sub: "mallory",
      role: "user",
      sessionId: "s1",
      email: "mallory@example.com",
      username: "mallory",
      display_name: "mallory",
      avatar_url: null,
    },
    jwtSecret,
    3600,
  );
  return app.fetch(
    new Request(`https://prism.example${path}`, {
      method: "POST",
      headers: {
        Cookie: `${SESSION_COOKIE}=${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    {
      DB: d1(sqlite),
      APP_URL: "https://prism.example",
      KV_CACHE: new MemoryKv() as unknown as KVNamespace,
      KV_SESSIONS: new MemoryKv({
        "system:jwt_secret": jwtSecret,
      }) as unknown as KVNamespace,
    } as unknown as Env,
    executionCtx,
  );
}

const appCount = () =>
  (sqlite.query("SELECT COUNT(*) AS n FROM oauth_apps").get() as { n: number })
    .n;

describe("owner rules on another app's scopes", () => {
  test("hold when creating an app", async () => {
    const res = await post("/api/apps", {
      name: "Mine",
      redirect_uris: [{ type: "equals", value: "https://m.example/cb" }],
      allowed_scopes: ["openid", "app:target_client:read"],
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "app_scope_denied" });
    expect(appCount()).toBe(1);
  });

  test("hold for client registration", async () => {
    const res = await post("/oauth/register", {
      client_name: "Mine",
      redirect_uris: ["https://m.example/cb"],
      scope: "openid app:target_client:read",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "invalid_client_metadata",
      error_description: "app_scope_denied",
    });
    expect(appCount()).toBe(1);
  });
});
