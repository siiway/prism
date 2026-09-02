import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { sha256Hex } from "../worker/lib/crypto";
import {
  clearSocialOAuthCookie,
  readSocialOAuthCookie,
  SESSION_COOKIE,
  setSocialOAuthCookie,
  SOCIAL_OAUTH_COOKIE,
} from "../worker/lib/cookies";
import {
  consumeSocialOAuthState,
  openSocialOAuthInviteToken,
  sealSocialOAuthInviteToken,
  SOCIAL_OAUTH_STATE_TTL_SECONDS,
  storeSocialOAuthState,
} from "../worker/lib/socialOAuthState";
import { signJWT } from "../worker/lib/jwt";
import connections from "../worker/routes/connections";

class SqliteD1Statement {
  private values: unknown[] = [];

  constructor(
    private readonly db: Database,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async run() {
    const result = this.db.query(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  async first<T>() {
    return (this.db.query(this.sql).get(...this.values) as T | null) ?? null;
  }

  async all<T>() {
    return {
      success: true,
      results: this.db.query(this.sql).all(...this.values) as T[],
    };
  }
}

class SqliteD1 {
  constructor(private readonly db: Database) {}

  prepare(sql: string) {
    return new SqliteD1Statement(this.db, sql);
  }
}

class MemoryKv {
  private readonly values = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial))
      this.values.set(key, value);
  }

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string) {
    this.values.set(key, value);
  }

  async delete(key: string) {
    this.values.delete(key);
  }
}

const migration = await Bun.file(
  "worker/db/migrations/0071_social_oauth_states.sql",
).text();
const state = "s".repeat(32);
const now = Math.floor(Date.now() / 1000);
const jwtSecret = "test-jwt-secret";
const executionCtx = {
  waitUntil(promise: Promise<unknown>) {
    void promise.catch(() => undefined);
  },
  passThroughOnException() {},
} as ExecutionContext;

let sqlite: Database;
let db: D1Database;

function routeEnv(cache = new MemoryKv()): Env {
  return {
    DB: db,
    APP_URL: "https://prism.example",
    KV_CACHE: cache as unknown as KVNamespace,
    KV_SESSIONS: new MemoryKv({
      "system:jwt_secret": jwtSecret,
    }) as unknown as KVNamespace,
  } as unknown as Env;
}

async function createSessionToken(sessionId: string): Promise<string> {
  sqlite
    .query(
      "INSERT OR IGNORE INTO users (id, role, email_verified, is_active) VALUES (?, 'user', 1, 1)",
    )
    .run("user-a");
  sqlite
    .query(
      `INSERT INTO sessions
         (id, user_id, token_hash, expires_at, created_at)
       VALUES (?, 'user-a', 'hash', ?, ?)`,
    )
    .run(sessionId, now + 3600, now);
  return signJWT(
    {
      sub: "user-a",
      role: "user",
      sessionId,
      email: "user@example.com",
      username: "user-a",
      display_name: "User A",
      avatar_url: null,
    },
    jwtSecret,
    3600,
  );
}

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(migration);
  sqlite.exec(`
    CREATE TABLE oauth_sources (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL,
      name TEXT NOT NULL,
      client_id TEXT NOT NULL,
      client_secret TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      auth_url TEXT,
      token_url TEXT,
      userinfo_url TEXT,
      scopes TEXT,
      issuer_url TEXT,
      icon_url TEXT,
      show_icon INTEGER NOT NULL DEFAULT 1,
      icon_only INTEGER NOT NULL DEFAULT 0,
      trusted INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE site_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'user',
      role TEXT NOT NULL,
      email_verified INTEGER NOT NULL,
      is_active INTEGER NOT NULL
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      user_agent TEXT,
      ip_address TEXT,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    INSERT INTO oauth_sources
      (id, slug, provider, name, client_id, client_secret, enabled, created_at)
    VALUES
      ('source-1', 'github', 'github', 'GitHub', 'client-id', 'client-secret', 1, 0),
      ('source-2', 'telegram', 'telegram', 'Telegram', 'bot-id', 'bot-secret', 1, 0);
  `);
  db = new SqliteD1(sqlite) as unknown as D1Database;
});

afterEach(() => sqlite.close());

describe("social OAuth browser correlation", () => {
  test("sets a hardened HttpOnly correlation cookie", async () => {
    const app = new Hono();
    app.get("/set", (c) => {
      setSocialOAuthCookie(c, "browser-secret", 600);
      return c.text("ok");
    });
    app.get("/read", (c) => c.json({ correlation: readSocialOAuthCookie(c) }));
    app.get("/clear", (c) => {
      clearSocialOAuthCookie(c);
      return c.text("ok");
    });

    const setResponse = await app.request("/set");
    expect(setResponse.headers.get("set-cookie")).toBe(
      `${SOCIAL_OAUTH_COOKIE}=browser-secret; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
    );

    const readResponse = await app.request("/read", {
      headers: {
        Cookie: `${SOCIAL_OAUTH_COOKIE}=browser-secret`,
      },
    });
    expect(await readResponse.json()).toEqual({
      correlation: "browser-secret",
    });

    const clearResponse = await app.request("/clear");
    expect(clearResponse.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  test("encrypts invite handoffs with the browser-only secret", async () => {
    const correlation = "i".repeat(43);
    const sealed = await sealSocialOAuthInviteToken(
      "invite-bearer",
      correlation,
      state,
    );

    expect(sealed).not.toContain("invite-bearer");
    expect(await openSocialOAuthInviteToken(sealed, correlation, state)).toBe(
      "invite-bearer",
    );
    await expect(
      openSocialOAuthInviteToken(sealed, correlation, "x".repeat(32)),
    ).rejects.toThrow();
  });

  test("begin stores only hashed correlation and encrypted invite context", async () => {
    const response = await connections.request(
      "https://prism.example/github/begin?invite=invite-bearer",
      {},
      routeEnv(),
    );

    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly; Secure; SameSite=Lax");
    const correlation = setCookie
      .split(";", 1)[0]
      .slice(`${SOCIAL_OAUTH_COOKIE}=`.length);
    const { redirect } = (await response.json()) as { redirect: string };
    const issuedState = new URL(redirect).searchParams.get("state") ?? "";
    const stored = sqlite
      .query(
        `SELECT correlation_hash, invite_token_ciphertext
           FROM social_oauth_states WHERE state = ?`,
      )
      .get(issuedState) as {
      correlation_hash: string;
      invite_token_ciphertext: string;
    };

    expect(stored.correlation_hash).toBe(await sha256Hex(correlation));
    expect(stored.invite_token_ciphertext).not.toContain("invite-bearer");
    expect(
      await openSocialOAuthInviteToken(
        stored.invite_token_ciphertext,
        correlation,
        issuedState,
      ),
    ).toBe("invite-bearer");
  });

  test("rate limits repeated begin requests from one client", async () => {
    const env = routeEnv(new MemoryKv());
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await connections.request(
        "https://prism.example/github/begin",
        { headers: { "X-Forwarded-For": "192.0.2.10" } },
        env,
      );
      expect(response.status).toBe(200);
    }

    const limited = await connections.request(
      "https://prism.example/github/begin",
      { headers: { "X-Forwarded-For": "192.0.2.10" } },
      env,
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).not.toBeNull();
  });

  test("the real callback rejects browser B and remains redeemable by browser A", async () => {
    const browserASecret = "a".repeat(43);
    await storeSocialOAuthState(db, {
      state,
      slug: "github",
      provider: "github",
      mode: "login",
      userId: null,
      sessionId: null,
      correlationHash: await sha256Hex(browserASecret),
      codeVerifier: null,
      now,
    });
    const env = {
      DB: db,
      APP_URL: "https://prism.example",
    } as unknown as Env;
    const callback = `https://prism.example/github/callback?error=access_denied&state=${state}`;

    const browserBResponse = await connections.request(callback, {}, env);
    expect(browserBResponse.headers.get("location")).toBe(
      "https://prism.example/connections?error=invalid_state",
    );
    expect(
      sqlite.query("SELECT COUNT(*) AS count FROM social_oauth_states").get(),
    ).toEqual({ count: 1 });

    const browserAResponse = await connections.request(
      callback,
      { headers: { Cookie: `${SOCIAL_OAUTH_COOKIE}=${browserASecret}` } },
      env,
    );
    expect(browserAResponse.headers.get("location")).toBe(
      "https://prism.example/connections?error=access_denied",
    );
    expect(browserAResponse.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(
      sqlite.query("SELECT COUNT(*) AS count FROM social_oauth_states").get(),
    ).toEqual({ count: 0 });
  });

  test("Telegram rejects browser B without consuming browser A's state", async () => {
    const telegramState = "t".repeat(32);
    const browserASecret = "b".repeat(43);
    await storeSocialOAuthState(db, {
      state: telegramState,
      slug: "telegram",
      provider: "telegram",
      mode: "login",
      userId: null,
      sessionId: null,
      correlationHash: await sha256Hex(browserASecret),
      codeVerifier: null,
      now,
    });
    const request = (cookie?: string) =>
      connections.request(
        "https://prism.example/telegram/tg-verify",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(cookie ? { Cookie: cookie } : {}),
          },
          body: JSON.stringify({ nonce: telegramState, tg_data: {} }),
        },
        routeEnv(),
      );

    const browserBResponse = await request();
    expect(await browserBResponse.json()).toEqual({ error: "invalid_state" });
    expect(
      sqlite
        .query(
          "SELECT COUNT(*) AS count FROM social_oauth_states WHERE state = ?",
        )
        .get(telegramState),
    ).toEqual({ count: 1 });

    const browserAResponse = await request(
      `${SOCIAL_OAUTH_COOKIE}=${browserASecret}`,
    );
    expect(await browserAResponse.json()).toEqual({
      error: "invalid_signature",
    });
    expect(
      sqlite
        .query(
          "SELECT COUNT(*) AS count FROM social_oauth_states WHERE state = ?",
        )
        .get(telegramState),
    ).toEqual({ count: 0 });
  });

  test("Telegram connect requires the initiating live session", async () => {
    const tokenA = await createSessionToken("session-a");
    const tokenB = await createSessionToken("session-b");
    const telegramState = "u".repeat(32);
    const correlation = "u".repeat(43);
    await storeSocialOAuthState(db, {
      state: telegramState,
      slug: "telegram",
      provider: "telegram",
      mode: "connect",
      userId: "user-a",
      sessionId: "session-a",
      correlationHash: await sha256Hex(correlation),
      codeVerifier: null,
      now,
    });
    const request = (token: string) =>
      connections.request(
        "https://prism.example/telegram/tg-verify",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `${SESSION_COOKIE}=${token}; ${SOCIAL_OAUTH_COOKIE}=${correlation}`,
          },
          body: JSON.stringify({ nonce: telegramState, tg_data: {} }),
        },
        routeEnv(),
        executionCtx,
      );

    const otherSession = await request(tokenB);
    expect(await otherSession.json()).toEqual({ error: "invalid_state" });
    expect(
      sqlite
        .query(
          "SELECT COUNT(*) AS count FROM social_oauth_states WHERE state = ?",
        )
        .get(telegramState),
    ).toEqual({ count: 1 });

    const initiatingSession = await request(tokenA);
    expect(await initiatingSession.json()).toEqual({
      error: "invalid_signature",
    });
    expect(
      sqlite
        .query(
          "SELECT COUNT(*) AS count FROM social_oauth_states WHERE state = ?",
        )
        .get(telegramState),
    ).toEqual({ count: 0 });
  });

  test("a wrong browser secret does not consume browser A's state", async () => {
    const browserASecret = "a".repeat(43);
    await storeSocialOAuthState(db, {
      state,
      slug: "github",
      provider: "github",
      mode: "login",
      userId: null,
      sessionId: null,
      correlationHash: await sha256Hex(browserASecret),
      codeVerifier: null,
      now,
    });

    const stored = sqlite
      .query("SELECT correlation_hash FROM social_oauth_states WHERE state = ?")
      .get(state) as { correlation_hash: string };
    expect(stored.correlation_hash).not.toBe(browserASecret);

    const browserB = await consumeSocialOAuthState(db, {
      state,
      slug: "github",
      provider: "github",
      correlationHash: await sha256Hex("browser-b-secret"),
      sessionId: null,
      userId: null,
      now: now + 1,
    });
    expect(browserB).toBeNull();

    const browserA = await consumeSocialOAuthState(db, {
      state,
      slug: "github",
      provider: "github",
      correlationHash: await sha256Hex(browserASecret),
      sessionId: null,
      userId: null,
      now: now + 1,
    });
    expect(browserA?.state).toBe(state);

    const replay = await consumeSocialOAuthState(db, {
      state,
      slug: "github",
      provider: "github",
      correlationHash: await sha256Hex(browserASecret),
      sessionId: null,
      userId: null,
      now: now + 1,
    });
    expect(replay).toBeNull();
  });

  test("allows exactly one winner for concurrent callbacks", async () => {
    const correlationHash = await sha256Hex("browser-secret");
    await storeSocialOAuthState(db, {
      state,
      slug: "github",
      provider: "github",
      mode: "login",
      userId: null,
      sessionId: null,
      correlationHash,
      codeVerifier: null,
      now,
    });

    const callback = () =>
      consumeSocialOAuthState(db, {
        state,
        slug: "github",
        provider: "github",
        correlationHash,
        sessionId: null,
        userId: null,
        now: now + 1,
      });
    const results = await Promise.all([callback(), callback()]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test("a bearer intent establishes one session through begin and callback", async () => {
    const token = await createSessionToken("session-a");
    const cache = new MemoryKv();
    const env = routeEnv(cache);
    const intentResponse = await connections.request(
      "https://prism.example/intent",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      },
      env,
      executionCtx,
    );

    expect(intentResponse.status).toBe(200);
    const sessionCookie = (
      intentResponse.headers.get("set-cookie") ?? ""
    ).split(";", 1)[0];
    expect(sessionCookie).toBe(`${SESSION_COOKIE}=${token}`);
    const intent = (await intentResponse.json()) as { token: string };
    expect(intent.token).toMatch(/^connect:intent:[A-Za-z0-9_-]{32}$/);

    const beginResponse = await connections.request(
      `https://prism.example/github/begin?mode=connect&intent=${encodeURIComponent(intent.token)}`,
      { headers: { Cookie: sessionCookie } },
      env,
      executionCtx,
    );
    expect(beginResponse.status).toBe(200);
    const oauthCookie = (beginResponse.headers.get("set-cookie") ?? "").split(
      ";",
      1,
    )[0];
    expect(oauthCookie.startsWith(`${SOCIAL_OAUTH_COOKIE}=`)).toBeTrue();
    const { redirect } = (await beginResponse.json()) as { redirect: string };
    const issuedState = new URL(redirect).searchParams.get("state");

    const callbackResponse = await connections.request(
      `https://prism.example/github/callback?error=access_denied&state=${issuedState}`,
      { headers: { Cookie: `${sessionCookie}; ${oauthCookie}` } },
      env,
      executionCtx,
    );
    expect(callbackResponse.headers.get("location")).toBe(
      "https://prism.example/connections?error=access_denied",
    );
  });

  test("the real connect callback requires the initiating live session", async () => {
    const tokenA = await createSessionToken("session-a");
    const tokenB = await createSessionToken("session-b");
    const connectState = "c".repeat(32);
    const correlation = "c".repeat(43);
    await storeSocialOAuthState(db, {
      state: connectState,
      slug: "github",
      provider: "github",
      mode: "connect",
      userId: "user-a",
      sessionId: "session-a",
      correlationHash: await sha256Hex(correlation),
      codeVerifier: null,
      now,
    });
    const callback = `https://prism.example/github/callback?error=access_denied&state=${connectState}`;
    const cookie = (token: string) =>
      `${SESSION_COOKIE}=${token}; ${SOCIAL_OAUTH_COOKIE}=${correlation}`;

    const otherSession = await connections.request(
      callback,
      { headers: { Cookie: cookie(tokenB) } },
      routeEnv(),
      executionCtx,
    );
    expect(otherSession.headers.get("location")).toBe(
      "https://prism.example/connections?error=invalid_state",
    );
    expect(
      sqlite
        .query(
          "SELECT COUNT(*) AS count FROM social_oauth_states WHERE state = ?",
        )
        .get(connectState),
    ).toEqual({ count: 1 });

    const initiatingSession = await connections.request(
      callback,
      { headers: { Cookie: cookie(tokenA) } },
      routeEnv(),
      executionCtx,
    );
    expect(initiatingSession.headers.get("location")).toBe(
      "https://prism.example/connections?error=access_denied",
    );
    expect(
      sqlite
        .query(
          "SELECT COUNT(*) AS count FROM social_oauth_states WHERE state = ?",
        )
        .get(connectState),
    ).toEqual({ count: 0 });
  });

  test("a revoked initiating session cannot consume connect state", async () => {
    const token = await createSessionToken("session-a");
    const connectState = "r".repeat(32);
    const correlation = "r".repeat(43);
    await storeSocialOAuthState(db, {
      state: connectState,
      slug: "github",
      provider: "github",
      mode: "connect",
      userId: "user-a",
      sessionId: "session-a",
      correlationHash: await sha256Hex(correlation),
      codeVerifier: null,
      now,
    });
    sqlite.query("DELETE FROM sessions WHERE id = ?").run("session-a");

    const response = await connections.request(
      `https://prism.example/github/callback?error=access_denied&state=${connectState}`,
      {
        headers: {
          Cookie: `${SESSION_COOKIE}=${token}; ${SOCIAL_OAUTH_COOKIE}=${correlation}`,
        },
      },
      routeEnv(),
      executionCtx,
    );
    expect(response.headers.get("location")).toBe(
      "https://prism.example/connections?error=invalid_state",
    );
    expect(
      sqlite
        .query(
          "SELECT COUNT(*) AS count FROM social_oauth_states WHERE state = ?",
        )
        .get(connectState),
    ).toEqual({ count: 1 });
  });

  test("connect state requires the initiating user and live session", async () => {
    const correlationHash = await sha256Hex("browser-secret");
    await storeSocialOAuthState(db, {
      state,
      slug: "google",
      provider: "google",
      mode: "connect",
      userId: "user-a",
      sessionId: "session-a",
      correlationHash,
      codeVerifier: null,
      now,
    });

    const otherSession = await consumeSocialOAuthState(db, {
      state,
      slug: "google",
      provider: "google",
      correlationHash,
      sessionId: "session-b",
      userId: "user-a",
      now: now + 1,
    });
    expect(otherSession).toBeNull();

    const initiatingSession = await consumeSocialOAuthState(db, {
      state,
      slug: "google",
      provider: "google",
      correlationHash,
      sessionId: "session-a",
      userId: "user-a",
      now: now + 1,
    });
    expect(initiatingSession?.mode).toBe("connect");
  });

  test("caps stored state and opportunistically clears expired rows", async () => {
    sqlite
      .query(
        `WITH RECURSIVE counter(value) AS (
           VALUES(1)
           UNION ALL
           SELECT value + 1 FROM counter WHERE value < 10000
         )
         INSERT INTO social_oauth_states
           (state, slug, provider, mode, correlation_hash, expires_at, created_at)
         SELECT printf('%032d', value), 'github', 'github', 'login',
                'hash', ?, ?
           FROM counter`,
      )
      .run(now + 600, now);

    const acceptedAtCap = await storeSocialOAuthState(db, {
      state,
      slug: "github",
      provider: "github",
      mode: "login",
      userId: null,
      sessionId: null,
      correlationHash: "hash",
      codeVerifier: null,
      now,
    });
    expect(acceptedAtCap).toBeFalse();
    expect(
      sqlite.query("SELECT COUNT(*) AS count FROM social_oauth_states").get(),
    ).toEqual({ count: 10000 });

    sqlite.query("UPDATE social_oauth_states SET expires_at = ?").run(now);
    const acceptedAfterExpiry = await storeSocialOAuthState(db, {
      state,
      slug: "github",
      provider: "github",
      mode: "login",
      userId: null,
      sessionId: null,
      correlationHash: "hash",
      codeVerifier: null,
      now,
    });
    expect(acceptedAfterExpiry).toBeTrue();
    expect(
      sqlite.query("SELECT COUNT(*) AS count FROM social_oauth_states").get(),
    ).toEqual({ count: 9001 });
  });

  test("state expires after the short correlation window", async () => {
    const correlationHash = await sha256Hex("browser-secret");
    await storeSocialOAuthState(db, {
      state,
      slug: "discord",
      provider: "discord",
      mode: "login",
      userId: null,
      sessionId: null,
      correlationHash,
      codeVerifier: null,
      now,
    });

    const expired = await consumeSocialOAuthState(db, {
      state,
      slug: "discord",
      provider: "discord",
      correlationHash,
      sessionId: null,
      userId: null,
      now: now + SOCIAL_OAUTH_STATE_TTL_SECONDS,
    });
    expect(expired).toBeNull();
  });
});
