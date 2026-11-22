import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { sha256 } from "../src/worker/lib/crypto";
import {
  pkceMethodInvalid,
  verifyAppPkce,
} from "../src/worker/lib/oauthClients";
import { Hono } from "hono";
import oauthRoutes from "../src/worker/routes/oauth";
import type { OAuthAppRow } from "../src/worker/types";
import { d1, executionCtx, MemoryKv, migratedDatabase } from "./setup/d1";

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

describe("pkceMethodInvalid", () => {
  test("a challenge needs S256 or plain stated", () => {
    expect(pkceMethodInvalid("c", "S256")).toBe(false);
    expect(pkceMethodInvalid("c", "plain")).toBe(false);
    expect(pkceMethodInvalid("c", undefined)).toBe(true);
    expect(pkceMethodInvalid("c", "")).toBe(true);
    expect(pkceMethodInvalid("c", "S512")).toBe(true);
    expect(pkceMethodInvalid(undefined, undefined)).toBe(false);
  });
});

test("an authorization request with a challenge but no method is refused", async () => {
  sqlite.run(
    "UPDATE oauth_apps SET redirect_uris = '[\"https://a.example/cb\"]', allowed_scopes = '[\"openid\"]' WHERE id = 'app-1'",
  );
  const routes = new Hono();
  routes.route("/oauth", oauthRoutes);
  const res = await routes.fetch(
    new Request(
      "https://prism.example/oauth/app-info?client_id=client-1&redirect_uri=https://a.example/cb&response_type=code&scope=openid&code_challenge=abc",
    ),
    {
      DB: db,
      APP_URL: "https://prism.example",
      KV_CACHE: new MemoryKv() as unknown as KVNamespace,
      KV_SESSIONS: new MemoryKv() as unknown as KVNamespace,
    } as unknown as Env,
    executionCtx,
  );
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: "invalid_request" });
});
