import { describe, expect, test } from "bun:test";
import { inviteCodeFrom } from "../src/web/lib/inviteCode";

describe("inviteCodeFrom", () => {
  test("takes the code out of a pasted invite link", () => {
    expect(
      inviteCodeFrom(" https://prism.example/register?invite=abc_DEF-123 "),
    ).toBe("abc_DEF-123");
    expect(inviteCodeFrom("prism.example/register?x=1&invite=abc#top")).toBe(
      "abc",
    );
  });

  test("keeps a bare code as it is, trimmed", () => {
    expect(inviteCodeFrom("  abc_DEF-123\n")).toBe("abc_DEF-123");
    expect(inviteCodeFrom("")).toBe("");
  });

  test("decodes an escaped code", () => {
    expect(inviteCodeFrom("https://x/register?invite=a%2Bb")).toBe("a+b");
  });
});
