import { describe, expect, test } from "bun:test";
import { generateUserCode } from "../src/worker/routes/oauth";

describe("device user codes", () => {
  test("are two groups of four from the base-20 alphabet", () => {
    for (let i = 0; i < 200; i++)
      expect(generateUserCode()).toMatch(
        /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/,
      );
  });

  test("use every letter about equally often", () => {
    const counts = new Map<string, number>();
    const codes = 20_000;
    for (let i = 0; i < codes; i++)
      for (const ch of generateUserCode().replace("-", ""))
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
    expect(counts.size).toBe(20);
    // 8000 expected per letter (sd ~87). `byte % 20` would put the first 16
    // letters near 8125 and the last four near 7500.
    for (const n of counts.values())
      expect(Math.abs(n - 8000)).toBeLessThan(450);
  });
});
