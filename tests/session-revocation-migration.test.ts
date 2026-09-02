import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

const migration = await Bun.file(
  "worker/db/migrations/0072_revoke_exposed_sessions.sql",
).text();

describe("cookie-only session migration", () => {
  test("revokes pre-fix sessions without blocking new sessions", () => {
    const db = new Database(":memory:");
    try {
      db.exec(`
        CREATE TABLE sessions (id TEXT PRIMARY KEY);
        INSERT INTO sessions (id) VALUES ('old-a'), ('old-b');
      `);

      db.exec(migration);
      expect(db.query("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({
        count: 0,
      });

      db.query("INSERT INTO sessions (id) VALUES (?)").run("new-session");
      expect(db.query("SELECT id FROM sessions").get()).toEqual({
        id: "new-session",
      });
    } finally {
      db.close();
    }
  });
});
