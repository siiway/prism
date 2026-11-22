import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import meRoutes from "../src/worker/routes/oauth-me";
import { d1, executionCtx, MemoryKv, migratedDatabase } from "./setup/d1";

let sqlite: Database;
let app: Hono;

beforeEach(() => {
  sqlite = migratedDatabase();
  const now = Math.floor(Date.now() / 1000);
  sqlite.run(
    "INSERT INTO users (id, username, email, role, created_at, updated_at) VALUES ('admin', 'admin', 'admin@example.com', 'admin', ?, ?)",
    [now, now],
  );
  sqlite.run(
    `INSERT INTO oauth_tokens (id, access_token, client_id, user_id, scopes, expires_at, created_at)
     VALUES ('t1', 'tok', 'tool', 'admin', '["admin:invites:create","admin:invites:delete"]', ?, ?)`,
    [now + 600, now],
  );
  app = new Hono();
  app.route("/api/oauth", meRoutes);
});

afterEach(() => sqlite.close());

function call(method: string, path: string, body?: unknown) {
  return app.fetch(
    new Request(`https://prism.example/api/oauth${path}`, {
      method,
      headers: {
        Authorization: "Bearer tok",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    {
      DB: d1(sqlite),
      APP_URL: "https://prism.example",
      KV_CACHE: new MemoryKv() as unknown as KVNamespace,
      KV_SESSIONS: new MemoryKv() as unknown as KVNamespace,
    } as unknown as Env,
    executionCtx,
  );
}

describe("invites changed with an app token", () => {
  test("are recorded in the audit log", async () => {
    const created = await call("POST", "/me/invites", {
      email: "New@Example.com",
    });
    expect(created.status).toBe(201);
    const { id } = await created.json<{ id: string }>();
    expect((await call("DELETE", `/me/invites/${id}`)).status).toBe(200);
    await Bun.sleep(10);
    const rows = sqlite
      .query(
        "SELECT action, actor_id, metadata FROM audit_events WHERE resource_id = ? ORDER BY created_at, action",
      )
      .all(id) as { action: string; actor_id: string; metadata: string }[];
    expect(rows.map((r) => r.action).sort()).toEqual([
      "invite.create",
      "invite.revoke",
    ]);
    expect(rows.every((r) => r.actor_id === "admin")).toBe(true);
    expect(JSON.parse(rows[0].metadata)).toMatchObject({ client_id: "tool" });
  });
});
