import { beforeEach, describe, expect, test } from "bun:test";
import {
  encryptSecret,
  resetSecretKeyCache,
} from "../src/worker/lib/secretCrypto";

const goodKey = Buffer.from(
  crypto.getRandomValues(new Uint8Array(32)),
).toString("base64url");

function envWith(get: () => Promise<string>): Env {
  return { SECRETS_KEY: { get } } as unknown as Env;
}

beforeEach(() => resetSecretKeyCache());

describe("SECRETS_KEY cache", () => {
  test("a failed read isn't kept", async () => {
    await expect(
      encryptSecret(
        envWith(() => Promise.reject(new Error("store unavailable"))),
        "x",
      ),
    ).rejects.toThrow();
    await Bun.sleep(0);
    const sealed = await encryptSecret(
      envWith(() => Promise.resolve(goodKey)),
      "x",
    );
    expect(sealed).toStartWith("__ENC_v1__");
  });
});
