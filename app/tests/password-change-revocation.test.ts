import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { signOutEverywhere } from "../src/worker/lib/session";
import { d1, executionCtx, migratedDatabase } from "./setup/d1";

let sqlite: Database;
let env: Env;

function ids(table: string, column = "id"): string[] {
  return (
    sqlite.query(`SELECT ${column} AS v FROM ${table} ORDER BY 1`).all() as {
      v: string;
    }[]
  ).map((r) => r.v);
}

beforeEach(() => {
  sqlite = migratedDatabase();
  env = { DB: d1(sqlite) } as unknown as Env;
  sqlite.exec(`
    INSERT INTO users (id, username, email, created_at, updated_at) VALUES
      ('alice', 'alice', 'alice@example.com', 0, 0),
      ('bob', 'bob', 'bob@example.com', 0, 0);
    INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES
      ('alice-here', 'alice', 'h1', 9999999999, 0),
      ('alice-other', 'alice', 'h2', 9999999999, 0),
      ('bob-1', 'bob', 'h3', 9999999999, 0);
    INSERT INTO oauth_tokens (id, access_token, refresh_token, client_id, user_id, expires_at, created_at) VALUES
      ('t-alice', 'a1', 'r1', 'client', 'alice', 9999999999, 0),
      ('t-bob', 'a2', 'r2', 'client', 'bob', 9999999999, 0);
    INSERT INTO oauth_codes (code, client_id, user_id, redirect_uri, expires_at, created_at) VALUES
      ('c-alice', 'client', 'alice', 'https://app.example/cb', 9999999999, 0),
      ('c-bob', 'client', 'bob', 'https://app.example/cb', 9999999999, 0);
    INSERT INTO oauth_device_codes (device_code, user_code, client_id, status, user_id, expires_at, created_at) VALUES
      ('d-alice', 'AAAA', 'client', 'approved', 'alice', 9999999999, 0),
      ('d-bob', 'BBBB', 'client', 'approved', 'bob', 9999999999, 0);
    INSERT INTO oauth_2fa_codes (code, client_id, user_id, redirect_uri, method, expires_at, verified_at, created_at) VALUES
      ('s-alice', 'client', 'alice', 'https://app.example/cb', 'totp', 9999999999, 0, 0),
      ('s-bob', 'client', 'bob', 'https://app.example/cb', 'totp', 9999999999, 0, 0);
  `);
});

function setName(name: string): D1PreparedStatement {
  return env.DB.prepare(
    "UPDATE users SET username = ? WHERE id = 'alice'",
  ).bind(name);
}

function aliceName(): string {
  return (
    sqlite.query("SELECT username FROM users WHERE id = 'alice'").get() as {
      username: string;
    }
  ).username;
}

describe("signOutEverywhere", () => {
  test("ends the user's other sessions, tokens and codes", async () => {
    await signOutEverywhere(env, executionCtx, "alice", "alice-here");
    expect(ids("sessions")).toEqual(["alice-here", "bob-1"]);
    expect(ids("oauth_tokens")).toEqual(["t-bob"]);
    expect(ids("oauth_codes", "code")).toEqual(["c-bob"]);
    expect(ids("oauth_device_codes", "device_code")).toEqual(["d-bob"]);
    expect(ids("oauth_2fa_codes", "code")).toEqual(["s-bob"]);
  });

  test("without a session to keep, ends them all", async () => {
    await signOutEverywhere(env, executionCtx, "alice", null);
    expect(ids("sessions")).toEqual(["bob-1"]);
  });

  test("runs the statements it is given in the same batch", async () => {
    await signOutEverywhere(env, executionCtx, "alice", null, [
      setName("alice2"),
    ]);
    expect(aliceName()).toBe("alice2");

    // The username is unique, so this one fails and takes the batch with it.
    sqlite.exec(
      "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES ('alice-3', 'alice', 'h4', 9999999999, 0)",
    );
    await expect(
      signOutEverywhere(env, executionCtx, "alice", null, [setName("bob")]),
    ).rejects.toThrow();
    expect(aliceName()).toBe("alice2");
    expect(ids("sessions")).toContain("alice-3");
  });
});
