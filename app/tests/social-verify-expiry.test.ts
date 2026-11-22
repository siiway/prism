import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  checkSocialVerifyExpiry,
  trySocialEmailVerify,
} from "../src/worker/routes/connections";
import { d1, migratedDatabase } from "./setup/d1";

let sqlite: Database;

beforeEach(() => {
  sqlite = migratedDatabase();
  // Verified by an admin, long ago.
  sqlite.exec(`
    INSERT INTO users (id, username, email, email_verified, email_verified_via, email_verified_at, created_at, updated_at)
      VALUES ('u', 'u', 'u@example.com', 1, 'admin', 5, 0, 0);
  `);
});

afterEach(() => sqlite.close());

const row = () =>
  sqlite
    .query(
      "SELECT email_verified, email_verified_via, email_verified_at FROM users WHERE id = 'u'",
    )
    .get();

test("a social sign-in doesn't expire an admin's word on an address", async () => {
  await checkSocialVerifyExpiry(d1(sqlite), "u", 30);
  expect(row()).toEqual({
    email_verified: 1,
    email_verified_via: "admin",
    email_verified_at: 5,
  });
});

test("a social sign-in doesn't take over an admin's word on an address", async () => {
  await trySocialEmailVerify(
    d1(sqlite),
    "u",
    "u@example.com",
    1,
    "u@example.com",
    "github",
  );
  expect(row()).toMatchObject({ email_verified_via: "admin" });
});

test("a provider's word still expires", async () => {
  sqlite.run("UPDATE users SET email_verified_via = 'github' WHERE id = 'u'");
  await checkSocialVerifyExpiry(d1(sqlite), "u", 30);
  expect(row()).toEqual({
    email_verified: 0,
    email_verified_via: null,
    email_verified_at: null,
  });
});
