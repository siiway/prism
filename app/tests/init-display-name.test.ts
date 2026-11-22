import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import initRoutes from "../src/worker/routes/init";
import { d1, executionCtx, MemoryKv, migratedDatabase } from "./setup/d1";

let sqlite: Database;

beforeEach(() => {
  sqlite = migratedDatabase();
});

afterEach(() => sqlite.close());

describe("first-run setup", () => {
  test("a blank display name falls back to the username", async () => {
    const app = new Hono();
    app.route("/api/init", initRoutes);
    const res = await app.fetch(
      new Request("https://prism.example/api/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "admin@example.com",
          username: "admin",
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
    expect(
      (
        sqlite.query("SELECT display_name FROM users").get() as {
          display_name: string;
        }
      ).display_name,
    ).toBe("admin");
  });
});
