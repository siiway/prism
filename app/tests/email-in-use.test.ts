import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import authRoutes from "../src/worker/routes/auth";
import {
  emailInUse,
  emailOwnedElsewhere,
} from "../src/worker/lib/accountEmails";
import { hashPassword } from "../src/worker/lib/crypto";
import { signJWT } from "../src/worker/lib/jwt";
import { SESSION_COOKIE } from "../src/worker/lib/cookies";
import { newEmailVerifyToken } from "../src/worker/lib/emailVerifyToken";
import { d1, executionCtx, MemoryKv, migratedDatabase } from "./setup/d1";

let sqlite: Database;

beforeEach(() => {
  sqlite = migratedDatabase();
  const now = Math.floor(Date.now() / 1000);
  sqlite.run(
    `INSERT INTO users (id, username, email, created_at, updated_at)
     VALUES ('victim', 'victim', 'victim@example.com', ?, ?)`,
    [now, now],
  );
  sqlite.run(
    `INSERT INTO user_emails (id, user_id, email, verified, created_at)
     VALUES ('e1', 'victim', 'alt@example.com', 1, ?)`,
    [now],
  );
});

afterEach(() => sqlite.close());

const jwtSecret = "test-jwt-secret-email-in-use";

/** Open a verification link, signed in as `asUser` if given. */
async function openLink(query: string, asUser?: string) {
  const headers: Record<string, string> = {};
  if (asUser) {
    sqlite.run(
      "INSERT OR IGNORE INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, 9999999999, 0)",
      [`s-${asUser}`, asUser, `h-${asUser}`],
    );
    const jwt = await signJWT(
      {
        sub: asUser,
        role: "user",
        sessionId: `s-${asUser}`,
        email: `${asUser}@example.com`,
        username: asUser,
        display_name: asUser,
        avatar_url: null,
      },
      jwtSecret,
      3600,
    );
    headers.Cookie = `${SESSION_COOKIE}=${jwt}`;
  }
  const app = new Hono();
  app.route("/api/auth", authRoutes);
  return app.fetch(
    new Request(`https://prism.example/api/auth/verify-email?${query}`, {
      headers,
    }),
    {
      DB: d1(sqlite),
      APP_URL: "https://prism.example",
      KV_CACHE: new MemoryKv() as unknown as KVNamespace,
      KV_SESSIONS: new MemoryKv({
        "system:jwt_secret": jwtSecret,
      }) as unknown as KVNamespace,
    } as unknown as Env,
    executionCtx,
  );
}

describe("email addresses belong to one account", () => {
  test("primary and alternate addresses both count", async () => {
    const db = d1(sqlite);
    expect(await emailInUse(db, "victim@example.com")).toBe(true);
    expect(await emailInUse(db, "alt@example.com")).toBe(true);
    expect(await emailInUse(db, "free@example.com")).toBe(false);
    expect(await emailInUse(db, " Alt@Example.COM ")).toBe(true);
    expect(await emailInUse(db, "alt@example.com", "victim")).toBe(false);
  });

  test("sign-in prefers a verified alternate over an unverified primary", async () => {
    const now = Math.floor(Date.now() / 1000);
    sqlite.run("UPDATE users SET password_hash = ? WHERE id = 'victim'", [
      await hashPassword("victim-password"),
    ]);
    // An account that took the address before sign-up checked alternates,
    // written before migration 0093 would have refused it.
    sqlite.exec("DROP TRIGGER users_email_not_another_accounts_insert");
    sqlite.run(
      `INSERT INTO users (id, username, email, email_verified, password_hash, created_at, updated_at)
       VALUES ('squatter', 'squatter', 'alt@example.com', 0, ?, ?, ?)`,
      [await hashPassword("squatter-password"), now, now],
    );
    const app = new Hono();
    app.route("/api/auth", authRoutes);
    const res = await app.fetch(
      new Request("https://prism.example/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: "alt@example.com",
          password: "victim-password",
        }),
      }),
      {
        DB: d1(sqlite),
        APP_URL: "https://prism.example",
        KV_CACHE: new MemoryKv() as unknown as KVNamespace,
        KV_SESSIONS: new MemoryKv() as unknown as KVNamespace,
      } as unknown as Env,
      executionCtx,
    );
    expect(res.status).toBe(200);
    const session = sqlite.query("SELECT user_id FROM sessions").get() as {
      user_id: string;
    };
    expect(session.user_id).toBe("victim");
  });

  test("sign-up refuses another account's alternate address", async () => {
    const app = new Hono();
    app.route("/api/auth", authRoutes);
    const res = await app.fetch(
      new Request("https://prism.example/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "Alt@Example.com",
          username: "squatter",
          password: "a-long-enough-password",
        }),
      }),
      {
        DB: d1(sqlite),
        APP_URL: "https://prism.example",
        KV_CACHE: new MemoryKv() as unknown as KVNamespace,
        KV_SESSIONS: new MemoryKv() as unknown as KVNamespace,
      } as unknown as Env,
      executionCtx,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "email_or_username_taken",
    });
    const squatter = sqlite
      .query("SELECT id FROM users WHERE username = 'squatter'")
      .get();
    expect(squatter).toBeNull();
  });
});

test("sign-in without an identifier is a field error, not a crash", async () => {
  const app = new Hono();
  app.route("/api/auth", authRoutes);
  const res = await app.fetch(
    new Request("https://prism.example/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "x" }),
    }),
    {
      DB: d1(sqlite),
      APP_URL: "https://prism.example",
      KV_CACHE: new MemoryKv() as unknown as KVNamespace,
      KV_SESSIONS: new MemoryKv() as unknown as KVNamespace,
    } as unknown as Env,
    executionCtx,
  );
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: "fields_required" });
});

test("sign-up refuses an overlong display name", async () => {
  const app = new Hono();
  app.route("/api/auth", authRoutes);
  const res = await app.fetch(
    new Request("https://prism.example/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "new@example.com",
        username: "newbie",
        password: "a-long-enough-password",
        display_name: "x".repeat(65),
      }),
    }),
    {
      DB: d1(sqlite),
      APP_URL: "https://prism.example",
      KV_CACHE: new MemoryKv() as unknown as KVNamespace,
      KV_SESSIONS: new MemoryKv() as unknown as KVNamespace,
    } as unknown as Env,
    executionCtx,
  );
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: "field_length" });
  expect(
    sqlite.query("SELECT id FROM users WHERE username = 'newbie'").get(),
  ).toBeNull();
});

test("sign-up with a blank display name uses the username", async () => {
  const app = new Hono();
  app.route("/api/auth", authRoutes);
  const res = await app.fetch(
    new Request("https://prism.example/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "blank@example.com",
        username: "blankname",
        password: "a-long-enough-password",
        display_name: "",
      }),
    }),
    {
      DB: d1(sqlite),
      APP_URL: "https://prism.example",
      KV_CACHE: new MemoryKv() as unknown as KVNamespace,
      KV_SESSIONS: new MemoryKv() as unknown as KVNamespace,
    } as unknown as Env,
    executionCtx,
  );
  expect(res.status).toBeLessThan(300);
  const row = sqlite
    .query("SELECT display_name FROM users WHERE username = 'blankname'")
    .get() as { display_name: string };
  expect(row.display_name).toBe("blankname");
});

test("someone's unverified alternate doesn't block the owner's sign-up", async () => {
  sqlite.run(
    `INSERT INTO user_emails (id, user_id, email, verified, created_at)
     VALUES ('e2', 'victim', 'claimed@example.com', 0, 0)`,
  );
  expect(await emailInUse(d1(sqlite), "claimed@example.com")).toBe(false);
});

test("an alternate can't be verified once another account owns the address", async () => {
  const token = newEmailVerifyToken();
  sqlite.run(
    `INSERT INTO user_emails (id, user_id, email, verified, verify_token, created_at)
     VALUES ('e3', 'victim', 'late@example.com', 0, ?, 0)`,
    [token],
  );
  sqlite.run(
    `INSERT INTO users (id, username, email, email_verified, created_at, updated_at)
     VALUES ('other', 'other', 'late@example.com', 1, 0, 0)`,
  );
  const res = await openLink(
    `alt=1&token=${encodeURIComponent(token)}`,
    "victim",
  );
  expect(res.headers.get("Location")).toContain("status=taken");
  expect(
    (
      sqlite
        .query("SELECT verified FROM user_emails WHERE id = 'e3'")
        .get() as {
        verified: number;
      }
    ).verified,
  ).toBe(0);
});

test("an unverified sign-up doesn't keep the owner from verifying the address", async () => {
  const altToken = newEmailVerifyToken();
  const primaryToken = newEmailVerifyToken();
  sqlite.run(
    `INSERT INTO user_emails (id, user_id, email, verified, verify_token, created_at)
     VALUES ('e4', 'victim', 'mine@example.com', 0, ?, 0)`,
    [altToken],
  );
  // Someone signed up with the owner's address and never confirmed it.
  sqlite.run(
    `INSERT INTO users (id, username, email, email_verify_token, created_at, updated_at)
     VALUES ('squatter', 'squatter', 'mine@example.com', ?, 0, 0)`,
    [primaryToken],
  );
  expect(
    await emailOwnedElsewhere(d1(sqlite), "mine@example.com", "victim"),
  ).toBe(false);
  const owner = await openLink(
    `alt=1&token=${encodeURIComponent(altToken)}`,
    "victim",
  );
  expect(owner.headers.get("Location")).toContain("status=success");
  // Once the owner has it, the squatter's primary can't be verified.
  const squatter = await openLink(`token=${encodeURIComponent(primaryToken)}`);
  expect(squatter.headers.get("Location")).toContain("status=taken");
  expect(
    sqlite
      .query("SELECT email_verified FROM users WHERE id = 'squatter'")
      .get(),
  ).toEqual({ email_verified: 0 });
});

test("an alternate's link does nothing unless its own account opens it", async () => {
  // Someone else added the address; its owner gets the link.
  const token = newEmailVerifyToken();
  sqlite.run(
    "INSERT INTO users (id, username, email, created_at, updated_at) VALUES ('other', 'other', 'other@example.com', 0, 0)",
  );
  sqlite.run(
    `INSERT INTO user_emails (id, user_id, email, verified, verify_token, created_at)
     VALUES ('e5', 'other', 'victim2@example.com', 0, ?, 0)`,
    [token],
  );
  const query = `alt=1&token=${encodeURIComponent(token)}`;
  for (const viewer of [undefined, "victim"]) {
    const res = await openLink(query, viewer);
    expect(res.headers.get("Location")).toContain("status=wrong_account");
  }
  expect(
    sqlite.query("SELECT verified FROM user_emails WHERE id = 'e5'").get(),
  ).toEqual({ verified: 0 });
  // The account that added it can still use it.
  const res = await openLink(query, "other");
  expect(res.headers.get("Location")).toContain("status=success");
});

test("passkey sign-in by email finds the address's owner, not a squatter", async () => {
  sqlite.exec("DROP TRIGGER users_email_not_another_accounts_insert");
  sqlite.exec(`
    UPDATE users SET alt_email_login = 1 WHERE id = 'victim';
    INSERT INTO users (id, username, email, email_verified, created_at, updated_at)
      VALUES ('squatter', 'squatter', 'alt@example.com', 0, 0, 0);
    INSERT INTO passkeys (id, user_id, credential_id, public_key, created_at) VALUES
      ('p1', 'victim', 'dmljdGltLWtleQ', 'pk', 0),
      ('p2', 'squatter', 'c3F1YXR0ZXIta2V5', 'pk', 0);
  `);
  const app = new Hono();
  app.route("/api/auth", authRoutes);
  const res = await app.fetch(
    new Request("https://prism.example/api/auth/passkey/auth/begin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alt@example.com" }),
    }),
    {
      DB: d1(sqlite),
      APP_URL: "https://prism.example",
      KV_CACHE: new MemoryKv() as unknown as KVNamespace,
      KV_SESSIONS: new MemoryKv() as unknown as KVNamespace,
    } as unknown as Env,
    executionCtx,
  );
  const text = JSON.stringify(await res.json());
  expect(text).toContain("dmljdGltLWtleQ");
  expect(text).not.toContain("c3F1YXR0ZXIta2V5");
});

test("the verification status says when another account has the address", async () => {
  // The victim's primary is unverified, and another account verified it
  // as an alternate meanwhile.
  sqlite.exec(`
    INSERT INTO users (id, username, email, created_at, updated_at)
      VALUES ('late', 'late', 'late@example.com', 0, 0);
    INSERT INTO user_emails (id, user_id, email, verified, created_at)
      VALUES ('e6', 'late', 'victim@example.com', 1, 0);
    INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
      VALUES ('s-status', 'victim', 'h-status', 9999999999, 0);
  `);
  const jwt = await signJWT(
    {
      sub: "victim",
      role: "user",
      sessionId: "s-status",
      email: "victim@example.com",
      username: "victim",
      display_name: "victim",
      avatar_url: null,
    },
    jwtSecret,
    3600,
  );
  const app = new Hono();
  app.route("/api/auth", authRoutes);
  const res = await app.fetch(
    new Request("https://prism.example/api/auth/check-email-verification", {
      method: "POST",
      headers: { Cookie: `${SESSION_COOKIE}=${jwt}` },
    }),
    {
      DB: d1(sqlite),
      APP_URL: "https://prism.example",
      KV_CACHE: new MemoryKv() as unknown as KVNamespace,
      KV_SESSIONS: new MemoryKv({
        "system:jwt_secret": jwtSecret,
      }) as unknown as KVNamespace,
    } as unknown as Env,
    executionCtx,
  );
  expect(await res.json()).toEqual({ verified: false, taken: true });
});
