import { afterEach, describe, expect, test } from "bun:test";
import {
  isBlockedHost,
  safeFetch,
  validateOutboundUrl,
} from "../worker/lib/safeFetch";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function dnsResponse(
  records: Array<{ type: number; data: string }> = [],
  status = 0,
): Response {
  return Response.json({ Status: status, Answer: records });
}

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(input instanceof Request ? input.url : input.toString());
}

describe("outbound host validation", () => {
  test.each([
    "https://[::]/",
    "https://[::1]/",
    "https://[0:0:0:0:0:0:0:1]/",
    "https://[fc00::1]/",
    "https://[fd12:3456::1]/",
    "https://[fe80::1]/",
    "https://[ff02::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://[::ffff:7f00:1]/",
    "https://[0:0:0:0:0:ffff:7f00:1]/",
    "https://[::2]/",
    "https://[::127.0.0.1]/",
    "https://[::192.168.1.1]/",
    "https://[100::1]/",
    "https://[2001:db8::1]/",
    "https://[4000::1]/",
    "https://127.1/",
    "https://2130706433/",
    "https://10.0.0.1/",
    "https://100.64.0.1/",
    "https://169.254.1.1/",
    "https://192.0.2.1/",
    "https://224.0.0.1/",
  ])("rejects non-public IP literal %s", (url) => {
    expect(validateOutboundUrl(url)).not.toBeNull();
  });

  test.each([
    "https://localhost/",
    "https://api.localhost/",
    "https://printer.local/",
    "https://service.internal/",
    "https://metadata.google.internal/",
  ])("rejects local hostname %s", (url) => {
    expect(validateOutboundUrl(url)).not.toBeNull();
  });

  test.each([
    "https://8.8.8.8/",
    "https://[::ffff:8.8.8.8]/",
    "https://[2606:4700:4700::1111]/",
    "https://example.com/",
  ])("accepts a public destination %s", (url) => {
    expect(validateOutboundUrl(url)).toBeNull();
  });

  test("rejects bare zone identifiers and malformed IPv6", () => {
    expect(isBlockedHost("fe80::1%eth0")).toBe(true);
    expect(isBlockedHost("[::1")).toBe(true);
    expect(isBlockedHost("not:an:ip")).toBe(true);
  });
});

describe("safeFetch DNS validation", () => {
  test("validates A and AAAA answers immediately before fetching", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = requestUrl(input);
      calls.push(url.toString());

      if (url.hostname === "cloudflare-dns.com") {
        const headers = new Headers(init?.headers);
        expect(headers.get("accept")).toBe("application/dns-json");
        expect(headers.has("authorization")).toBe(false);
        return url.searchParams.get("type") === "A"
          ? dnsResponse([{ type: 1, data: "93.184.216.34" }])
          : dnsResponse([
              { type: 28, data: "2606:2800:220:1:248:1893:25c8:1946" },
            ]);
      }

      expect(url.hostname).toBe("images.example.test");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer target-secret",
      );
      return new Response("ok");
    }) as typeof fetch;

    const response = await safeFetch(
      "https://images.example.test/picture.png",
      {
        headers: { Authorization: "Bearer target-secret" },
      },
    );

    expect(await response.text()).toBe("ok");
    expect(calls.map((value) => new URL(value).hostname)).toEqual([
      "cloudflare-dns.com",
      "cloudflare-dns.com",
      "images.example.test",
    ]);
  });

  test.each([
    [1, "127.0.0.1"],
    [1, "10.0.0.1"],
    [1, "169.254.169.254"],
    [28, "::1"],
    [28, "fd00::1"],
    [28, "::ffff:7f00:1"],
  ])("rejects DNS type %i answer %s", async (type, address) => {
    let targetFetched = false;
    globalThis.fetch = (async (input) => {
      const url = requestUrl(input);
      if (url.hostname === "cloudflare-dns.com") {
        const requestedType = url.searchParams.get("type");
        const matchingType = type === 1 ? "A" : "AAAA";
        return requestedType === matchingType
          ? dnsResponse([{ type, data: address }])
          : dnsResponse();
      }
      targetFetched = true;
      return new Response("unsafe");
    }) as typeof fetch;

    await expect(safeFetch("https://rebind.example.test/")).rejects.toThrow(
      "DNS resolved to a non-public address",
    );
    expect(targetFetched).toBe(false);
  });

  test("fails closed when DNS resolution fails or returns no addresses", async () => {
    globalThis.fetch = (async (input) => {
      const url = requestUrl(input);
      if (url.hostname !== "cloudflare-dns.com")
        throw new Error("target must not be fetched");
      return url.searchParams.get("type") === "A"
        ? dnsResponse([], 2)
        : dnsResponse();
    }) as typeof fetch;

    await expect(safeFetch("https://missing.example.test/")).rejects.toThrow(
      "DNS lookup failed",
    );
  });

  test("rejects a blocked CNAME even when an answer also contains a public IP", async () => {
    globalThis.fetch = (async (input) => {
      const url = requestUrl(input);
      if (url.hostname !== "cloudflare-dns.com")
        throw new Error("target must not be fetched");
      return url.searchParams.get("type") === "A"
        ? dnsResponse([
            { type: 5, data: "metadata.google.internal." },
            { type: 1, data: "93.184.216.34" },
          ])
        : dnsResponse();
    }) as typeof fetch;

    await expect(safeFetch("https://alias.example.test/")).rejects.toThrow(
      "DNS alias is not allowed",
    );
  });

  test("rejects a redirect to a bracketed private IPv6 literal", async () => {
    let targetFetchCount = 0;
    globalThis.fetch = (async (input) => {
      const url = requestUrl(input);
      if (url.hostname === "cloudflare-dns.com") {
        return url.searchParams.get("type") === "A"
          ? dnsResponse([{ type: 1, data: "93.184.216.34" }])
          : dnsResponse();
      }

      targetFetchCount++;
      return new Response(null, {
        status: 302,
        headers: { Location: "https://[::1]/secret" },
      });
    }) as typeof fetch;

    await expect(
      safeFetch("https://redirect.example.test/start"),
    ).rejects.toThrow("URL host is not allowed");
    expect(targetFetchCount).toBe(1);
  });

  test("cancels redirect bodies and preserves HEAD across a 303", async () => {
    let redirectCancelled = false;
    const methods: string[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = requestUrl(input);
      if (url.hostname === "cloudflare-dns.com") {
        return url.searchParams.get("type") === "A"
          ? dnsResponse([{ type: 1, data: "93.184.216.34" }])
          : dnsResponse();
      }

      methods.push(init?.method ?? "GET");
      if (url.pathname === "/start") {
        const body = new ReadableStream({
          cancel() {
            redirectCancelled = true;
          },
        });
        return new Response(body, {
          status: 303,
          headers: { Location: "/final" },
        });
      }
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    const response = await safeFetch("https://redirect.example.test/start", {
      method: "HEAD",
    });

    expect(response.status).toBe(200);
    expect(methods).toEqual(["HEAD", "HEAD"]);
    expect(redirectCancelled).toBe(true);
  });

  test("re-resolves a hostname and blocks rebinding at a redirect hop", async () => {
    let aLookupCount = 0;
    let targetFetchCount = 0;
    globalThis.fetch = (async (input) => {
      const url = requestUrl(input);
      if (url.hostname === "cloudflare-dns.com") {
        if (url.searchParams.get("type") === "AAAA") return dnsResponse();
        aLookupCount++;
        return aLookupCount === 1
          ? dnsResponse([{ type: 1, data: "93.184.216.34" }])
          : dnsResponse([{ type: 1, data: "127.0.0.1" }]);
      }

      targetFetchCount++;
      return new Response(null, {
        status: 302,
        headers: { Location: "/after-redirect" },
      });
    }) as typeof fetch;

    await expect(
      safeFetch("https://rebind.example.test/start"),
    ).rejects.toThrow("DNS resolved to a non-public address");
    expect(aLookupCount).toBe(2);
    expect(targetFetchCount).toBe(1);
  });
});
