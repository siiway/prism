import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import authRoutes from "../src/worker/routes/auth";
import {
  emailVerifyTokenFresh,
  newEmailVerifyToken,
} from "../src/worker/lib/emailVerifyToken";
import { d1, executionCtx, MemoryKv, migratedDatabase } from "./setup/d1";

const now = Math.floor(Date.now() / 1000);
let sqlite: Database;

beforeEach(() => {
  sqlite = migratedDatabase();
});

afterEach(() => sqlite.close());

async function verify(token: string) {
  sqlite.run(
    `INSERT INTO users (id, username, email, email_verified, email_verify_token, created_at, updated_at)
     VALUES ('u', 'u', 'u@example.com', 0, ?, ?, ?)`,
    [token, now, now],
  );
  const app = new Hono();
  app.route("/api/auth", authRoutes);
  const res = await app.fetch(
    new Request(
      `https://prism.example/api/auth/verify-email?token=${encodeURIComponent(token)}`,
    ),
    {
      DB: d1(sqlite),
      APP_URL: "https://prism.example",
      KV_CACHE: new MemoryKv() as unknown as KVNamespace,
      KV_SESSIONS: new MemoryKv() as unknown as KVNamespace,
    } as unknown as Env,
    executionCtx,
  );
  const verified = (
    sqlite.query("SELECT email_verified FROM users WHERE id = 'u'").get() as {
      email_verified: number;
    }
  ).email_verified;
  return { location: res.headers.get("Location"), verified };
}

describe("email verification links", () => {
  test("last 24 hours", () => {
    expect(emailVerifyTokenFresh(newEmailVerifyToken(now), now)).toBe(true);
    expect(emailVerifyTokenFresh(newEmailVerifyToken(now - 86400), now)).toBe(
      true,
    );
    expect(emailVerifyTokenFresh(newEmailVerifyToken(now - 86401), now)).toBe(
      false,
    );
    expect(emailVerifyTokenFresh("no-issue-time", now)).toBe(false);
  });

  test("a fresh link verifies the address", async () => {
    const { location, verified } = await verify(newEmailVerifyToken());
    expect(location).toContain("status=success");
    expect(verified).toBe(1);
  });

  test("an old link doesn't", async () => {
    const { location, verified } = await verify(
      newEmailVerifyToken(now - 2 * 86400),
    );
    expect(location).toContain("status=expired");
    expect(verified).toBe(0);
  });
});
