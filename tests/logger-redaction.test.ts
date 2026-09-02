import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { Variables } from "../worker/types";
import {
  redactForLogging,
  redactUrlForLogging,
  requestLogger,
} from "../worker/lib/logger";

describe("request logger redaction", () => {
  test("redacts sensitive fields recursively in objects and arrays", () => {
    const redacted = redactForLogging({
      app: {
        client_id: "public-id",
        client_secret: "nested-secret",
        registration_access_token: "registration-secret",
        clientSecret: "camel-case-secret",
        credentials: [
          { access_token: "access-secret" },
          { profile: { password: "password-secret", name: "visible" } },
        ],
      },
    });

    expect(redacted).toEqual({
      app: {
        client_id: "public-id",
        client_secret: "[REDACTED]",
        registration_access_token: "[REDACTED]",
        clientSecret: "[REDACTED]",
        credentials: [
          { access_token: "[REDACTED]" },
          { profile: { password: "[REDACTED]", name: "visible" } },
        ],
      },
    });
    expect(JSON.stringify(redacted)).not.toContain("nested-secret");
    expect(JSON.stringify(redacted)).not.toContain("registration-secret");
    expect(JSON.stringify(redacted)).not.toContain("camel-case-secret");
    expect(JSON.stringify(redacted)).not.toContain("access-secret");
    expect(JSON.stringify(redacted)).not.toContain("password-secret");
  });

  test("redacts sensitive URL query parameters", () => {
    const redacted = new URL(
      redactUrlForLogging(
        "https://example.test/hook?client_secret=query-secret&invite=invite-secret&event=created",
      ),
    );

    expect(redacted.searchParams.get("client_secret")).toBe("[REDACTED]");
    expect(redacted.searchParams.get("invite")).toBe("[REDACTED]");
    expect(redacted.searchParams.get("event")).toBe("created");
    expect(redacted.toString()).not.toContain("query-secret");
    expect(redacted.toString()).not.toContain("invite-secret");
  });

  test("does not clone request bodies when request logging is disabled", async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use("*", requestLogger);
    app.post("/", (c) => c.text("ok"));

    const request = new Request("https://example.test/", {
      method: "POST",
      body: "body that must not be cloned",
    });
    const originalClone = request.clone.bind(request);
    let cloned = false;
    Object.defineProperty(request, "clone", {
      value: () => {
        cloned = true;
        return originalClone();
      },
    });

    const env = {
      KV_SESSIONS: {
        get: async () => null,
      },
    } as unknown as Env;
    const executionCtx = {
      waitUntil: () => undefined,
    } as unknown as ExecutionContext;

    const response = await app.fetch(request, env, executionCtx);

    expect(response.status).toBe(200);
    expect(cloned).toBe(false);
  });

  test("omits a long-lived response body without delaying the response", async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use("*", requestLogger);
    app.post(
      "/",
      () =>
        new Response(
          new ReadableStream({
            pull() {
              // Intentionally remain open without producing a chunk.
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );

    let boundValues: unknown[] = [];
    const backgroundTasks: Promise<unknown>[] = [];
    const env = {
      KV_SESSIONS: {
        get: async (key: string) => {
          if (key === "system:request_logging_enabled") return "true";
          if (key === "system:force_log_all") return "true";
          return null;
        },
      },
      DB: {
        prepare: () => ({
          bind: (...values: unknown[]) => {
            boundValues = values;
            return {
              run: async () => undefined,
            };
          },
        }),
      },
    } as unknown as Env;
    const executionCtx = {
      waitUntil: (task: Promise<unknown>) => backgroundTasks.push(task),
    } as unknown as ExecutionContext;

    const response = await Promise.race([
      app.fetch(
        new Request("https://example.test/", {
          method: "POST",
          body: "small request",
        }),
        env,
        executionCtx,
      ),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 50)),
    ]);

    expect(response).not.toBeNull();
    if (!response) throw new Error("logger delayed the streaming response");
    expect(backgroundTasks).toHaveLength(1);
    await Promise.all(backgroundTasks);

    const details = JSON.parse(String(boundValues[9])) as {
      res: { body: string };
    };
    expect(details.res.body).toBe("[OMITTED: BODY DID NOT COMPLETE PROMPTLY]");
    await response.body?.cancel();
  });
});
