import { describe, expect, test } from "bun:test";
import {
  redirectUriMatchesRegistered,
  validateRedirectUriEntry,
} from "../src/worker/lib/redirectUri";

const matches = (pattern: string, candidate: string) =>
  redirectUriMatchesRegistered(candidate, [
    { type: "wildcard", value: pattern },
  ]);

describe("wildcard redirect URIs", () => {
  test("a host wildcard matches subdomains", () => {
    expect(
      matches(
        "https://*.example.com/callback",
        "https://a.example.com/callback",
      ),
    ).toBe(true);
    expect(
      matches(
        "https://pr-*.example.com/callback",
        "https://pr-12.example.com/callback",
      ),
    ).toBe(true);
  });

  test("a host wildcard never reaches another host", () => {
    for (const candidate of [
      "https://evil.com/?.example.com/callback",
      "https://evil.com/.example.com/callback",
      "https://evil.com/x?a=.example.com/callback",
      "https://a.b.example.com/callback",
    ])
      expect(matches("https://*.example.com/callback", candidate)).toBe(false);
    expect(
      matches("https://app.example.com*", "https://app.example.com.evil.com/x"),
    ).toBe(false);
  });

  test("the path and query still glob freely", () => {
    expect(
      matches("https://example.com/*", "https://example.com/a/b?c=d"),
    ).toBe(true);
    expect(
      matches("https://example.com/cb/*", "https://example.com/other"),
    ).toBe(false);
  });

  test("the port must match unless it is a wildcard", () => {
    expect(matches("http://localhost:*/cb", "http://localhost:5173/cb")).toBe(
      true,
    );
    expect(
      matches("https://example.com/cb", "https://example.com:8443/cb"),
    ).toBe(false);
    expect(
      matches("https://example.com:443/cb", "https://example.com/cb"),
    ).toBe(true);
  });

  test("a * ending the host also covers the path, as it always did", () => {
    expect(
      matches("http://localhost:*", "http://localhost:3000/callback"),
    ).toBe(true);
    expect(matches("https://example.com*", "https://example.com/cb?x=1")).toBe(
      true,
    );
    expect(
      matches("https://example.com*", "https://example.com.evil.com/cb"),
    ).toBe(false);
    expect(matches("https://*.example.com", "https://a.example.com/cb")).toBe(
      false,
    );
  });

  test("a query without a path is the root's query", () => {
    expect(matches("https://example.com?x=*", "https://example.com/?x=1")).toBe(
      true,
    );
  });

  test("the scheme must match", () => {
    expect(matches("https://localhost/cb", "http://localhost/cb")).toBe(false);
  });

  test("a pattern runs in linear time", () => {
    const started = performance.now();
    matches(
      `https://example.com/${"*a".repeat(30)}b`,
      `https://example.com/${"a".repeat(2000)}`,
    );
    expect(performance.now() - started).toBeLessThan(500);
  });

  test("registration refuses patterns that could match any host", () => {
    const reason = (value: string) =>
      validateRedirectUriEntry({ type: "wildcard", value });
    expect(reason("https://*/cb")).toBe("wildcard_host");
    expect(reason("https://*.*/cb")).toBe("wildcard_host");
    expect(reason("https://*.com/cb")).toBe("wildcard_host");
    expect(reason("https://a*.*/cb")).toBe("wildcard_host");
    expect(reason("https://app.*.com/cb")).toBe("wildcard_host");
    expect(reason("https://pr-*.example.com/cb")).toBeNull();
    expect(reason("https://example.com*")).toBeNull();
    expect(reason("https://user@*.example.com/cb")).toBe("userinfo");
    expect(reason("ftp://*.example.com/cb")).toBe("scheme");
    expect(reason("https://*.example.com:x/cb")).toBe("not_url");
    expect(reason("https://*.example.com/cb")).toBeNull();
    expect(reason("http://localhost:*/cb")).toBeNull();
  });
});
