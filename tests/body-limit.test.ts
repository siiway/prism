import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import {
  BodySizeLimitError,
  declaredLengthExceedsLimit,
  limitStreamBytes,
  readStreamWithLimit,
} from "../worker/lib/bodyLimit";
import { bodySizeLimit } from "../worker/middleware/bodyLimit";

function chunkedStream(
  chunks: number[],
  onCancel?: () => void,
): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      const chunkSize = chunks[Math.min(index, chunks.length - 1)];
      index++;
      controller.enqueue(new Uint8Array(chunkSize));
    },
    cancel() {
      onCancel?.();
    },
  });
}

describe("bounded body utilities", () => {
  test("handles very large declared lengths without numeric overflow", () => {
    expect(declaredLengthExceedsLimit("5", 5)).toBe(false);
    expect(declaredLengthExceedsLimit("6", 5)).toBe(true);
    expect(
      declaredLengthExceedsLimit("999999999999999999999999999999", 5),
    ).toBe(true);
    expect(declaredLengthExceedsLimit("6x", 5)).toBe(false);
  });

  test("bounded reads discard partial data and cancel on overflow", async () => {
    let cancelled = false;
    const result = await readStreamWithLimit(
      chunkedStream([4, 3], () => {
        cancelled = true;
      }),
      5,
    );

    expect(result).toEqual({ exceeded: true, bytes: null });
    expect(cancelled).toBe(true);
  });

  test("streaming limits forward bounded data and cancel on overflow", async () => {
    let cancelled = false;
    const limited = limitStreamBytes(
      chunkedStream([4, 3], () => {
        cancelled = true;
      }),
      5,
    );

    await expect(new Response(limited).arrayBuffer()).rejects.toBeInstanceOf(
      BodySizeLimitError,
    );
    expect(cancelled).toBe(true);
  });

  test("allows an exact-limit body and propagates downstream cancellation", async () => {
    const exactBody = new Response(new Uint8Array(5)).body;
    if (!exactBody) throw new Error("test response did not expose a body");
    expect(
      new Uint8Array(
        await new Response(limitStreamBytes(exactBody, 5)).arrayBuffer(),
      ).byteLength,
    ).toBe(5);

    let cancelled = false;
    const reader = limitStreamBytes(
      chunkedStream([1], () => {
        cancelled = true;
      }),
      5,
    ).getReader();
    await reader.cancel("client disconnected");
    expect(cancelled).toBe(true);
  });

  test("concurrent oversized streams are each cancelled at their cap", async () => {
    const chunkCounts = Array.from({ length: 8 }, () => 0);
    let cancellations = 0;
    const reads = chunkCounts.map(async (_, index) => {
      const source = new ReadableStream<Uint8Array>({
        pull(controller) {
          chunkCounts[index]++;
          controller.enqueue(new Uint8Array(1024));
        },
        cancel() {
          cancellations++;
        },
      });
      await new Response(limitStreamBytes(source, 4096)).arrayBuffer();
    });

    const results = await Promise.allSettled(reads);

    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(cancellations).toBe(8);
    expect(chunkCounts.every((count) => count <= 6)).toBe(true);
  });
});

describe("global request body limit", () => {
  test("rejects an undeclared streaming body when a handler reads past the cap", async () => {
    let cancelled = false;
    const app = new Hono();
    app.use("*", bodySizeLimit(5));
    app.post("/", async (c) => c.text(await c.req.text()));
    app.onError((error, c) =>
      error instanceof BodySizeLimitError
        ? c.json({ error: "Request body too large" }, 413)
        : c.json({ error: "Internal server error" }, 500),
    );

    const request = new Request("https://example.test/", {
      method: "POST",
      body: chunkedStream([4, 3], () => {
        cancelled = true;
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const response = await app.request(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Request body too large" });
    expect(cancelled).toBe(true);
  });

  test("overrides a route that mistakes a size error for malformed input", async () => {
    const app = new Hono();
    app.use("*", bodySizeLimit(5));
    app.post("/", async (c) => {
      try {
        await c.req.json();
        return c.text("unreachable");
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
    });

    const request = new Request("https://example.test/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: chunkedStream([4, 3]),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const response = await app.request(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Request body too large" });
  });

  test("rejects an excessive Content-Length before reading the body", async () => {
    let cancelled = false;
    const app = new Hono();
    app.use("*", bodySizeLimit(5));
    app.post("/", async (c) => c.text(await c.req.text()));

    const request = new Request("https://example.test/", {
      method: "POST",
      headers: { "Content-Length": "6" },
      body: chunkedStream([1], () => {
        cancelled = true;
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const response = await app.request(request);

    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
  });

  test("oversized API responses retain CORS and security headers", async () => {
    const app = new Hono();
    app.use("*", secureHeaders());
    app.use(
      "/api/*",
      cors({
        origin: "https://app.example.test",
        credentials: true,
      }),
    );
    app.use("*", bodySizeLimit(5));
    app.post("/api/upload", (c) => c.text("unreachable"));

    const request = new Request("https://api.example.test/api/upload", {
      method: "POST",
      headers: {
        "Content-Length": "6",
        Origin: "https://app.example.test",
      },
      body: chunkedStream([1]),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const response = await app.request(request);

    expect(response.status).toBe(413);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.test",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
