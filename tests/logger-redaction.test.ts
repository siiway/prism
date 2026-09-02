import { describe, expect, test } from "bun:test";
import { redactForLogging, redactUrlForLogging } from "../worker/lib/logger";

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
});
