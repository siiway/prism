import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import oauthRoutes from "../src/worker/routes/oauth";
import { signJWT } from "../src/worker/lib/jwt";
import { SESSION_COOKIE } from "../src/worker/lib/cookies";
import { d1, executionCtx, MemoryKv, migratedDatabase } from "./setup/d1";

const jwtSecret = "test-jwt-secret-revoke";
let sqlite: Database;

beforeEach(() => {
  sqlite = migratedDatabase();
  sqlite.exec(`
    INSERT INTO users (id, username, email, created_at, updated_at)
      VALUES ('alice', 'alice', 'alice@example.com', 0, 0);
    INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
      VALUES ('s1', 'alice', 'h', 9999999999, 0);
    INSERT INTO oauth_consents (id, user_id, client_id, scopes, granted_at)
      VALUES ('c1', 'alice', 'client', '["openid"]', 0);
    INSERT INTO oauth_codes (code, client_id, user_id, redirect_uri, expires_at, created_at)
      VALUES ('code-1', 'client', 'alice', 'https://app.example/cb', 9999999999, 0);
    INSERT INTO oauth_device_codes (device_code, user_code, client_id, status, user_id, expires_at, created_at)
      VALUES ('dev-1', 'AAAA', 'client', 'approved', 'alice', 9999999999, 0);
  `);
});

afterEach(() => sqlite.close());

describe("revoking an app's access", () => {
  test("also drops the codes it hasn't redeemed", async () => {
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
    const app = new Hono();
    app.route("/oauth", oauthRoutes);
    const res = await app.fetch(
      new Request("https://prism.example/oauth/consents/client", {
        method: "DELETE",
        headers: { Cookie: `${SESSION_COOKIE}=${jwt}` },
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
    const count = (table: string) =>
      (
        sqlite.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
          n: number;
        }
      ).n;
    expect(count("oauth_codes")).toBe(0);
    expect(count("oauth_device_codes")).toBe(0);
  });
});
