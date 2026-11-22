import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import connections, {
  trySocialEmailVerify,
} from "../src/worker/routes/connections";
import { d1, executionCtx, MemoryKv, migratedDatabase } from "./setup/d1";

const resetRequest = JSON.stringify({ requested_at: 0, requested_by: "admin" });
let sqlite: Database;
let cache: MemoryKv;
let app: Hono;

beforeEach(() => {
  sqlite = migratedDatabase();
  cache = new MemoryKv({ "admin:reset-request": resetRequest });
  app = new Hono();
  app.route("/api/connections", connections);
});

afterEach(() => sqlite.close());

function send(path: string, init?: RequestInit) {
  return app.fetch(
    new Request(`https://prism.example/api/connections${path}`, init),
    {
      DB: d1(sqlite),
      APP_URL: "https://prism.example",
      KV_CACHE: cache as unknown as KVNamespace,
      KV_SESSIONS: new MemoryKv() as unknown as KVNamespace,
    } as unknown as Env,
    executionCtx,
  );
}

describe("pending social sign-in routes", () => {
  test("won't read another cache entry", async () => {
    const res = await send("/pending/admin:reset-request");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "session_invalid" });
  });

  test("won't use up another cache entry", async () => {
    const res = await send("/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "admin:reset-request", action: "login" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "session_invalid" });
    expect(await cache.get("admin:reset-request")).toBe(resetRequest);
  });
});

test("a sign-up with a fixable mistake keeps the pending sign-in", async () => {
  sqlite.run(
    "INSERT INTO users (id, username, email, created_at, updated_at) VALUES ('t', 'taken', 't@example.com', 0, 0)",
  );
  const pending = JSON.stringify({
    type: "register",
    provider: "github",
    providerUserId: "1",
    providerEmail: null,
    profileData: {},
    accessToken: "a",
    refreshToken: null,
    tokenExpiresAt: null,
  });
  await cache.put("social:pending:k", pending);
  const res = await send("/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key: "social:pending:k",
      action: "register",
      username: "taken",
    }),
  });
  expect(res.status).toBe(409);
  expect(await cache.get("social:pending:k")).toBe(pending);
});

test("losing a race for the username keeps the pending sign-in", async () => {
  // Free when checked, taken by the time of the insert.
  sqlite.run(`CREATE TRIGGER raced BEFORE INSERT ON users WHEN NEW.username = 'raced'
    BEGIN SELECT RAISE(ABORT, 'UNIQUE constraint failed: users.username'); END`);
  const pending = JSON.stringify({
    type: "register",
    provider: "github",
    providerUserId: "1",
    providerEmail: null,
    profileData: {},
    accessToken: "a",
    refreshToken: null,
    tokenExpiresAt: null,
  });
  await cache.put("social:pending:k", pending);
  const res = await send("/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key: "social:pending:k",
      action: "register",
      username: "raced",
    }),
  });
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: "email_or_username_taken" });
  expect(await cache.get("social:pending:k")).toBe(pending);
});

test("losing a race for the address leaves it unverified instead of failing the sign-in", async () => {
  sqlite.run(
    "INSERT INTO users (id, username, email, created_at, updated_at) VALUES ('u', 'u', 'u@example.com', 0, 0)",
  );
  // Free when checked, owned elsewhere by the time of the write.
  sqlite.run(`CREATE TRIGGER raced BEFORE UPDATE OF email_verified ON users
    WHEN NEW.id = 'u'
    BEGIN SELECT RAISE(ABORT, 'UNIQUE constraint failed: email belongs to another account'); END`);
  await trySocialEmailVerify(
    d1(sqlite),
    "u",
    "u@example.com",
    0,
    "u@example.com",
    "github",
  );
  expect(
    sqlite.query("SELECT email_verified FROM users WHERE id = 'u'").get(),
  ).toEqual({ email_verified: 0 });
});
