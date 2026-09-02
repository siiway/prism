import { afterEach, describe, expect, test } from "bun:test";
import proxyRoutes from "../worker/routes/proxy";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(input instanceof Request ? input.url : input.toString());
}

describe("image proxy body limit", () => {
  test("rejects a declared oversized image and cancels it without reading", async () => {
    let cancelled = false;
    let targetFetches = 0;
    const upstreamBody = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });

    globalThis.fetch = (async (input) => {
      const url = requestUrl(input);
      if (url.hostname === "cloudflare-dns.com") {
        return url.searchParams.get("type") === "A"
          ? Response.json({
              Status: 0,
              Answer: [{ type: 1, data: "93.184.216.34" }],
            })
          : Response.json({ Status: 0, Answer: [] });
      }

      targetFetches++;
      return new Response(upstreamBody, {
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(5 * 1024 * 1024 + 1),
        },
      });
    }) as typeof fetch;

    const env = {
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => ({
              url: "https://images.example.test/oversized.png",
            }),
          }),
        }),
      },
    } as unknown as Env;
    const response = await proxyRoutes.request(
      `https://prism.example.test/${"a".repeat(32)}`,
      undefined,
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Image exceeds the 5 MB size limit",
    });
    expect(targetFetches).toBe(1);
    expect(cancelled).toBe(true);
  });

  test("cuts off a chunked image whose Content-Length is missing", async () => {
    let cancelled = false;
    let chunksSent = 0;
    globalThis.fetch = (async (input) => {
      const url = requestUrl(input);
      if (url.hostname === "cloudflare-dns.com") {
        return url.searchParams.get("type") === "A"
          ? Response.json({
              Status: 0,
              Answer: [{ type: 1, data: "93.184.216.34" }],
            })
          : Response.json({ Status: 0, Answer: [] });
      }

      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            chunksSent++;
            controller.enqueue(new Uint8Array(1024 * 1024));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "Content-Type": "image/png" } },
      );
    }) as typeof fetch;

    const env = {
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => ({
              url: "https://images.example.test/chunked.png",
            }),
          }),
        }),
      },
    } as unknown as Env;
    const response = await proxyRoutes.request(
      `https://prism.example.test/${"b".repeat(32)}`,
      undefined,
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.arrayBuffer()).rejects.toThrow(
      "Body exceeds the 5242880-byte limit",
    );
    expect(chunksSent).toBeLessThanOrEqual(7);
    expect(cancelled).toBe(true);
  });
});
