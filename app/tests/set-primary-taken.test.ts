import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import adminRoutes from "../src/worker/routes/admin";
import userRoutes from "../src/worker/routes/user";
import { signJWT } from "../src/worker/lib/jwt";
import { SESSION_COOKIE } from "../src/worker/lib/cookies";
import { d1, executionCtx, MemoryKv, migratedDatabase } from "./setup/d1";

const jwtSecret = "test-jwt-secret-set-primary";
let sqlite: Database;

beforeEach(() => {
  sqlite = migratedDatabase();
  // The victim verified mine@example.com as an alternate; someone else had
  // signed up with it and never confirmed it, so it's still their primary.
  sqlite.exec(`
    INSERT INTO users (id, username, email, role, email_verified, created_at, updated_at) VALUES
      ('admin', 'admin', 'admin@example.com', 'admin', 1, 0, 0),
      ('victim', 'victim', 'victim@example.com', 'user', 1, 0, 0),
      ('squatter', 'squatter', 'mine@example.com', 'user', 0, 0, 0);
    INSERT INTO user_emails (id, user_id, email, verified, created_at)
      VALUES ('e1', 'victim', 'mine@example.com', 1, 0);
    INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES
      ('s1', 'admin', 'h1', 9999999999, 0),
      ('s2', 'victim', 'h2', 9999999999, 0);
  `);
});

afterEach(() => sqlite.close());

async function post(
  path: string,
  sub: string,
  sessionId: string,
  body?: unknown,
) {
  const jwt = await signJWT(
    {
      sub,
      role: sub === "admin" ? "admin" : "user",
      sessionId,
      email: `${sub}@example.com`,
      username: sub,
      display_name: sub,
      avatar_url: null,
    },
    jwtSecret,
    3600,
  );
  const app = new Hono();
  app.route("/api/admin", adminRoutes);
  app.route("/api/user", userRoutes);
  return app.fetch(
    new Request(`https://prism.example${path}`, {
      method: "POST",
      headers: {
        Cookie: `${SESSION_COOKIE}=${jwt}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    {
      DB: d1(sqlite),
      APP_URL: "https://prism.example",
      KV_CACHE: new MemoryKv(),
      KV_SESSIONS: new MemoryKv({ "system:jwt_secret": jwtSecret }),
    } as unknown as Env,
    executionCtx,
  );
}

test("making an address primary while another account has it is refused, not a crash", async () => {
  for (const res of [
    await post("/api/admin/users/victim/emails/e1/set-primary", "admin", "s1"),
    await post("/api/user/me/emails/e1/set-primary", "victim", "s2"),
  ]) {
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "email_taken" });
  }
  expect(
    sqlite.query("SELECT email FROM users WHERE id = 'victim'").get(),
  ).toEqual({ email: "victim@example.com" });
});

test("someone else's claim on the old primary doesn't block a switch", async () => {
  // The victim's primary is unverified, and another account added it as an
  // alternate without verifying it either.
  sqlite.exec(`
    UPDATE users SET email_verified = 0 WHERE id = 'victim';
    INSERT INTO user_emails (id, user_id, email, verified, created_at) VALUES
      ('n1', 'victim', 'new@example.com', 1, 0),
      ('c1', 'squatter', 'victim@example.com', 0, 0);
  `);
  const res = await post("/api/user/me/emails/n1/set-primary", "victim", "s2");
  expect(res.status).toBe(200);
  expect(
    sqlite.query("SELECT email FROM users WHERE id = 'victim'").get(),
  ).toEqual({ email: "new@example.com" });
  // Neither proved the old address; the other claim stays, the old primary goes.
  expect(
    sqlite
      .query(
        "SELECT user_id FROM user_emails WHERE email = 'victim@example.com'",
      )
      .all(),
  ).toEqual([{ user_id: "squatter" }]);
});

test("a verified old primary outranks an unproved claim on it", async () => {
  sqlite.exec(`
    INSERT INTO user_emails (id, user_id, email, verified, created_at) VALUES
      ('n1', 'victim', 'new@example.com', 1, 0),
      ('c1', 'squatter', 'victim@example.com', 0, 0);
  `);
  const res = await post(
    "/api/admin/users/victim/emails/n1/set-primary",
    "admin",
    "s1",
  );
  expect(res.status).toBe(200);
  expect(
    sqlite
      .query(
        "SELECT user_id, verified FROM user_emails WHERE email = 'victim@example.com'",
      )
      .all(),
  ).toEqual([{ user_id: "victim", verified: 1 }]);
});

test("the current primary can't be added as an alternate after a switch", async () => {
  // The primary changed after sign-in, so the session still names the old one.
  sqlite.exec("UPDATE users SET email = 'new@example.com' WHERE id = 'victim'");
  const res = await post("/api/user/me/emails", "victim", "s2", {
    email: "new@example.com",
  });
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: "email_taken" });
});
