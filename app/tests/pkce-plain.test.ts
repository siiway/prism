import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { sha256 } from "../src/worker/lib/crypto";
import { verifyAppPkce } from "../src/worker/lib/oauthClients";
import type { OAuthAppRow } from "../src/worker/types";
import { d1, migratedDatabase } from "./setup/d1";

let sqlite: Database;
let db: D1Database;
const app = { id: "app-1" } as OAuthAppRow;

function plainUsedAt(): number | null {
  return (
    sqlite
      .query("SELECT pkce_plain_used_at AS at FROM oauth_apps WHERE id = ?")
      .get(app.id) as { at: number | null }
  ).at;
}

async function s256(verifier: string): Promise<string> {
  return Buffer.from(await sha256(verifier)).toString("base64url");
}

beforeEach(() => {
  sqlite = migratedDatabase();
  db = d1(sqlite);
  sqlite.exec(`
    INSERT INTO users (id, username, email, created_at, updated_at)
      VALUES ('owner', 'owner', 'owner@example.com', 0, 0);
    INSERT INTO oauth_apps (id, owner_id, name, client_id, client_secret, created_at, updated_at)
      VALUES ('app-1', 'owner', 'App', 'client-1', '', 0, 0);
  `);
});

describe("verifyAppPkce", () => {
  test("accepts plain and notes it on the app", async () => {
    expect(await verifyAppPkce(db, app, "verifier", "verifier", "plain")).toBe(
      true,
    );
    expect(plainUsedAt()).toBeNumber();
  });

  test("a failed plain check notes nothing", async () => {
    expect(await verifyAppPkce(db, app, "wrong", "verifier", "plain")).toBe(
      false,
    );
    expect(plainUsedAt()).toBeNull();
  });

  test("S256, stated or defaulted, notes nothing", async () => {
    const challenge = await s256("verifier");
    expect(await verifyAppPkce(db, app, "verifier", challenge, "S256")).toBe(
      true,
    );
    expect(await verifyAppPkce(db, app, "verifier", challenge, null)).toBe(
      true,
    );
    expect(plainUsedAt()).toBeNull();
  });

  test("still passes before the migration that adds the column", async () => {
    sqlite.exec("ALTER TABLE oauth_apps DROP COLUMN pkce_plain_used_at");
    expect(await verifyAppPkce(db, app, "verifier", "verifier", "plain")).toBe(
      true,
    );
  });
});
