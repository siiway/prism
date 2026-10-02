import { describe, expect, test } from "bun:test";
import {
  MAX_INVITE_EXPIRY_SECONDS,
  parseInviteExpiry,
} from "../worker/lib/inviteExpiry";

describe("team invite expiry", () => {
  test("accepts every supported value/unit pair", () => {
    expect(
      parseInviteExpiry({ expires_in_value: 2, expires_in_unit: "days" }, 100),
    ).toEqual({ ok: true, expiresAt: 172900, value: 2, unit: "days" });
    expect(
      parseInviteExpiry(
        { expires_in_value: 2, expires_in_unit: "months" },
        100,
      ),
    ).toEqual({
      ok: true,
      expiresAt: 100 + 2 * 30 * 24 * 60 * 60,
      value: 2,
      unit: "months",
    });
    expect(
      parseInviteExpiry({ expires_in_value: 1, expires_in_unit: "years" }, 100),
    ).toEqual({
      ok: true,
      expiresAt: 100 + 365 * 24 * 60 * 60,
      value: 1,
      unit: "years",
    });
  });

  test("preserves ttl_hours and expires_in_hours compatibility", () => {
    expect(parseInviteExpiry({ ttl_hours: 12 }, 0)).toEqual({
      ok: true,
      expiresAt: 12 * 60 * 60,
      value: 12,
      unit: "hours",
    });
    expect(parseInviteExpiry({ expires_in_hours: 24 }, 0)).toEqual({
      ok: true,
      expiresAt: 24 * 60 * 60,
      value: 24,
      unit: "hours",
    });
  });

  test("rejects partial, fractional, and excessive expiry values", () => {
    expect(parseInviteExpiry({ expires_in_value: 2 }, 0).ok).toBe(false);
    expect(
      parseInviteExpiry({ expires_in_value: 1.5, expires_in_unit: "days" }, 0)
        .ok,
    ).toBe(false);
    expect(
      parseInviteExpiry(
        {
          expires_in_value: MAX_INVITE_EXPIRY_SECONDS / 3600 + 1,
          expires_in_unit: "hours",
        },
        0,
      ).ok,
    ).toBe(false);
  });
});
