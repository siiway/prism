import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import connections from "../src/worker/routes/connections";
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
