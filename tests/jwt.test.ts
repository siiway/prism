import { describe, expect, test } from "bun:test";
import {
  signIdTokenRS256,
  signJWT,
  signLogoutTokenRS256,
  verifyIdTokenRS256,
  verifyJWT,
} from "../worker/lib/jwt";

const secret = "test-secret";
const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

describe("HS256 session token", () => {
  test("round-trips, keeping non-ASCII claims intact", async () => {
    const token = await signJWT(
      { sub: "u1", role: "user", sessionId: "s1", name: "李雷 Zoë" },
      secret,
      60,
    );
    const payload = await verifyJWT(token, secret);
    expect(payload.sub).toBe("u1");
    expect(payload.name).toBe("李雷 Zoë");
    expect(payload.exp - payload.iat).toBe(60);
  });

  test("verifies a standard HS256 token built independently", async () => {
    // Session cookies issued before this code changed must still verify.
    const now = Math.floor(Date.now() / 1000);
    const enc = (v: unknown) =>
      b64url(new TextEncoder().encode(JSON.stringify(v)));
    const input = `${enc({ alg: "HS256", typ: "JWT" })}.${enc({
      sub: "u2",
      role: "admin",
      sessionId: "s2",
      iat: now,
      exp: now + 60,
    })}`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input)),
    );
    const payload = await verifyJWT(`${input}.${b64url(sig)}`, secret);
    expect(payload.sub).toBe("u2");
  });

  test("rejects a wrong secret, a tampered body and an expired token", async () => {
    const token = await signJWT(
      { sub: "u1", role: "user", sessionId: "s1" },
      secret,
      60,
    );
    await expect(verifyJWT(token, "other")).rejects.toThrow("signature");

    const [h, , s] = token.split(".");
    const forged = b64url(
      new TextEncoder().encode(
        JSON.stringify({ sub: "u1", role: "admin", sessionId: "s1", exp: 9e9 }),
      ),
    );
    await expect(verifyJWT(`${h}.${forged}.${s}`, secret)).rejects.toThrow(
      "signature",
    );

    const expired = await signJWT(
      { sub: "u1", role: "user", sessionId: "s1" },
      secret,
      -10,
    );
    await expect(verifyJWT(expired, secret)).rejects.toThrow("expired");
    await expect(verifyJWT("a.b", secret)).rejects.toThrow("format");
  });
});

describe("RS256 ID and logout tokens", () => {
  test("sign and verify, with the right typ", async () => {
    const { privateKey, publicKey } = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;

    const id = await signIdTokenRS256(
      { sub: "u1", name: "Zoë" },
      privateKey,
      "k1",
      60,
    );
    expect((await verifyIdTokenRS256(id, publicKey)).name).toBe("Zoë");
    const header = JSON.parse(
      Buffer.from(id.split(".")[0], "base64url").toString(),
    );
    expect(header).toEqual({ alg: "RS256", typ: "JWT", kid: "k1" });

    const logout = await signLogoutTokenRS256(
      { sub: "u1" },
      privateKey,
      "k1",
      60,
    );
    expect(
      JSON.parse(Buffer.from(logout.split(".")[0], "base64url").toString()).typ,
    ).toBe("logout+jwt");

    // Expired ID tokens still verify: logout accepts an expired hint.
    const old = await signIdTokenRS256({ sub: "u1" }, privateKey, "k1", -60);
    expect((await verifyIdTokenRS256(old, publicKey)).sub).toBe("u1");
  });
});
