import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

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
    const results = this.db.query(this.sql).all(...this.values);
    const { changes } = this.db.query("SELECT changes() AS changes").get() as {
      changes: number;
    };
    return { success: true, results, meta: { changes } };
  }

  async first<T>(columnName?: string) {
    const row =
      (this.db.query(this.sql).get(...this.values) as T | null) ?? null;
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

let sqlite: Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      avatar_url TEXT,
      profile_is_public INTEGER NOT NULL DEFAULT 0,
      profile_show_members INTEGER DEFAULT 1,
      restrict_member_list_for_members INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      profile_is_public INTEGER NOT NULL DEFAULT 1,
      profile_show_joined_teams INTEGER DEFAULT 1,
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
  `);
  db = new SqliteD1(sqlite) as unknown as D1Database;
});

afterEach(() => sqlite.close());

describe("Team member hiding sql queries", () => {
  test("filters members when restrict_member_list_for_members is enabled and viewer is regular member", async () => {
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

    // Viewer is u_mem1 (regular member)
    const viewerId = "u_mem1";
    const where = [
      "tm.team_id = ?",
      "(tm.role IN ('owner', 'co-owner', 'admin') OR tm.user_id = ?)",
    ];
    const args = ["t1", viewerId];
    const clause = where.join(" AND ");

    const list = await db
      .prepare(
        `SELECT tm.user_id, tm.role FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE ${clause} ORDER BY tm.joined_at ASC`,
      )
      .bind(...args)
      .all<{ user_id: string; role: string }>();

    expect(list.results.map((r) => r.user_id)).toEqual(["u_owner", "u_admin", "u_mem1"]);

    const count = await db
      .prepare(`SELECT COUNT(*) as n FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE ${clause}`)
      .bind(...args)
      .first<{ n: number }>();

    expect(count?.n).toBe(3);
  });

  test("public profile query omits regular members when restricted", async () => {
    const now = Math.floor(Date.now() / 1000);
    sqlite.run(
      "INSERT INTO teams (id, name, restrict_member_list_for_members, profile_is_public, created_at, updated_at) VALUES ('t1', 'Team 1', 1, 1, ?, ?)",
      [now, now],
    );
    sqlite.run("INSERT INTO users (id, username, created_at, updated_at) VALUES ('u_admin', 'bob', ?, ?)", [now, now]);
    sqlite.run("INSERT INTO users (id, username, created_at, updated_at) VALUES ('u_mem1', 'charlie', ?, ?)", [now, now]);

    sqlite.run("INSERT INTO team_members (team_id, user_id, role, joined_at, show_on_profile) VALUES ('t1', 'u_admin', 'admin', ?, 1)", [10]);
    sqlite.run("INSERT INTO team_members (team_id, user_id, role, joined_at, show_on_profile) VALUES ('t1', 'u_mem1', 'member', ?, 1)", [20]);

    const hideRegularMembers = true;
    const query = `SELECT tm.user_id, tm.role
         FROM team_members tm
         JOIN users u ON u.id = tm.user_id
         WHERE tm.team_id = 't1'
           AND u.is_active = 1
           AND u.profile_is_public = 1
           ${hideRegularMembers ? "AND tm.role IN ('owner', 'co-owner', 'admin')" : ""}`;

    const res = await db.prepare(query).all<{ user_id: string; role: string }>();
    expect(res.results.map((r) => r.user_id)).toEqual(["u_admin"]);
  });
});
