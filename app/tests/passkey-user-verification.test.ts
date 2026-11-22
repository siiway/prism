import { describe, expect, test } from "bun:test";
import {
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  failedUserVerification,
} from "../src/worker/lib/webauthn";

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

  test("registering requires it, so every passkey can sign in", async () => {
    const options = await beginPasskeyRegistration(
      "u",
      "u@example.com",
      "U",
      [],
      "prism.example",
      "Prism",
    );
    expect(options.authenticatorSelection?.userVerification).toBe("required");
  });

  test("a sign-in that lacked user verification is told apart", () => {
    expect(
      failedUserVerification(
        new Error("User verification required, but user could not be verified"),
      ),
    ).toBe(true);
    expect(failedUserVerification(new Error("Unexpected signature"))).toBe(
      false,
    );
  });
});
