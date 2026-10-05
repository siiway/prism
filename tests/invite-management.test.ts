import { describe, expect, test } from "bun:test";
import {
  canManageTeamInvite,
  isInviteEnabled,
  validateInviteMaxUses,
} from "../worker/lib/inviteManagement";

describe("invite management", () => {
  test("lets an admin manage only an invite they created", () => {
    expect(canManageTeamInvite("admin", "admin-1", "admin-1")).toBe(true);
    expect(canManageTeamInvite("admin", "admin-1", "admin-2")).toBe(false);
  });

  test("lets co-owners and owners manage every team invite", () => {
    expect(canManageTeamInvite("co-owner", "one", "two")).toBe(true);
    expect(canManageTeamInvite("owner", "one", "two")).toBe(true);
    expect(canManageTeamInvite("member", "one", "one")).toBe(false);
  });

  test("rejects an edited usage limit below uses or outside safe integers", () => {
    expect(validateInviteMaxUses(3, 4)).toEqual({ ok: false });
    expect(validateInviteMaxUses(-1, 0)).toEqual({ ok: false });
    expect(validateInviteMaxUses(1.5, 0)).toEqual({ ok: false });
    expect(validateInviteMaxUses(4, 4)).toEqual({ ok: true, value: 4 });
  });

  test("keeps legacy invitations enabled until explicitly disabled", () => {
    expect(isInviteEnabled(undefined)).toBe(true);
    expect(isInviteEnabled(1)).toBe(true);
    expect(isInviteEnabled(0)).toBe(false);
  });
});
