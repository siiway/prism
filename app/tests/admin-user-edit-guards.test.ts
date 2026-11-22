import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import adminRoutes from "../src/worker/routes/admin";
import meRoutes from "../src/worker/routes/oauth-me";
import { signJWT } from "../src/worker/lib/jwt";
import { SESSION_COOKIE } from "../src/worker/lib/cookies";
import { d1, executionCtx, MemoryKv, migratedDatabase } from "./setup/d1";

const jwtSecret = "test-jwt-secret-user-edit-guards";
let sqlite: Database;

beforeEach(() => {
  sqlite = migratedDatabase();
  const now = Math.floor(Date.now() / 1000);
  sqlite.run(
    `INSERT INTO users (id, username, email, role, created_at, updated_at) VALUES
       ('admin', 'admin', 'admin@example.com', 'admin', ?, ?),
       ('u1', 'u1', 'u1@example.com', 'user', ?, ?)`,
    [now, now, now, now],
  );
  sqlite.run(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES ('s1', 'admin', 'h', 9999999999, 0)",
  );
  sqlite.run(
    `INSERT INTO oauth_tokens (id, access_token, client_id, user_id, scopes, expires_at, created_at)
     VALUES ('t1', 'tok', 'tool', 'admin', '["admin:users:write"]', ?, ?)`,
    [now + 600, now],
  );
});

afterEach(() => sqlite.close());

const env = () =>
  ({
    DB: d1(sqlite),
    APP_URL: "https://prism.example",
    KV_CACHE: new MemoryKv(),
    KV_SESSIONS: new MemoryKv({ "system:jwt_secret": jwtSecret }),
  }) as unknown as Env;

/** PATCH a user through the dashboard and through an app's token. */
async function editBothWays(id: string, body: unknown): Promise<Response[]> {
  const jwt = await signJWT(
    {
      sub: "admin",
      role: "admin",
      sessionId: "s1",
      email: "admin@example.com",
      username: "admin",
      display_name: "admin",
      avatar_url: null,
    },
    jwtSecret,
    3600,
  );
  const app = new Hono();
  app.route("/api/admin", adminRoutes);
  app.route("/api/oauth", meRoutes);
  const send = (path: string, auth: Record<string, string>) =>
    app.fetch(
      new Request(`https://prism.example${path}`, {
        method: "PATCH",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      env(),
      executionCtx,
    );
  return [
    await send(`/api/admin/users/${id}`, {
      Cookie: `${SESSION_COOKIE}=${jwt}`,
    }),
    await send(`/api/oauth/me/admin/users/${id}`, {
      Authorization: "Bearer tok",
    }),
  ];
}

const isActive = () =>
  (
    sqlite.query("SELECT is_active FROM users WHERE id = 'admin'").get() as {
      is_active: number;
    }
  ).is_active;

test("an admin can't disable their own account with any falsy value", async () => {
  for (const value of [false, 0, "", null]) {
    for (const res of await editBothWays("admin", { is_active: value })) {
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: "cannot_disable_self" });
    }
  }
  expect(isActive()).toBe(1);
});
