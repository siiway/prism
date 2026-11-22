import { afterEach, beforeEach, expect, test } from "bun:test";
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
     VALUES ('t1', 'tok', 'client', 'u', '["teams:create","teams:write"]', ?, ?)`,
    [now + 600, now],
  );
});

afterEach(() => sqlite.close());

function send(method: string, path: string, body: unknown) {
  const app = new Hono();
  app.route("/api/oauth", meRoutes);
  return app.fetch(
    new Request(`https://prism.example/api/oauth${path}`, {
      method,
      headers: {
        Authorization: "Bearer tok",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
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

test("creating a team with a token respects the switch that turns it off", async () => {
  sqlite.run(
    "INSERT INTO site_config (key, value, updated_at) VALUES ('disable_user_create_team', 'true', 0)",
  );
  const res = await send("POST", "/me/teams", { name: "Crew" });
  expect(res.status).toBe(403);
  expect(await res.json()).toMatchObject({ error: "team_creation_disabled" });
});

test("a team created with a token is stood up as the dashboard does it", async () => {
  const res = await send("POST", "/me/teams", { name: "Crew" });
  expect(res.status).toBe(201);
  const { team } = (await res.json()) as { team: { id: string } };
  // The team-user its apps are owned by.
  expect(
    sqlite.query("SELECT kind FROM users WHERE id = ?").get(team.id),
  ).toEqual({ kind: "team" });

  const bad = await send("POST", "/me/teams", {
    name: "Crew",
    avatar_url: "http://example.com/a.png",
  });
  expect(bad.status).toBe(400);
});
