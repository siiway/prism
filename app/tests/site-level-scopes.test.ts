import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import oauthRoutes from "../src/worker/routes/oauth";
import { signJWT } from "../src/worker/lib/jwt";
import { SESSION_COOKIE } from "../src/worker/lib/cookies";
import { grantMatcher, heldScopes } from "../src/worker/lib/scopeGrants";
import { isSiteLevelScope } from "../src/shared/scopes";
import { d1, executionCtx, MemoryKv, migratedDatabase } from "./setup/d1";

const jwtSecret = "test-jwt-secret-site-scopes";
let sqlite: Database;
let app: Hono;

function testEnv(): Env {
  return {
    DB: d1(sqlite),
    APP_URL: "https://prism.example",
    KV_CACHE: new MemoryKv() as unknown as KVNamespace,
    KV_SESSIONS: new MemoryKv({
      "system:jwt_secret": jwtSecret,
    }) as unknown as KVNamespace,
  } as unknown as Env;
}

async function sessionCookie(userId: string, role: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  sqlite.run(
    "INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, 'hash', ?, ?)",
    [`s_${userId}`, userId, now, now + 3600],
  );
  const jwt = await signJWT(
    {
      sub: userId,
      role,
      sessionId: `s_${userId}`,
      email: `${userId}@example.com`,
      username: userId,
      display_name: userId,
      avatar_url: null,
    },
    jwtSecret,
    3600,
  );
  return `${SESSION_COOKIE}=${jwt}`;
}

beforeEach(() => {
  sqlite = migratedDatabase();
  const now = Math.floor(Date.now() / 1000);
  sqlite.run(
    `INSERT INTO users (id, username, email, role, created_at, updated_at) VALUES
       ('admin', 'admin', 'admin@example.com', 'admin', ?, ?),
       ('user', 'user', 'user@example.com', 'user', ?, ?)`,
    [now, now, now, now],
  );
  sqlite.run(
    `INSERT INTO oauth_apps (id, client_id, client_secret, name, owner_id, redirect_uris, allowed_scopes, created_at, updated_at)
     VALUES ('app_1', 'client_1', 'x', 'Tool', 'user', '["https://tool.example/cb"]',
             '["openid","admin:users:write","admin:config:read"]', ?, ?)`,
    [now, now],
  );
  app = new Hono();
  app.route("/oauth", oauthRoutes);
});

afterEach(() => sqlite.close());

function approve(cookie: string, scope: string) {
  return app.fetch(
    new Request("https://prism.example/oauth/authorize", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: "client_1",
        redirect_uri: "https://tool.example/cb",
        scope,
        action: "approve",
        authorization_mode: "always",
      }),
    }),
    testEnv(),
    executionCtx,
  );
}

describe("admin:* scopes are site-level", () => {
  test("the predicate covers site:* and admin:* only", () => {
    expect(isSiteLevelScope("site:user:read")).toBe(true);
    expect(isSiteLevelScope("admin:users:write")).toBe(true);
    expect(isSiteLevelScope("apps:write")).toBe(false);
    expect(isSiteLevelScope("app:client_2:admin:x")).toBe(false);
  });

  test("a non-admin cannot approve them", async () => {
    const res = await approve(
      await sessionCookie("user", "user"),
      "openid admin:users:write",
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: "site_scope_admin_required",
    });
  });

  test("an admin needs 2FA to approve them", async () => {
    const res = await approve(
      await sessionCookie("admin", "admin"),
      "openid admin:config:read",
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "site_scope_totp_invalid",
    });
  });

  test("the 2FA code can't be guessed without limit", async () => {
    const cookie = await sessionCookie("admin", "admin");
    const guess = () =>
      app.fetch(
        new Request("https://prism.example/oauth/authorize", {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: "client_1",
            redirect_uri: "https://tool.example/cb",
            scope: "openid admin:config:read",
            action: "approve",
            totp_code: "000000",
            confirm_text: "grant site access",
          }),
        }),
        testEnv(),
        executionCtx,
      );
    // The default limit is 15 codes per 5 minutes.
    for (let i = 0; i < 15; i++) expect((await guess()).status).toBe(400);
    expect((await guess()).status).toBe(429);
  });

  test("the consent screen asks for the site grant and never auto-approves", async () => {
    const now = Math.floor(Date.now() / 1000);
    sqlite.run(
      `INSERT INTO oauth_consents (id, user_id, client_id, scopes, granted_at, auto_authorize)
       VALUES ('c1', 'admin', 'client_1', '["openid","admin:users:write"]', ?, 1)`,
      [now],
    );
    const res = await app.fetch(
      new Request(
        "https://prism.example/oauth/app-info?client_id=client_1&redirect_uri=https://tool.example/cb&response_type=code&scope=openid%20admin:users:write",
        { headers: { Cookie: await sessionCookie("admin", "admin") } },
      ),
      testEnv(),
      executionCtx,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      requires_site_grant: true,
      auto_authorize_eligible: false,
    });
  });

  test("a silent request for them gets consent_required", async () => {
    const now = Math.floor(Date.now() / 1000);
    sqlite.run(
      `INSERT INTO oauth_consents (id, user_id, client_id, scopes, granted_at, auto_authorize)
       VALUES ('c1', 'admin', 'client_1', '["openid","admin:users:write"]', ?, 1)`,
      [now],
    );
    const res = await app.fetch(
      new Request(
        "https://prism.example/oauth/app-info?client_id=client_1&redirect_uri=https://tool.example/cb&response_type=code&scope=openid%20admin:users:write&prompt=none",
        { headers: { Cookie: await sessionCookie("admin", "admin") } },
      ),
      testEnv(),
      executionCtx,
    );
    expect(await res.json()).toMatchObject({
      prompt_none_error: "consent_required",
    });
  });

  test("they count as a site grant for the admin list", () => {
    expect(grantMatcher("site")("admin:config:write")).toBe(true);
    expect(
      heldScopes("site", ['["openid","admin:users:read","site:team:read"]']),
    ).toEqual(["admin:users:read", "site:team:read"]);
  });
});
