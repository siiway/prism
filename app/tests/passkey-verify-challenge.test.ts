import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import authRoutes from "../src/worker/routes/auth";
import { signJWT } from "../src/worker/lib/jwt";
import { SESSION_COOKIE } from "../src/worker/lib/cookies";
import { d1, executionCtx, MemoryKv, migratedDatabase } from "./setup/d1";

const jwtSecret = "test-jwt-secret-passkey-verify";
const challengeKey = "passkey:verify:chal:alice";
let sqlite: Database;
let cache: MemoryKv;

beforeEach(() => {
  sqlite = migratedDatabase();
  sqlite.exec(`
    INSERT INTO users (id, username, email, created_at, updated_at)
      VALUES ('alice', 'alice', 'alice@example.com', 0, 0);
    INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
      VALUES ('s1', 'alice', 'h', 9999999999, 0);
  `);
  cache = new MemoryKv({
    [challengeKey]: JSON.stringify({ challenge: "chal" }),
  });
});

afterEach(() => sqlite.close());

describe("re-verifying with a passkey", () => {
  test("a failed attempt uses up the challenge", async () => {
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
    app.route("/api/auth", authRoutes);
    const res = await app.fetch(
      new Request("https://prism.example/api/auth/passkey/verify/finish", {
        method: "POST",
        headers: {
          Cookie: `${SESSION_COOKIE}=${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          challenge: "chal",
          response: { id: "unknown" },
        }),
      }),
      {
        DB: d1(sqlite),
        APP_URL: "https://prism.example",
        KV_CACHE: cache as unknown as KVNamespace,
        KV_SESSIONS: new MemoryKv({
          "system:jwt_secret": jwtSecret,
        }) as unknown as KVNamespace,
      } as unknown as Env,
      executionCtx,
    );
    expect(res.status).toBe(400);
    expect(await cache.get(challengeKey)).toBeNull();
  });
});
