import { describe, expect, test } from "bun:test";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { signAccessToken, verifyAccessToken } from "../src/worker/lib/jwt";

const claims = () => ({
  iss: "https://prism.test",
  sub: "user-1",
  aud: ["https://prism.test"],
  client_id: "client-1",
  jti: "token-1",
  scope: "openid profile",
});

describe("ML-DSA-65 access tokens", () => {
  const { secretKey, publicKey } = ml_dsa65.keygen(new Uint8Array(32).fill(7));

  test("a signed token verifies and round-trips its claims", () => {
    const token = signAccessToken(claims(), secretKey, "kid-1", 60);
    const payload = verifyAccessToken(token, publicKey);
    expect(payload.sub).toBe("user-1");
    expect(payload.client_id).toBe("client-1");
    expect(JSON.parse(atob(token.split(".")[0]))).toMatchObject({
      alg: "ML-DSA-65",
      typ: "at+JWT",
      kid: "kid-1",
    });
  });

  test("a tampered payload is rejected", () => {
    const [h, , s] = signAccessToken(claims(), secretKey, "kid-1", 60).split(
      ".",
    );
    const forged = btoa(JSON.stringify({ ...claims(), sub: "admin" }))
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    expect(() => verifyAccessToken(`${h}.${forged}.${s}`, publicKey)).toThrow();
  });

  test("another key's signature is rejected", () => {
    const other = ml_dsa65.keygen(new Uint8Array(32).fill(9));
    const token = signAccessToken(claims(), other.secretKey, "kid-2", 60);
    expect(() => verifyAccessToken(token, publicKey)).toThrow();
  });
});
