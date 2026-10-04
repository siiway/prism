import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import teamsRoutes from "../worker/routes/teams";
import publicTeamsRoutes from "../worker/routes/public-teams";
import { signJWT } from "../worker/lib/jwt";
import { SESSION_COOKIE } from "../worker/lib/cookies";

class SqliteD1Statement {
  private values: unknown[] = [];

  constructor(
    private readonly db: Database,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async run() {
    const result = this.db.query(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  async first<T>(columnName?: string) {
    const row = (this.db.query(this.sql).get(...this.values) as T | null) ?? null;
    if (row === null || columnName === undefined) return row;
    return Object(row)[columnName] ?? null;
  }

  async all<T>() {
    return {
      success: true,
      results: this.db.query(this.sql).all(...this.values) as T[],
    };
  }

  async raw<T>() {
    return this.db.query(this.sql).values(...this.values) as T[];
  }
}

class SqliteD1 {
  constructor(private readonly db: Database) {}

  prepare(sql: string) {
    return new SqliteD1Statement(this.db, sql);
  }
}

class MemoryKv {
  private readonly values = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial))
      this.values.set(key, value);
  }

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string) {
    this.values.set(key, value);
  }

  async delete(key: string) {
    this.values.delete(key);
  }
}

const jwtSecret = "test-jwt-secret-team";
const executionCtx = {
  waitUntil(promise: Promise<unknown>) {
    void promise.catch(() => undefined);
  },
  passThroughOnException() {},
} as ExecutionContext;

let sqlite: Database;
let db: D1Database;
let app: Hono;

function testEnv(): Env {
  return {
    DB: db,
    APP_URL: "https://prism.example",
    KV_CACHE: new MemoryKv() as unknown as KVNamespace,
    KV_SESSIONS: new MemoryKv({
      "system:jwt_secret": jwtSecret,
    }) as unknown as KVNamespace,
  } as unknown as Env;
}

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE site_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'user',
      username TEXT NOT NULL,
      display_name TEXT,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      avatar_url TEXT,
      email_verified INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      profile_is_public INTEGER NOT NULL DEFAULT 1,
      profile_show_joined_teams INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      amr TEXT
    );

    CREATE TABLE teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT,
      description TEXT,
      avatar_url TEXT,
      parent_team_id TEXT,
      profile_is_public INTEGER NOT NULL DEFAULT 0,
      profile_show_description INTEGER,
      profile_show_avatar INTEGER,
      profile_show_owner INTEGER,
      profile_show_member_count INTEGER,
      profile_show_apps INTEGER,
      profile_show_domains INTEGER,
      profile_show_members INTEGER DEFAULT 1,
      profile_show_sub_teams INTEGER,
      require_2fa INTEGER NOT NULL DEFAULT 0,
      require_verified_email INTEGER NOT NULL DEFAULT 0,
      enable_groups INTEGER NOT NULL DEFAULT 0,
      role_permissions TEXT,
      invite_registration_granted INTEGER NOT NULL DEFAULT 0,
      invite_registration_enabled INTEGER NOT NULL DEFAULT 0,
      invite_registration_exemptions TEXT,
      allow_normal_user_join INTEGER NOT NULL DEFAULT 1,
      restrict_member_list_for_members INTEGER NOT NULL DEFAULT 0,
      dissolving_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE team_members (
      team_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      show_on_profile INTEGER,
      PRIMARY KEY (team_id, user_id)
    );

    CREATE TABLE team_groups (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT,
      admin_assignable INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE team_member_groups (
      team_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      assigned_at INTEGER NOT NULL,
      PRIMARY KEY (team_id, user_id, group_id)
    );

    CREATE TABLE oauth_apps (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      team_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      icon_url TEXT,
      website_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE domains (
      domain TEXT PRIMARY KEY,
      team_id TEXT,
      verified INTEGER NOT NULL DEFAULT 1,
      verified_at INTEGER
    );
  `);

  db = new SqliteD1(sqlite) as unknown as D1Database;

  app = new Hono();
  app.route("/teams", teamsRoutes);
  app.route("/public/teams", publicTeamsRoutes);
});

afterEach(() => sqlite.close());

async function makeSessionCookie(userId: string, username: string, role: "admin" | "user" = "user"): Promise<string> {
  const sessionId = `s_${userId}`;
  const now = Math.floor(Date.now() / 1000);
  sqlite.run(
    "INSERT OR REPLACE INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, 'hash', ?, ?)",
    [sessionId, userId, now, now + 3600],
  );
  const jwt = await signJWT(
    {
      sub: userId,
      role,
      sessionId,
      email: `${username}@example.com`,
      username,
      display_name: username,
      avatar_url: null,
    },
    jwtSecret,
    3600,
  );
  return `${SESSION_COOKIE}=${jwt}`;
}

describe("Team member hiding with production route handlers", () => {
  test("GET /teams/:id/members restricts members list for regular member viewer", async () => {
    const now = Math.floor(Date.now() / 1000);
    sqlite.run(
      "INSERT INTO teams (id, name, restrict_member_list_for_members, created_at, updated_at) VALUES ('t1', 'Team 1', 1, ?, ?)",
      [now, now],
    );
    sqlite.run("INSERT INTO users (id, username, created_at, updated_at) VALUES ('u_owner', 'alice', ?, ?)", [now, now]);
    sqlite.run("INSERT INTO users (id, username, created_at, updated_at) VALUES ('u_admin', 'bob', ?, ?)", [now, now]);
    sqlite.run("INSERT INTO users (id, username, created_at, updated_at) VALUES ('u_mem1', 'charlie', ?, ?)", [now, now]);
    sqlite.run("INSERT INTO users (id, username, created_at, updated_at) VALUES ('u_mem2', 'david', ?, ?)", [now, now]);

    sqlite.run("INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES ('t1', 'u_owner', 'owner', ?)", [10]);
    sqlite.run("INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES ('t1', 'u_admin', 'admin', ?)", [20]);
    sqlite.run("INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES ('t1', 'u_mem1', 'member', ?)", [30]);
    sqlite.run("INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES ('t1', 'u_mem2', 'member', ?)", [40]);

    // Member 1 requests members list via production route
    const cookie = await makeSessionCookie("u_mem1", "charlie");
    const res = await app.fetch(
      new Request("https://prism.example/teams/t1/members", {
        headers: { Cookie: cookie },
      }),
      testEnv(),
      executionCtx,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ members: Array<{ user_id: string; role: string }>; total: number }>();
    expect(body.total).toBe(4);
    expect(body.members.map((m) => m.user_id)).toEqual(["u_owner", "u_admin", "u_mem1"]);

    // Owner requests members list via production route
    const ownerCookie = await makeSessionCookie("u_owner", "alice");
    const ownerRes = await app.fetch(
      new Request("https://prism.example/teams/t1/members", {
        headers: { Cookie: ownerCookie },
      }),
      testEnv(),
      executionCtx,
    );

    expect(ownerRes.status).toBe(200);
    const ownerBody = await ownerRes.json<{ members: Array<{ user_id: string; role: string }>; total: number }>();
    expect(ownerBody.total).toBe(4);
    expect(ownerBody.members.map((m) => m.user_id)).toEqual(["u_owner", "u_admin", "u_mem1", "u_mem2"]);
  });

  test("PATCH /teams/:id enforces owner or co-owner permission to change restrict_member_list_for_members", async () => {
    const now = Math.floor(Date.now() / 1000);
    sqlite.run(
      "INSERT INTO teams (id, name, restrict_member_list_for_members, created_at, updated_at) VALUES ('t1', 'Team 1', 0, ?, ?)",
      [now, now],
    );
    sqlite.run("INSERT INTO users (id, username, created_at, updated_at) VALUES ('u_admin', 'bob', ?, ?)", [now, now]);
    sqlite.run("INSERT INTO users (id, username, created_at, updated_at) VALUES ('u_owner', 'alice', ?, ?)", [now, now]);

    sqlite.run("INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES ('t1', 'u_admin', 'admin', ?)", [10]);
    sqlite.run("INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES ('t1', 'u_owner', 'owner', ?)", [20]);

    // Admin attempts to change setting -> 403
    const adminCookie = await makeSessionCookie("u_admin", "bob");
    const adminRes = await app.fetch(
      new Request("https://prism.example/teams/t1", {
        method: "PATCH",
        headers: {
          Cookie: adminCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ restrict_member_list_for_members: true }),
      }),
      testEnv(),
      executionCtx,
    );
    expect(adminRes.status).toBe(403);

    // Owner attempts to change setting -> 200
    const ownerCookie = await makeSessionCookie("u_owner", "alice");
    const ownerRes = await app.fetch(
      new Request("https://prism.example/teams/t1", {
        method: "PATCH",
        headers: {
          Cookie: ownerCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ restrict_member_list_for_members: true }),
      }),
      testEnv(),
      executionCtx,
    );
    expect(ownerRes.status).toBe(200);

    const team = sqlite.query("SELECT restrict_member_list_for_members FROM teams WHERE id = 't1'").get() as {
      restrict_member_list_for_members: number;
    };
    expect(team.restrict_member_list_for_members).toBe(1);
  });

  test("GET /public/teams/:id omits regular members when restrict_member_list_for_members is enabled", async () => {
    const now = Math.floor(Date.now() / 1000);
    sqlite.run(
      "INSERT INTO teams (id, name, profile_is_public, profile_show_members, restrict_member_list_for_members, created_at, updated_at) VALUES ('t1', 'Team 1', 1, 1, 1, ?, ?)",
      [now, now],
    );
    sqlite.run("INSERT INTO users (id, username, created_at, updated_at) VALUES ('u_admin', 'bob', ?, ?)", [now, now]);
    sqlite.run("INSERT INTO users (id, username, created_at, updated_at) VALUES ('u_mem', 'charlie', ?, ?)", [now, now]);

    sqlite.run("INSERT INTO team_members (team_id, user_id, role, joined_at, show_on_profile) VALUES ('t1', 'u_admin', 'admin', ?, 1)", [10]);
    sqlite.run("INSERT INTO team_members (team_id, user_id, role, joined_at, show_on_profile) VALUES ('t1', 'u_mem', 'member', ?, 1)", [20]);

    const res = await app.fetch(
      new Request("https://prism.example/public/teams/t1"),
      testEnv(),
      executionCtx,
    );

    expect(res.status).toBe(200);
    const body = await res.json<{ team: { members: Array<{ username: string; role: string }> } }>();
    expect(body.team.members.map((m) => m.username)).toEqual(["bob"]);
  });
});
