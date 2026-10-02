import { describe, expect, test } from "bun:test";
import {
  absoluteInviteExpiry,
  relativeInviteExpiry,
} from "../src/lib/inviteExpiry";

describe("invite expiry input", () => {
  test("calculates relative calendar units in the browser", () => {
    const now = new Date(2026, 0, 15, 12, 0, 0);
    expect(relativeInviteExpiry(now, 2, "hours")?.getHours()).toBe(14);
    expect(relativeInviteExpiry(now, 2, "days")?.getDate()).toBe(17);
    expect(relativeInviteExpiry(now, 2, "months")?.getMonth()).toBe(2);
    expect(relativeInviteExpiry(now, 2, "years")?.getFullYear()).toBe(2028);
  });

  test("parses absolute local date-time values to Unix seconds", () => {
    const now = new Date(2026, 0, 1, 0, 0, 0);
    const value = absoluteInviteExpiry("2026-01-02T03:04:05", now);
    expect(value).toBe(
      Math.floor(new Date(2026, 0, 2, 3, 4, 5).getTime() / 1000),
    );
    expect(absoluteInviteExpiry("2025-01-02T03:04:05", now)).toBeNull();
  });
});
