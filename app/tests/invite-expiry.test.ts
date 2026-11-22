import { describe, expect, test } from "bun:test";
import {
  inviteExpiryFromDays,
  MAX_INVITE_EXPIRY_SECONDS,
  parseInviteExpiry,
} from "../src/worker/lib/inviteExpiry";

describe("team invite expiry", () => {
  test("accepts an absolute future Unix timestamp", () => {
    expect(parseInviteExpiry(172900, 100)).toEqual({
      ok: true,
      expiresAt: 172900,
    });
  });

  test("rejects missing, fractional, and expired timestamps", () => {
    expect(parseInviteExpiry(undefined, 100).ok).toBe(false);
    expect(parseInviteExpiry(100.5, 100).ok).toBe(false);
    expect(parseInviteExpiry(100, 100).ok).toBe(false);
    expect(parseInviteExpiry(99, 100).ok).toBe(false);
  });

  test("rejects timestamps more than ten years away", () => {
    expect(parseInviteExpiry(MAX_INVITE_EXPIRY_SECONDS + 1, 0).ok).toBe(false);
  });
});

describe("inviteExpiryFromDays", () => {
  const now = 1_000_000;
  test("left out, the invite doesn't expire", () => {
    expect(inviteExpiryFromDays(undefined, now)).toEqual({
      ok: true,
      expiresAt: null,
    });
  });
  test("takes a whole number of days", () => {
    expect(inviteExpiryFromDays(7, now)).toEqual({
      ok: true,
      expiresAt: now + 7 * 86400,
    });
    for (const bad of [0, -1, 1.5, "7", 3651])
      expect(inviteExpiryFromDays(bad, now)).toMatchObject({
        ok: false,
        error: "field_int_range",
      });
  });
});
