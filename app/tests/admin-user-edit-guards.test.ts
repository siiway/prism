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

test("an avatar URL that isn't a string is refused, not a crash", async () => {
  for (const value of [5, true, { url: "x" }]) {
    for (const res of await editBothWays("u1", { avatar_url: value })) {
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: "field_invalid",
        params: { field: "avatar_url" },
      });
    }
  }
});

test("an app editing a profile gets the dashboard's avatar check", async () => {
  const now = Math.floor(Date.now() / 1000);
  sqlite.run(
    `INSERT INTO oauth_tokens (id, access_token, client_id, user_id, scopes, expires_at, created_at)
     VALUES ('t2', 'ptok', 'tool', 'u1', '["profile:write"]', ?, ?)`,
    [now + 600, now],
  );
  const app = new Hono();
  app.route("/api/oauth", meRoutes);
  for (const avatar_url of [5, "http://tracker.example/x"]) {
    const res = await app.fetch(
      new Request("https://prism.example/api/oauth/me/profile", {
        method: "PATCH",
        headers: {
          Authorization: "Bearer ptok",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ avatar_url }),
      }),
      env(),
      executionCtx,
    );
    expect(res.status).toBe(400);
  }
  expect(
    sqlite.query("SELECT avatar_url FROM users WHERE id = 'u1'").get(),
  ).toEqual({ avatar_url: null });
});

test("a new address marked verified records the admin's word, not the old proof", async () => {
  sqlite.run(
    "UPDATE users SET email_verified = 1, email_verified_via = 'social:github', email_verified_at = 5 WHERE id = 'u1'",
  );
  const [dashboard] = await editBothWays("u1", {
    email: "new@example.com",
    email_verified: true,
  });
  expect(dashboard.status).toBe(200);
  const row = sqlite
    .query(
      "SELECT email, email_verified, email_verified_via, email_verified_at FROM users WHERE id = 'u1'",
    )
    .get() as {
    email: string;
    email_verified: number;
    email_verified_via: string;
    email_verified_at: number;
  };
  expect(row).toMatchObject({
    email: "new@example.com",
    email_verified: 1,
    email_verified_via: "admin",
  });
  expect(row.email_verified_at).toBeGreaterThan(5);
});

test("marking an address verified records the admin's word, unless another account owns it", async () => {
  const row = () =>
    sqlite
      .query(
        "SELECT email_verified, email_verified_via, email_verified_at FROM users WHERE id = 'u1'",
      )
      .get() as {
      email_verified: number;
      email_verified_via: string | null;
      email_verified_at: number | null;
    };
  sqlite.run(
    "INSERT INTO user_emails (id, user_id, email, verified, created_at) VALUES ('e1', 'admin', 'u1@example.com', 1, 0)",
  );
  const [taken] = await editBothWays("u1", { email_verified: true });
  expect(taken.status).toBe(409);
  expect(await taken.json()).toMatchObject({ error: "email_taken" });
  expect(row().email_verified).toBe(0);

  sqlite.run("DELETE FROM user_emails WHERE id = 'e1'");
  const [ok] = await editBothWays("u1", { email_verified: true });
  expect(ok.status).toBe(200);
  expect(row()).toMatchObject({
    email_verified: 1,
    email_verified_via: "admin",
  });
  expect(row().email_verified_at).toBeGreaterThan(0);

  await editBothWays("u1", { email_verified: false });
  expect(row()).toEqual({
    email_verified: 0,
    email_verified_via: null,
    email_verified_at: null,
  });
});
