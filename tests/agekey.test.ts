import { describe, expect, test } from "bun:test";
import {
  highestSatisfiedAge,
  meetsMinAge,
  readMinAge,
  thresholdsForMinAge,
} from "../shared/age";
import { bufToBase64url } from "../worker/lib/crypto";
import {
  AGEKEY_USE_CLAIMS_JSON,
  AgeKeyVerifyError,
  agekeyEndpoints,
  buildAgeKeyAuthorizationUrl,
  hashClaimsJson,
  normalizeAgeKeyClientId,
  verifyAgeKeyToken,
  type AgeKeyJwk,
} from "../worker/lib/agekey";
import {
  mergeWithSiteFloor,
  unmetRequirements,
  type UserSecurityState,
} from "../worker/lib/teamRequirements";

const clientId = "ak_live_example";
const now = 1_700_000_000;

function b64urlJson(value: unknown): string {
  return bufToBase64url(new TextEncoder().encode(JSON.stringify(value)));
}

async function signToken(
  privateKey: CryptoKey,
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "ES256", typ: "JWT", kid: "k1" },
): Promise<string> {
  const h = b64urlJson(header);
  const b = b64urlJson(payload);
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(`${h}.${b}`),
  );
  const raw = new Uint8Array(sig);
  expect(raw.byteLength).toBe(64);
  return `${h}.${b}.${bufToBase64url(raw)}`;
}

async function fixture() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = (await crypto.subtle.exportKey(
    "jwk",
    pair.publicKey,
  )) as AgeKeyJwk;
  jwk.kid = "k1";
  const hash = await hashClaimsJson(AGEKEY_USE_CLAIMS_JSON);
  const payload = {
    iss: agekeyEndpoints(clientId).issuer,
    aud: [clientId],
    sub: "session-1",
    iat: now,
    exp: now + 600,
    nonce: "nonce-1",
    age_thresholds: { "13": true, "16": true, "18": true, "21": false },
    req_claims_hash: hash,
  };
  const token = await signToken(pair.privateKey, payload);
  return { jwk, token, payload, privateKey: pair.privateKey };
}

describe("age thresholds", () => {
  test("a passing higher threshold covers every lower one", () => {
    const thresholds = { "18": true, "21": false };
    expect(meetsMinAge(thresholds, 0)).toBe(true);
    expect(meetsMinAge(thresholds, 13)).toBe(true);
    expect(meetsMinAge(thresholds, 18)).toBe(true);
    expect(meetsMinAge(thresholds, 21)).toBe(false);
    expect(meetsMinAge(null, 18)).toBe(false);
    expect(readMinAge(19)).toBe(0);
    expect(readMinAge(18)).toBe(18);
    expect(thresholdsForMinAge(18)).toEqual({
      "13": true,
      "16": true,
      "18": true,
      "21": false,
    });
    expect(highestSatisfiedAge(thresholdsForMinAge(18))).toBe(18);
    expect(highestSatisfiedAge(thresholdsForMinAge(0))).toBe(0);
  });

  test("effective minimum age is the greater of the team and the site floor", () => {
    const floor = {
      require_2fa: false,
      require_verified_email: false,
      require_min_age: 18,
    };
    const effective = mergeWithSiteFloor(
      { require_2fa: 0, require_verified_email: 0, require_min_age: 13 },
      floor,
    );
    expect(effective.require_min_age).toBe(18);
    expect(effective.forced_by_site.require_min_age).toBe(18);

    const raised = mergeWithSiteFloor(
      { require_2fa: 0, require_verified_email: 0, require_min_age: 21 },
      floor,
    );
    expect(raised.require_min_age).toBe(21);
  });

  test("unmet age is reported when the stored result is too young", () => {
    const state: UserSecurityState = {
      email_verified: true,
      has_2fa: true,
      age_thresholds: { "18": true },
    };
    const team = {
      require_2fa: 0,
      require_verified_email: 0,
      require_min_age: 21,
    };
    const floor = {
      require_2fa: false,
      require_verified_email: false,
      require_min_age: 0,
    };
    expect(unmetRequirements(team, state, floor)).toEqual(["age"]);
    expect(
      unmetRequirements({ ...team, require_min_age: 18 }, state, floor),
    ).toEqual([]);
  });
});

describe("AgeKey id_token", () => {
  test("accepts a signed token for the claims we requested", async () => {
    const { jwk, token } = await fixture();
    const verified = await verifyAgeKeyToken({
      token,
      clientId,
      nonce: "nonce-1",
      claimsJson: AGEKEY_USE_CLAIMS_JSON,
      now,
      jwks: [jwk],
    });
    expect(verified.sessionId).toBe("session-1");
    expect(verified.thresholds["18"]).toBe(true);
    expect(verified.thresholds["21"]).toBe(false);
  });

  test("rejects a bad signature, the wrong nonce, and alg none", async () => {
    const { jwk, token, payload, privateKey } = await fixture();
    const flipped = `${token.slice(0, -2)}aa`;
    await expect(
      verifyAgeKeyToken({
        token: flipped,
        clientId,
        nonce: "nonce-1",
        claimsJson: AGEKEY_USE_CLAIMS_JSON,
        now,
        jwks: [jwk],
      }),
    ).rejects.toBeInstanceOf(AgeKeyVerifyError);

    await expect(
      verifyAgeKeyToken({
        token,
        clientId,
        nonce: "other",
        claimsJson: AGEKEY_USE_CLAIMS_JSON,
        now,
        jwks: [jwk],
      }),
    ).rejects.toMatchObject({ reason: "nonce" });

    const none = await signToken(privateKey, payload, {
      alg: "none",
      typ: "JWT",
      kid: "k1",
    });
    await expect(
      verifyAgeKeyToken({
        token: none,
        clientId,
        nonce: "nonce-1",
        claimsJson: AGEKEY_USE_CLAIMS_JSON,
        now,
        jwks: [jwk],
      }),
    ).rejects.toMatchObject({ reason: "alg" });
  });

  test("authorization URL asks for every threshold on the matching host", () => {
    const live = buildAgeKeyAuthorizationUrl({
      clientId,
      redirectUri: "https://prism.example/api/agekey/callback",
      state: "s",
      nonce: "n",
    });
    expect(live.startsWith("https://api.agekey.org/v1/oidc/use?")).toBe(true);
    expect(live).toContain("response_mode=fragment");
    expect(live).toContain("response_type=id_token");
    expect(decodeURIComponent(live)).toContain(AGEKEY_USE_CLAIMS_JSON);

    const testUrl = buildAgeKeyAuthorizationUrl({
      clientId: "ak_test_example",
      redirectUri: "https://prism.example/api/agekey/callback",
      state: "s",
      nonce: "n",
    });
    expect(testUrl.startsWith("https://api-test.agekey.org/")).toBe(true);
    expect(normalizeAgeKeyClientId("")).toBe("");
    expect(normalizeAgeKeyClientId("ak live")).toBeNull();
  });
});
