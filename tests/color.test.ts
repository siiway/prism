import { describe, expect, test } from "bun:test";
import { hexToHsv, hsvToHex, normalizeHexColor } from "../src/lib/color";

describe("color conversion", () => {
  test("normalizes supported hex input", () => {
    expect(normalizeHexColor(" 0078D4 ")).toBe("#0078d4");
    expect(normalizeHexColor("#abc")).toBe("#aabbcc");
    expect(normalizeHexColor("#abcd")).toBeNull();
    expect(normalizeHexColor("blue")).toBeNull();
  });

  test("converts primary colors between hex and HSV", () => {
    expect(hexToHsv("#ff0000")).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv("#00ff00")).toEqual({ h: 120, s: 1, v: 1 });
    expect(hexToHsv("#0000ff")).toEqual({ h: 240, s: 1, v: 1 });
    expect(hsvToHex({ h: 240, s: 1, v: 1 })).toBe("#0000ff");
  });

  test("round-trips representative hex colors", () => {
    for (const color of ["#0078d4", "#5865f2", "#ffffff", "#000000"]) {
      expect(hsvToHex(hexToHsv(color)!)).toBe(color);
    }
  });
});
