import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import meRoutes from "../src/worker/routes/oauth-me";
import userRoutes from "../src/worker/routes/user";
import { signJWT } from "../src/worker/lib/jwt";
import { SESSION_COOKIE } from "../src/worker/lib/cookies";
import { d1, executionCtx, MemoryKv, migratedDatabase } from "./setup/d1";

const jwtSecret = "test-jwt-secret-display-name";
let sqlite: Database;

function env(): Env {
  return {
    DB: d1(sqlite),
    APP_URL: "https://prism.example",
    KV_CACHE: new MemoryKv() as unknown as KVNamespace,
    KV_SESSIONS: new MemoryKv({
      "system:jwt_secret": jwtSecret,
    }) as unknown as KVNamespace,
  } as unknown as Env;
}

beforeEach(() => {
  sqlite = migratedDatabase();
  const now = Math.floor(Date.now() / 1000);
  sqlite.exec(`
    INSERT INTO users (id, username, email, display_name, created_at, updated_at)
      VALUES ('u', 'u', 'u@example.com', 'Old', 0, 0);
    INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
      VALUES ('s1', 'u', 'h', 9999999999, 0);
  `);
  sqlite.run(
    `INSERT INTO oauth_tokens (id, access_token, client_id, user_id, scopes, expires_at, created_at)
     VALUES ('t1', 'tok', 'tool', 'u', '["profile:write"]', ?, ?)`,
    [now + 600, now],
  );
});

afterEach(() => sqlite.close());

describe("display names", () => {
  test("a non-text name through the token API is a field error", async () => {
    const app = new Hono();
    app.route("/api/oauth", meRoutes);
    const res = await app.fetch(
      new Request("https://prism.example/api/oauth/me/profile", {
        method: "PATCH",
        headers: {
          Authorization: "Bearer tok",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ display_name: 123 }),
      }),
      env(),
      executionCtx,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "field_length" });
  });

  test("a blank name on the profile page is refused, and others are trimmed", async () => {
    const jwt = await signJWT(
      {
        sub: "u",
        role: "user",
        sessionId: "s1",
        email: "u@example.com",
        username: "u",
        display_name: "Old",
        avatar_url: null,
      },
      jwtSecret,
      3600,
    );
    const app = new Hono();
    app.route("/api/user", userRoutes);
    const patch = (display_name: string) =>
      app.fetch(
        new Request("https://prism.example/api/user/me", {
          method: "PATCH",
          headers: {
            Cookie: `${SESSION_COOKIE}=${jwt}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ display_name }),
        }),
        env(),
        executionCtx,
      );
    expect((await patch("   ")).status).toBe(400);
    expect((await patch("  New  ")).status).toBeLessThan(300);
    expect(
      (
        sqlite.query("SELECT display_name FROM users WHERE id = 'u'").get() as {
          display_name: string;
        }
      ).display_name,
    ).toBe("New");
  });
});
