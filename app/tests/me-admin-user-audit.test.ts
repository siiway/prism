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
    `INSERT INTO users (id, username, email, role, created_at, updated_at) VALUES
       ('admin', 'admin', 'admin@example.com', 'admin', ?, ?),
       ('u1', 'u1', 'u1@example.com', 'user', ?, ?)`,
    [now, now, now, now],
  );
  sqlite.run(
    `INSERT INTO oauth_tokens (id, access_token, client_id, user_id, scopes, expires_at, created_at)
     VALUES ('t1', 'tok', 'tool', 'admin', '["admin:users:write"]', ?, ?)`,
    [now + 600, now],
  );
});

afterEach(() => sqlite.close());

describe("a user change made with an app token", () => {
  test("is logged with what changed, not the raw request", async () => {
    const app = new Hono();
    app.route("/api/oauth", meRoutes);
    const res = await app.fetch(
      new Request("https://prism.example/api/oauth/me/admin/users/u1", {
        method: "PATCH",
        headers: {
          Authorization: "Bearer tok",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          role: "owner",
          display_name: "  New Name ",
          note: "x",
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
    await Bun.sleep(10);
    const row = sqlite
      .query(
        "SELECT metadata FROM audit_events WHERE action = 'admin.user.update'",
      )
      .get() as { metadata: string };
    const meta = JSON.parse(row.metadata);
    expect(meta.display_name).toBe("New Name");
    expect(meta).not.toHaveProperty("role");
    expect(meta).not.toHaveProperty("note");
  });
});
