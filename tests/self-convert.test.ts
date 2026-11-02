import { describe, expect, test } from "bun:test";
import { resolveSelfConvert } from "../src/worker/lib/userCapabilities";

// Just enough of D1 for one `SELECT … FROM teams WHERE id = ?`.
function db(row: Record<string, unknown> | null) {
  return {
    prepare: () => ({ bind: () => ({ first: async () => row }) }),
  } as unknown as D1Database;
}

describe("resolveSelfConvert", () => {
  test("follows the site default when the team has no override", async () => {
    const team = db({ invite_registration_allow_convert: null });
    expect(await resolveSelfConvert(team, "t1", {})).toBe(false);
    expect(await resolveSelfConvert(team, "t1", { "self:convert": true })).toBe(
      true,
    );
  });

  test("the team's override wins either way", async () => {
    expect(
      await resolveSelfConvert(
        db({ invite_registration_allow_convert: 1 }),
        "t1",
        { "self:convert": false },
      ),
    ).toBe(true);
    expect(
      await resolveSelfConvert(
        db({ invite_registration_allow_convert: 0 }),
        "t1",
        { "self:convert": true },
      ),
    ).toBe(false);
  });

  test("falls back to the site default before the column exists", async () => {
    expect(
      await resolveSelfConvert(db({ id: "t1" }), "t1", {
        "self:convert": true,
      }),
    ).toBe(true);
    expect(await resolveSelfConvert(db(null), null, {})).toBe(false);
  });
});
