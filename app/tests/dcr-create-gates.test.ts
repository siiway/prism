import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import oauthRoutes from "../src/worker/routes/oauth";
import { signJWT } from "../src/worker/lib/jwt";
import { SESSION_COOKIE } from "../src/worker/lib/cookies";
import { d1, executionCtx, MemoryKv, migratedDatabase } from "./setup/d1";

const jwtSecret = "test-jwt-secret-dcr";
let sqlite: Database;
let app: Hono;

beforeEach(() => {
  sqlite = migratedDatabase();
  const now = Math.floor(Date.now() / 1000);
  sqlite.run(
    `INSERT INTO users (id, username, email, created_at, updated_at)
     VALUES ('alice', 'alice', 'alice@example.com', ?, ?)`,
    [now, now],
  );
  sqlite.run(
    "INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES ('s1', 'alice', 'h', ?, ?)",
    [now, now + 3600],
  );
  app = new Hono();
  app.route("/oauth", oauthRoutes);
});

afterEach(() => sqlite.close());

async function register() {
  const jwt = await signJWT(
    {
      sub: "alice",
      role: "user",
      sessionId: "s1",
      email: "alice@example.com",
      username: "alice",
      display_name: "alice",
      avatar_url: null,
    },
    jwtSecret,
    3600,
  );
  return app.fetch(
    new Request("https://prism.example/oauth/register", {
      method: "POST",
      headers: {
        Cookie: `${SESSION_COOKIE}=${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_name: "Tool",
        redirect_uris: ["https://tool.example/cb"],
      }),
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

const apps = () =>
  (sqlite.query("SELECT COUNT(*) AS n FROM oauth_apps").get() as { n: number })
    .n;

describe("dynamic client registration", () => {
  test("creates an app when users may create apps", async () => {
    expect((await register()).status).toBe(201);
    expect(apps()).toBe(1);
  });

  test("respects the switch that turns app creation off", async () => {
    sqlite.run(
      "INSERT INTO site_config (key, value, updated_at) VALUES ('disable_user_create_app', 'true', 0)",
    );
    const res = await register();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "app_creation_disabled" });
    expect(apps()).toBe(0);
  });
});
