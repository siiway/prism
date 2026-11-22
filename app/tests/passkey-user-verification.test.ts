import { describe, expect, test } from "bun:test";
import { beginPasskeyAuthentication } from "../src/worker/lib/webauthn";

describe("passkey authentication options", () => {
  test("signing in requires user verification", async () => {
    const options = await beginPasskeyAuthentication([], "prism.example", true);
    expect(options.userVerification).toBe("required");
  });

  test("confirming in a session only prefers it", async () => {
    const options = await beginPasskeyAuthentication(
      [],
      "prism.example",
      false,
    );
    expect(options.userVerification).toBe("preferred");
  });
});
