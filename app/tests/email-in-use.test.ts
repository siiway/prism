import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import authRoutes from "../src/worker/routes/auth";
import { emailInUse } from "../src/worker/lib/accountEmails";
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
