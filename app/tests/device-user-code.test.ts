import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { generateUserCode } from "../src/worker/routes/oauth";

/** Feed generateUserCode fixed random bytes, one buffer per call. Bytes a
 *  buffer doesn't set are 31, which is always redrawn. */
function withBytes(...buffers: number[][]) {
  let call = 0;
  spyOn(crypto, "getRandomValues").mockImplementation(<T>(array: T): T => {
    const bytes = array as Uint8Array;
    bytes.fill(31);
    bytes.set(buffers[call++] ?? []);
    return array;
  });
}

afterEach(() => mock.restore());

describe("device user codes", () => {
  test("are two groups of four from the base-20 alphabet", () => {
    for (let i = 0; i < 200; i++)
      expect(generateUserCode()).toMatch(
        /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/,
      );
  });

  test("map the low 5 bits to a letter and redraw past the alphabet", () => {
    // Low 5 bits: 0, 19, 20 (redraw), 31 (redraw), 0, 19, 20 (redraw),
    // 31 (redraw), 0, 19, 1, 2. With `byte % 20`, 20 would be "B" and
    // 31 would be "N".
    withBytes([0, 19, 20, 31, 32, 51, 52, 255, 224, 243, 1, 2]);
    expect(generateUserCode()).toBe("BZBZ-BZCD");
  });

  test("draw more bytes when a buffer runs out", () => {
    withBytes([], [5, 6, 7], [8, 9, 10, 11, 12]);
    expect(generateUserCode()).toBe("HJKL-MNPQ");
  });
});
