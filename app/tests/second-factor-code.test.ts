import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { hashBackupCodes, matchSecondFactorCode } from "../src/worker/lib/totp";
import { d1, migratedDatabase } from "./setup/d1";

let sqlite: Database;

beforeEach(async () => {
  sqlite = migratedDatabase();
  sqlite.run(
    "INSERT INTO users (id, username, email, created_at, updated_at) VALUES ('u', 'u', 'u@example.com', 0, 0)",
  );
  sqlite.run(
    "INSERT INTO user_totp_recovery (user_id, backup_codes, updated_at) VALUES ('u', ?, 0)",
    [JSON.stringify(await hashBackupCodes(["abcd-efgh"]))],
  );
});

afterEach(() => sqlite.close());

describe("matchSecondFactorCode", () => {
  test("names a backup code as one, and spends it", async () => {
    const env = { DB: d1(sqlite) } as unknown as Env;
    expect(await matchSecondFactorCode(env, "u", "abcd-efgh")).toBe("backup");
    expect(await matchSecondFactorCode(env, "u", "abcd-efgh")).toBeNull();
  });
});
