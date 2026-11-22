import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import meRoutes from "../src/worker/routes/oauth-me";
import { d1, executionCtx, MemoryKv, migratedDatabase } from "./setup/d1";

let sqlite: Database;

beforeEach(() => {
  sqlite = migratedDatabase();
  const now = Math.floor(Date.now() / 1000);
  sqlite.run(
    "INSERT INTO users (id, username, email, created_at, updated_at) VALUES ('u', 'u', 'u@example.com', ?, ?)",
    [now, now],
  );
  sqlite.run(
    `INSERT INTO oauth_tokens (id, access_token, client_id, user_id, scopes, expires_at, created_at)
     VALUES ('t1', 'tok', 'client', 'u', '["apps:write"]', ?, ?)`,
    [now + 600, now],
  );
  sqlite.run(
    "INSERT INTO site_config (key, value, updated_at) VALUES ('disable_user_create_app', 'true', 0)",
  );
});

afterEach(() => sqlite.close());

describe("creating an app with an apps:write token", () => {
  test("respects the switch that turns app creation off", async () => {
    const app = new Hono();
    app.route("/api/oauth", meRoutes);
    const res = await app.fetch(
      new Request("https://prism.example/api/oauth/me/apps", {
        method: "POST",
        headers: {
          Authorization: "Bearer tok",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Tool",
          redirect_uris: ["https://tool.example/cb"],
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
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "app_creation_disabled" });
  });
});
