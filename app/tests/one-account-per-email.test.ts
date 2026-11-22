import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { emailInUse } from "../src/worker/lib/accountEmails";
import { d1, migratedDatabase } from "./setup/d1";

let db: Database;

beforeEach(() => {
  db = migratedDatabase();
  db.exec(`
    INSERT INTO users (id, username, email, created_at, updated_at) VALUES
      ('a', 'a', 'a@example.com', 0, 0),
      ('b', 'b', 'b@example.com', 0, 0);
    INSERT INTO user_emails (id, user_id, email, verified, created_at)
      VALUES ('e1', 'a', 'alt@example.com', 1, 0);
  `);
});

afterEach(() => db.close());

describe("an address belongs to one account, even when requests race", () => {
  test("a new primary can't be another account's verified alternate", () => {
    expect(() =>
      db.exec(
        "INSERT INTO users (id, username, email, created_at, updated_at) VALUES ('c', 'c', 'alt@example.com', 0, 0)",
      ),
    ).toThrow("UNIQUE constraint failed");
    expect(() =>
      db.exec("UPDATE users SET email = 'alt@example.com' WHERE id = 'b'"),
    ).toThrow("UNIQUE constraint failed");
  });

  test("an alternate can't be verified while it's another account's primary", () => {
    db.exec(
      "INSERT INTO user_emails (id, user_id, email, verified, created_at) VALUES ('e2', 'a', 'b@example.com', 0, 0)",
    );
    expect(() =>
      db.exec("UPDATE user_emails SET verified = 1 WHERE id = 'e2'"),
    ).toThrow("UNIQUE constraint failed");
  });

  test("an account's own addresses are its own business", () => {
    db.exec("UPDATE users SET email = 'alt@example.com' WHERE id = 'a'");
    db.exec(
      "INSERT INTO user_emails (id, user_id, email, verified, created_at) VALUES ('e3', 'b', 'b@example.com', 1, 0)",
    );
  });
});

describe("addresses stored before everything was lowercase", () => {
  const migration = readFileSync(
    "src/worker/db/migrations/0093_one_account_per_email.sql",
    "utf8",
  );

  /** Run 0093 again over rows written as if before it. */
  function rerun(seed: string) {
    for (const t of [
      "users_email_not_another_accounts_insert",
      "users_email_not_another_accounts_update",
      "user_emails_not_another_accounts_insert",
      "user_emails_not_another_accounts_update",
    ])
      db.exec(`DROP TRIGGER ${t}`);
    db.exec(seed);
    db.exec(migration);
  }

  test("are lowercased, so the in-use check finds them", async () => {
    rerun(`
      INSERT INTO users (id, username, email, created_at, updated_at)
        VALUES ('s', 's', 'Social@Example.com', 0, 0);
      INSERT INTO user_emails (id, user_id, email, verified, created_at)
        VALUES ('e9', 's', 'Other@Example.com', 1, 0);
    `);
    expect(await emailInUse(d1(db), "social@example.com")).toBe(true);
    expect(await emailInUse(d1(db), "other@example.com")).toBe(true);
  });

  test("one that only differs in case from another row is left alone", () => {
    rerun(`
      INSERT INTO users (id, username, email, created_at, updated_at)
        VALUES ('s', 's', 'A@example.com', 0, 0);
    `);
    expect(db.query("SELECT email FROM users WHERE id = 's'").get()).toEqual({
      email: "A@example.com",
    });
  });
});
