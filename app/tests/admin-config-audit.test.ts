import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import adminRoutes from "../src/worker/routes/admin";
import { signJWT } from "../src/worker/lib/jwt";
import { SESSION_COOKIE } from "../src/worker/lib/cookies";
import { d1, executionCtx, MemoryKv, migratedDatabase } from "./setup/d1";

const jwtSecret = "test-jwt-secret-config-audit";
let sqlite: Database;

beforeEach(() => {
  sqlite = migratedDatabase();
  sqlite.exec(`
    INSERT INTO users (id, username, email, role, created_at, updated_at)
      VALUES ('admin', 'admin', 'admin@example.com', 'admin', 0, 0);
    INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
      VALUES ('s1', 'admin', 'h', 9999999999, 0);
  `);
});

afterEach(() => sqlite.close());

describe("saving the site config", () => {
  test("keeps secret values out of the audit log", async () => {
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
    const res = await app.fetch(
      new Request("https://prism.example/api/admin/config", {
        method: "PATCH",
        headers: {
          Cookie: `${SESSION_COOKIE}=${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          site_name: "Renamed",
          smtp_password: "hunter2",
          imap_password: "",
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
    expect(res.status).toBe(200);
    await Bun.sleep(10);
    const row = sqlite
      .query(
        "SELECT metadata FROM audit_events WHERE action = 'admin.config.update'",
      )
      .get() as { metadata: string };
    expect(row.metadata).not.toContain("hunter2");
    expect(JSON.parse(row.metadata)).toMatchObject({
      site_name: "Renamed",
      smtp_password: "***",
      imap_password: "",
    });
  });

  test("making a user's alternate email their primary drops the alternate", async () => {
    sqlite.exec(`
      INSERT INTO users (id, username, email, created_at, updated_at)
        VALUES ('u', 'u', 'a@example.com', 0, 0);
      INSERT INTO user_emails (id, user_id, email, verified, verified_via, verified_at, created_at)
        VALUES ('e1', 'u', 'b@example.com', 1, 'link', 123, 0);
    `);
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
    const res = await app.fetch(
      new Request("https://prism.example/api/admin/users/u", {
        method: "PATCH",
        headers: {
          Cookie: `${SESSION_COOKIE}=${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: "b@example.com" }),
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
    expect(res.status).toBe(200);
    expect(
      (
        sqlite.query("SELECT email FROM users WHERE id = 'u'").get() as {
          email: string;
        }
      ).email,
    ).toBe("b@example.com");
    expect(
      sqlite.query("SELECT id FROM user_emails WHERE user_id = 'u'").get(),
    ).toBeNull();
    expect(
      sqlite
        .query(
          "SELECT email_verified, email_verified_via, email_verified_at FROM users WHERE id = 'u'",
        )
        .get(),
    ).toEqual({
      email_verified: 1,
      email_verified_via: "link",
      email_verified_at: 123,
    });
  });
});
