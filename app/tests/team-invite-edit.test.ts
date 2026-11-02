// Editing a team invite through the real route, over every migration.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import teamsRoutes from "../src/worker/routes/teams";
import { signJWT } from "../src/worker/lib/jwt";
import { SESSION_COOKIE } from "../src/worker/lib/cookies";
import { d1, executionCtx, MemoryKv, migratedDatabase } from "./setup/d1";

const jwtSecret = "test-jwt-secret-invite-edit";
let sqlite: Database;
let app: Hono;

beforeEach(() => {
  sqlite = migratedDatabase();
  const now = Math.floor(Date.now() / 1000);
  sqlite.run(
    "INSERT INTO users (id, username, email, password_hash, created_at, updated_at) VALUES ('u1', 'alice', 'alice@example.com', 'x', ?, ?)",
    [now, now],
  );
  sqlite.run(
    "INSERT INTO teams (id, name, created_at, updated_at) VALUES ('t1', 'Team', ?, ?)",
    [now, now],
  );
  sqlite.run(
    "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES ('t1', 'u1', 'owner', ?)",
    [now],
  );
  sqlite.run(
    "INSERT INTO team_invites (token, team_id, role, created_by, max_uses, uses, expires_at, created_at) VALUES ('inv1', 't1', 'member', 'u1', 0, 1, ?, ?)",
    [now + 86400, now],
  );
  sqlite.run(
    "INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES ('s1', 'u1', 'hash', ?, ?)",
    [now, now + 3600],
  );
  app = new Hono();
  app.route("/teams", teamsRoutes);
});

afterEach(() => sqlite.close());

async function patchInvite(body: unknown) {
  const jwt = await signJWT(
    {
      sub: "u1",
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
  const env = {
    DB: d1(sqlite),
    APP_URL: "https://prism.example",
    KV_CACHE: new MemoryKv(),
    KV_SESSIONS: new MemoryKv({ "system:jwt_secret": jwtSecret }),
  } as unknown as Env;
  return app.fetch(
    new Request("https://prism.example/teams/t1/invites/inv1", {
      method: "PATCH",
      headers: {
        Cookie: `${SESSION_COOKIE}=${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    env,
    executionCtx,
  );
}

const stored = () =>
  sqlite
    .query("SELECT max_uses, enabled FROM team_invites WHERE token = 'inv1'")
    .get() as { max_uses: number; enabled: number };

describe("PATCH /teams/:id/invites/:token", () => {
  test("sets a usage limit at or above the uses so far", async () => {
    const res = await patchInvite({ max_uses: 5 });
    expect(res.status).toBe(200);
    expect(stored().max_uses).toBe(5);
  });

  test("changes several fields at once", async () => {
    const res = await patchInvite({ max_uses: 3, enabled: false });
    expect(res.status).toBe(200);
    expect(stored()).toEqual({ max_uses: 3, enabled: 0 });
  });

  test("refuses a limit that isn't a whole number", async () => {
    const res = await patchInvite({ max_uses: 0.5 });
    expect(res.status).toBe(400);
    expect(stored().max_uses).toBe(0);
  });
});
