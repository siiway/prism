import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import connections from "../src/worker/routes/connections";
import { d1, executionCtx, MemoryKv, migratedDatabase } from "./setup/d1";

let sqlite: Database;
let cache: MemoryKv;
let app: Hono;

beforeEach(() => {
  sqlite = migratedDatabase();
  const now = Math.floor(Date.now() / 1000);
  sqlite.run(
    `INSERT INTO users (id, username, email, created_at, updated_at)
     VALUES ('alice', 'alice', 'alice@example.com', ?, ?)`,
    [now, now],
  );
  cache = new MemoryKv({
    "social:2fa:k": JSON.stringify({
      userId: "alice",
      slug: "github",
      providerName: "GitHub",
    }),
  });
  app = new Hono();
  app.route("/api/connections", connections);
});

afterEach(() => sqlite.close());

function verify(code: string) {
  return app.fetch(
    new Request("https://prism.example/api/connections/2fa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "social:2fa:k", totp_code: code }),
    }),
    {
      DB: d1(sqlite),
      APP_URL: "https://prism.example",
      KV_CACHE: cache as unknown as KVNamespace,
      KV_SESSIONS: new MemoryKv() as unknown as KVNamespace,
    } as unknown as Env,
    executionCtx,
  );
}

describe("TOTP after social sign-in", () => {
  test("stops taking codes after the per-account limit", async () => {
    // The default limit is 15 codes per 5 minutes.
    for (let i = 0; i < 15; i++)
      expect((await verify("000000")).status).toBe(401);
    const res = await verify("000000");
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "too_many_requests" });
  });
});
