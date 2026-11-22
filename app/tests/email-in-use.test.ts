import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import authRoutes from "../src/worker/routes/auth";
import { emailInUse } from "../src/worker/lib/accountEmails";
import { hashPassword } from "../src/worker/lib/crypto";
import { d1, executionCtx, MemoryKv, migratedDatabase } from "./setup/d1";

let sqlite: Database;

beforeEach(() => {
  sqlite = migratedDatabase();
  const now = Math.floor(Date.now() / 1000);
  sqlite.run(
    `INSERT INTO users (id, username, email, created_at, updated_at)
     VALUES ('victim', 'victim', 'victim@example.com', ?, ?)`,
    [now, now],
  );
  sqlite.run(
    `INSERT INTO user_emails (id, user_id, email, verified, created_at)
     VALUES ('e1', 'victim', 'alt@example.com', 1, ?)`,
    [now],
  );
});

afterEach(() => sqlite.close());

describe("email addresses belong to one account", () => {
  test("primary and alternate addresses both count", async () => {
    const db = d1(sqlite);
    expect(await emailInUse(db, "victim@example.com")).toBe(true);
    expect(await emailInUse(db, "alt@example.com")).toBe(true);
    expect(await emailInUse(db, "free@example.com")).toBe(false);
    expect(await emailInUse(db, "alt@example.com", "victim")).toBe(false);
  });

  test("sign-in prefers a verified alternate over an unverified primary", async () => {
    const now = Math.floor(Date.now() / 1000);
    sqlite.run("UPDATE users SET password_hash = ? WHERE id = 'victim'", [
      await hashPassword("victim-password"),
    ]);
    // An account that took the address before sign-up checked alternates.
    sqlite.run(
      `INSERT INTO users (id, username, email, email_verified, password_hash, created_at, updated_at)
       VALUES ('squatter', 'squatter', 'alt@example.com', 0, ?, ?, ?)`,
      [await hashPassword("squatter-password"), now, now],
    );
    const app = new Hono();
    app.route("/api/auth", authRoutes);
    const res = await app.fetch(
      new Request("https://prism.example/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: "alt@example.com",
          password: "victim-password",
        }),
      }),
      {
        DB: d1(sqlite),
        APP_URL: "https://prism.example",
        KV_CACHE: new MemoryKv() as unknown as KVNamespace,
        KV_SESSIONS: new MemoryKv() as unknown as KVNamespace,
      } as unknown as Env,
      executionCtx,
    );
    expect(res.status).toBe(200);
    const session = sqlite.query("SELECT user_id FROM sessions").get() as {
      user_id: string;
    };
    expect(session.user_id).toBe("victim");
  });

  test("sign-up refuses another account's alternate address", async () => {
    const app = new Hono();
    app.route("/api/auth", authRoutes);
    const res = await app.fetch(
      new Request("https://prism.example/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "Alt@Example.com",
          username: "squatter",
          password: "a-long-enough-password",
        }),
      }),
      {
        DB: d1(sqlite),
        APP_URL: "https://prism.example",
        KV_CACHE: new MemoryKv() as unknown as KVNamespace,
        KV_SESSIONS: new MemoryKv() as unknown as KVNamespace,
      } as unknown as Env,
      executionCtx,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "email_or_username_taken",
    });
    const squatter = sqlite
      .query("SELECT id FROM users WHERE username = 'squatter'")
      .get();
    expect(squatter).toBeNull();
  });
});

test("sign-in without an identifier is a field error, not a crash", async () => {
  const app = new Hono();
  app.route("/api/auth", authRoutes);
  const res = await app.fetch(
    new Request("https://prism.example/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "x" }),
    }),
    {
      DB: d1(sqlite),
      APP_URL: "https://prism.example",
      KV_CACHE: new MemoryKv() as unknown as KVNamespace,
      KV_SESSIONS: new MemoryKv() as unknown as KVNamespace,
    } as unknown as Env,
    executionCtx,
  );
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: "fields_required" });
});

test("sign-up refuses an overlong display name", async () => {
  const app = new Hono();
  app.route("/api/auth", authRoutes);
  const res = await app.fetch(
    new Request("https://prism.example/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "new@example.com",
        username: "newbie",
        password: "a-long-enough-password",
        display_name: "x".repeat(65),
      }),
    }),
    {
      DB: d1(sqlite),
      APP_URL: "https://prism.example",
      KV_CACHE: new MemoryKv() as unknown as KVNamespace,
      KV_SESSIONS: new MemoryKv() as unknown as KVNamespace,
    } as unknown as Env,
    executionCtx,
  );
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: "field_length" });
  expect(
    sqlite.query("SELECT id FROM users WHERE username = 'newbie'").get(),
  ).toBeNull();
});
