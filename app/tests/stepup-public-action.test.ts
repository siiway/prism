import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import oauthRoutes from "../src/worker/routes/oauth";
import { d1, executionCtx, MemoryKv, migratedDatabase } from "./setup/d1";

let sqlite: Database;
let app: Hono;
let env: Env;

beforeEach(() => {
  sqlite = migratedDatabase();
  const now = Math.floor(Date.now() / 1000);
  sqlite.run(
    "INSERT INTO users (id, username, email, created_at, updated_at) VALUES ('owner', 'owner', 'owner@example.com', ?, ?)",
    [now, now],
  );
  sqlite.run(
    `INSERT INTO oauth_apps (id, client_id, client_secret, name, owner_id, redirect_uris, allowed_scopes, is_public, created_at, updated_at) VALUES
       ('pub', 'public_client', '', 'SPA', 'owner', '["https://spa.example/cb"]', '["openid"]', 1, ?, ?)`,
    [now, now],
  );
  env = {
    DB: d1(sqlite),
    APP_URL: "https://prism.example",
    KV_CACHE: new MemoryKv() as unknown as KVNamespace,
    KV_SESSIONS: new MemoryKv() as unknown as KVNamespace,
  } as unknown as Env;
  app = new Hono();
  app.route("/oauth", oauthRoutes);
});

afterEach(() => sqlite.close());

describe("step-up for a public client", () => {
  test("doesn't show action text anyone could have written", async () => {
    const created = await app.fetch(
      new Request("https://prism.example/oauth/2fa/challenges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: "public_client",
          redirect_uri: "https://spa.example/cb",
          action: "Confirm wiring $5,000",
          code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
          code_challenge_method: "S256",
        }),
      }),
      env,
      executionCtx,
    );
    expect(created.status).toBe(200);
    const { challenge_id } = await created.json<{ challenge_id: string }>();

    const info = await app.fetch(
      new Request(
        `https://prism.example/oauth/2fa/info?challenge_id=${challenge_id}`,
      ),
      env,
      executionCtx,
    );
    expect(info.status).toBe(200);
    expect(await info.json()).toMatchObject({ action: null });
  });
});
