import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import oauthRoutes from "../src/worker/routes/oauth";
import { signJWT } from "../src/worker/lib/jwt";
import { SESSION_COOKIE } from "../src/worker/lib/cookies";
import { d1, executionCtx, MemoryKv, migratedDatabase } from "./setup/d1";

const jwtSecret = "test-jwt-secret-learn-mode";
let sqlite: Database;
let app: Hono;

function testEnv(): Env {
  return {
    DB: d1(sqlite),
    APP_URL: "https://prism.example",
    KV_CACHE: new MemoryKv() as unknown as KVNamespace,
    KV_SESSIONS: new MemoryKv({
      "system:jwt_secret": jwtSecret,
    }) as unknown as KVNamespace,
  } as unknown as Env;
}

async function sessionCookie(userId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  sqlite.run(
    "INSERT OR IGNORE INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    [`s_${userId}`, userId, `hash-${userId}`, now, now + 3600],
  );
  const jwt = await signJWT(
    {
      sub: userId,
      role: "user",
      sessionId: `s_${userId}`,
      email: `${userId}@example.com`,
      username: userId,
      display_name: userId,
      avatar_url: null,
    },
    jwtSecret,
    3600,
  );
  return `${SESSION_COOKIE}=${jwt}`;
}

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
    `INSERT INTO oauth_apps (id, client_id, client_secret, name, owner_id, redirect_uris, allowed_scopes, created_at, updated_at)
     VALUES ('app_1', 'client_1', 'x', 'New App', 'owner', '[]', '["openid"]', ?, ?)`,
    [now, now],
  );
  app = new Hono();
  app.route("/oauth", oauthRoutes);
});

afterEach(() => sqlite.close());

async function authorize(userId: string, action: "approve" | "deny") {
  return app.fetch(
    new Request("https://prism.example/oauth/authorize", {
      method: "POST",
      headers: {
        Cookie: await sessionCookie(userId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: "client_1",
        redirect_uri: "https://evil.example/cb",
        scope: "openid",
        action,
      }),
    }),
    testEnv(),
    executionCtx,
  );
}

function registered(): string {
  return (
    sqlite
      .query("SELECT redirect_uris FROM oauth_apps WHERE id = 'app_1'")
      .get() as { redirect_uris: string }
  ).redirect_uris;
}

describe("an app with no redirect URIs", () => {
  test("can't be taught one by someone who doesn't manage it", async () => {
    const approve = await authorize("mallory", "approve");
    expect(approve.status).toBe(400);
    expect(await approve.json()).toMatchObject({
      error: "invalid_redirect_uri",
    });
    const deny = await authorize("mallory", "deny");
    expect(deny.status).toBe(400);
    await Bun.sleep(10);
    expect(registered()).toBe("[]");
  });

  test("learns the first URI its owner approves", async () => {
    const res = await authorize("owner", "approve");
    expect(res.status).toBe(200);
    await Bun.sleep(10);
    expect(JSON.parse(registered())).toEqual([
      { type: "equals", value: "https://evil.example/cb" },
    ]);
  });
});
