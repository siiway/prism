import { describe, expect, test } from "bun:test";
import {
  MAX_INVITE_EXPIRY_SECONDS,
  parseInviteExpiry,
} from "../worker/lib/inviteExpiry";

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
