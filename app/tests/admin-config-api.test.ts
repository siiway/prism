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
    `INSERT INTO users (id, username, email, role, created_at, updated_at)
     VALUES ('admin', 'admin', 'admin@example.com', 'admin', ?, ?)`,
    [now, now],
  );
  sqlite.run(
    `INSERT INTO oauth_tokens (id, access_token, client_id, user_id, scopes, expires_at, created_at)
     VALUES ('t1', 'tok', 'client', 'admin', '["admin:config:read","admin:config:write"]', ?, ?)`,
    [now + 600, now],
  );
  sqlite.run(
    `INSERT INTO site_config (key, value, updated_at) VALUES
       ('imap_password', '"imap-secret"', 0),
       ('discord_bot_token', '"bot-secret"', 0),
       ('github_readme_token', '"gh-secret"', 0)`,
  );
  app = new Hono();
  app.route("/api/oauth", meRoutes);
});

afterEach(() => sqlite.close());

function call(method: string, body?: unknown) {
  return app.fetch(
    new Request("https://prism.example/api/oauth/me/admin/config", {
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

function stored(key: string): string | null {
  const row = sqlite
    .query("SELECT value FROM site_config WHERE key = ?")
    .get(key) as { value: string } | null;
  return row?.value ?? null;
}

describe("admin:config API", () => {
  test("reading leaves out every credential", async () => {
    const res = await call("GET");
    expect(res.status).toBe(200);
    const { config } = await res.json<{ config: Record<string, unknown> }>();
    expect(config.site_name).toBeDefined();
    for (const key of [
      "imap_password",
      "discord_bot_token",
      "github_readme_token",
      "smtp_password",
    ])
      expect(config).not.toHaveProperty(key);
  });

  test("writing a credential or an unknown key changes nothing", async () => {
    const res = await call("PATCH", {
      imap_password: "new",
      discord_bot_token: "new",
      github_client_id: "new",
      made_up_key: 1,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "nothing_to_update" });
    expect(stored("imap_password")).toBe('"imap-secret"');
    expect(stored("made_up_key")).toBeNull();
  });

  test("writing goes through the admin dashboard's checks", async () => {
    const res = await call("PATCH", { login_ip_rate_limit: 0 });
    expect(res.status).toBe(400);
    expect(stored("login_ip_rate_limit")).toBeNull();

    const ok = await call("PATCH", { site_name: "Renamed" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ updated: ["site_name"] });
  });
});
