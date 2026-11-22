import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import userRoutes from "../src/worker/routes/user";
import { signJWT } from "../src/worker/lib/jwt";
import { SESSION_COOKIE } from "../src/worker/lib/cookies";
import { d1, executionCtx, MemoryKv, migratedDatabase } from "./setup/d1";

const jwtSecret = "test-jwt-secret-pat";
let sqlite: Database;

beforeEach(() => {
  sqlite = migratedDatabase();
  sqlite.exec(`
    INSERT INTO users (id, username, email, created_at, updated_at)
      VALUES ('alice', 'alice', 'alice@example.com', 0, 0);
    INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
      VALUES ('s1', 'alice', 'h', 9999999999, 0);
  `);
});

afterEach(() => sqlite.close());

async function create(extra: Record<string, unknown>) {
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
  app.route("/api/user", userRoutes);
  return app.fetch(
    new Request("https://prism.example/api/user/tokens", {
      method: "POST",
      headers: {
        Cookie: `${SESSION_COOKIE}=${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "ci", scopes: ["profile"], ...extra }),
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
}

describe("personal access token expiry", () => {
  test("takes a whole number of days, or none", async () => {
    for (const bad of [0, -1, 1.5, "30", 99999]) {
      const res = await create({ expires_in_days: bad });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "field_int_range" });
    }
    expect((await create({ expires_in_days: 30 })).status).toBeLessThan(300);
    expect((await create({})).status).toBeLessThan(300);
    const rows = sqlite
      .query(
        "SELECT expires_at FROM personal_access_tokens ORDER BY created_at",
      )
      .all() as { expires_at: number | null }[];
    expect(rows.map((r) => r.expires_at === null).sort()).toEqual([
      false,
      true,
    ]);
  });
});
