import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migratedDatabase } from "./setup/d1";

const backfill = await Bun.file(
  "src/worker/db/migrations/0094_backfill_admin_scope_grants.sql",
).text();
let db: Database;

beforeEach(() => {
  db = migratedDatabase();
  db.exec(`
    INSERT INTO users (id, username, email, created_at, updated_at) VALUES
      ('admin', 'admin', 'admin@example.com', 0, 0),
      ('user', 'user', 'user@example.com', 0, 0);
    INSERT INTO oauth_consents (id, user_id, client_id, scopes, granted_at) VALUES
      ('c1', 'admin', 'tool', '["openid","admin:users:write","app:x:admin:panel"]', 100),
      ('c2', 'user', 'tool', '["openid","profile"]', 100),
      ('c3', 'admin', 'console', '["site:user:read","admin:config:read"]', 100);
    INSERT INTO site_scope_grants (id, admin_user_id, grantee_user_id, client_id, scopes, granted_at)
      VALUES ('g1', 'admin', 'admin', 'console', '["site:user:read"]', 100);
  `);
});

afterEach(() => db.close());

describe("backfilling admin:* grants", () => {
  test("records approvals that hold admin:* scopes and have no record", () => {
    db.exec(backfill);
    const rows = db
      .query(
        "SELECT client_id, grantee_user_id, scopes, granted_at FROM site_scope_grants ORDER BY client_id",
      )
      .all();
    expect(rows).toEqual([
      {
        client_id: "console",
        grantee_user_id: "admin",
        scopes: '["site:user:read"]',
        granted_at: 100,
      },
      {
        client_id: "tool",
        grantee_user_id: "admin",
        scopes: '["admin:users:write"]',
        granted_at: 100,
      },
    ]);
    // Running it again adds nothing.
    db.exec(backfill);
    expect(
      (
        db.query("SELECT COUNT(*) AS n FROM site_scope_grants").get() as {
          n: number;
        }
      ).n,
    ).toBe(2);
  });
});
