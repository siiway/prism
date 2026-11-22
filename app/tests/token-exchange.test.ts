import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import oauthRoutes from "../src/worker/routes/oauth";
import { d1, executionCtx, MemoryKv, migratedDatabase } from "./setup/d1";

let sqlite: Database;
let app: Hono;
const now = Math.floor(Date.now() / 1000);

function testEnv(): Env {
  return {
    DB: d1(sqlite),
    APP_URL: "https://prism.example",
    KV_CACHE: new MemoryKv() as unknown as KVNamespace,
    KV_SESSIONS: new MemoryKv() as unknown as KVNamespace,
  } as unknown as Env;
}

beforeEach(() => {
  sqlite = migratedDatabase();
  sqlite.run(
    `INSERT INTO users (id, username, email, created_at, updated_at)
     VALUES ('alice', 'alice', 'alice@example.com', ?, ?)`,
    [now, now],
  );
  for (const id of ["a", "b"])
    sqlite.run(
      `INSERT INTO oauth_apps (id, client_id, client_secret, name, owner_id, redirect_uris, allowed_scopes, is_public, created_at, updated_at)
       VALUES (?, ?, '', ?, 'alice', '["https://app.example/cb"]', '["openid"]', 1, ?, ?)`,
      [`app_${id}`, `client_${id}`, `App ${id}`, now, now],
    );
  app = new Hono();
  app.route("/oauth", oauthRoutes);
});

afterEach(() => sqlite.close());

function issue(token: string, scopes: string[], dpopJkt: string | null = null) {
  sqlite.run(
    `INSERT INTO oauth_tokens (id, access_token, client_id, user_id, scopes, dpop_jkt, expires_at, created_at)
     VALUES (?, ?, 'client_a', 'alice', ?, ?, ?, ?)`,
    [`id-${token}`, token, JSON.stringify(scopes), dpopJkt, now + 600, now],
  );
}

function exchange(clientId: string, token: string, scope?: string) {
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    client_id: clientId,
    subject_token: token,
    subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
  });
  if (scope) body.set("scope", scope);
  return app.fetch(
    new Request("https://prism.example/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }),
    testEnv(),
    executionCtx,
  );
}

describe("token exchange", () => {
  test("another app gets only its own app:<client>:* scopes", async () => {
    issue("tok", ["openid", "apps:write", "app:client_b:read"]);
    const res = await exchange("client_b", "tok");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ scope: "app:client_b:read" });
  });

  test("another app cannot ask for the rest", async () => {
    issue("tok", ["openid", "apps:write", "app:client_b:read"]);
    const res = await exchange("client_b", "tok", "apps:write");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_scope" });
  });

  test("the issuing app keeps its scopes, and the new token can't outlive the old one", async () => {
    issue("tok", ["openid", "apps:write"]);
    const res = await exchange("client_a", "tok");
    expect(res.status).toBe(200);
    const body = await res.json<{ scope: string; expires_in: number }>();
    expect(body.scope).toBe("openid apps:write");
    expect(body.expires_in).toBeLessThanOrEqual(600);
  });

  test("a DPoP-bound token can't be exchanged without a proof from its key", async () => {
    issue("tok", ["openid"], "bound-key-thumbprint");
    const res = await exchange("client_a", "tok");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_dpop_proof" });
  });
});
