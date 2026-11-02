// Cap (trycap.dev) captcha integration.
//
// Cap is a self-hosted, privacy-friendly proof-of-work captcha. Two modes:
//
//   embedded — capjs-core runs inside this Worker. It is stateless by design:
//     the challenge is a signed JWT, and replay protection + the redeem-token
//     lookup are delegated to callbacks we back with KV (KV_CACHE). This keeps
//     the "zero servers" posture: no extra infrastructure, no filesystem (which
//     is why we use capjs-core and NOT @cap.js/server — the latter needs a
//     filesystem token store and does not run on Workers).
//
//   external — a self-hosted Cap Standalone server does the work; we only
//     validate the redeemed token against its /:siteKey/siteverify endpoint.
//
// The embedded HMAC secret is derived from the server JWT secret, so no new
// binding or stored secret is required.

import {
  generateChallenge,
  validateChallenge,
  type ChallengeResult,
  type ValidateChallengeBody,
} from "capjs-core";
import { getJwtSecret } from "./config";
import {
  decodeBase64urlJson,
  hmacSha256Hex,
  sha256Hex,
  timingSafeStrEqual,
} from "./crypto";
import { claimReplayValue } from "./securityState";

/** Scope bound into the challenge JWT, so a token minted for captcha cannot be
 *  replayed against some other capjs-core surface. */
const CAP_SCOPE = "prism-captcha";

export interface CapEmbeddedOptions {
  challengeCount: number;
  challengeDifficulty: number;
  instrumentation: boolean;
}

/** Derive the Cap HMAC secret from the JWT secret, domain-separated so a leak
 *  of one cannot be reused as the other. capjs-core wants a stable string
 *  ≥16 bytes; a 64-hex-char digest satisfies that across restarts. */
async function getCapSecret(env: Env): Promise<string> {
  const jwt = await getJwtSecret(env.KV_SESSIONS);
  return sha256Hex(`${jwt}\0cap-v1`);
}

/**
 * The redeem token is deterministic per challenge:
 *
 *   token = `${challengeSig}.${exp}.${HMAC(capSecret, challengeSig + "." + exp)}`
 *
 * where `challengeSig` is the challenge JWT's signature segment (unique per
 * challenge) and `exp` is the challenge's own expiry in ms (parsed from its
 * payload). This is what makes redeem idempotent: the @cap.js/widget redeems a
 * single challenge more than once (a speculative redeem while instrumentation
 * runs, then a final one), and both must agree. A deterministic token also
 * means one solved challenge yields exactly one token no matter how many times
 * it is redeemed, so the proof-of-work cost is preserved — single use is then
 * enforced once, at the gate, in verifyCapEmbedded.
 */
async function deriveCapToken(
  secret: string,
  challengeJwt: string,
): Promise<{ token: string; expires: number } | null> {
  const parts = challengeJwt.split(".");
  if (parts.length !== 3) return null;
  const sig = parts[2];
  const payload = decodeBase64urlJson<{ exp?: number }>(parts[1]);
  if (!payload) return null;
  const exp = Number(payload.exp);
  if (!sig || !Number.isFinite(exp)) return null;
  const mac = await hmacSha256Hex(secret, `${sig}.${exp}`);
  return { token: `${sig}.${exp}.${mac}`, expires: exp };
}

/** Mint a fresh embedded Cap challenge for the widget to solve. */
export async function issueCapChallenge(
  env: Env,
  opts: CapEmbeddedOptions,
): Promise<ChallengeResult> {
  const secret = await getCapSecret(env);
  return generateChallenge(secret, {
    scope: CAP_SCOPE,
    challengeCount: opts.challengeCount,
    challengeDifficulty: opts.challengeDifficulty,
    // Instrumentation obfuscation is pinned to the default (level 3), which
    // never invokes the Node-only esbuild/javascript-obfuscator code paths —
    // see the wrangler.jsonc alias note.
    instrumentation: opts.instrumentation,
  });
}

/**
 * Redeem a solved embedded Cap challenge, returning the token the client submits
 * with the gated form. Verifies the challenge signature and the proof-of-work
 * solutions, then mints a deterministic token for the challenge (see
 * deriveCapToken). No server state is written here: because the token is a
 * function of the challenge, the widget's speculative + final redeems produce
 * the same value, and single use is enforced later at the gate.
 */
export async function redeemCapChallenge(
  env: Env,
  body: ValidateChallengeBody,
): Promise<
  { success: true; token: string; expires: number } | { success: false }
> {
  const secret = await getCapSecret(env);
  // No consumeNonce: the widget legitimately redeems one challenge twice
  // (speculative then final). capjs-core still checks the JWT signature, expiry
  // and the PoW solutions here — that is what proves the challenge was solved.
  const result = await validateChallenge(secret, body, { scope: CAP_SCOPE });
  if (!result.success) return { success: false };

  const derived = await deriveCapToken(secret, body.token);
  if (!derived) return { success: false };
  // `expires` is required by @cap.js/widget: it does `new Date(expires)` on the
  // redeem response and rejects the token ("invalid_expires") if it's missing.
  return { success: true, token: derived.token, expires: derived.expires };
}

/** Verify a submitted embedded Cap token: prove we issued it (HMAC), that it
 *  hasn't expired, and that it hasn't already been used. */
async function verifyCapEmbedded(env: Env, token: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [sig, expStr, mac] = parts;

  // Authenticity: only we can produce this MAC, and only after a solve (redeem).
  const secret = await getCapSecret(env);
  const expected = await hmacSha256Hex(secret, `${sig}.${expStr}`);
  if (!timingSafeStrEqual(mac, expected)) return false;

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= Date.now()) return false;

  // Single-use, atomically via the D1 replay-claim table. Concurrent
  // submissions of the same token all reach here; only the first claim wins, so
  // a captured token cannot be redeemed twice — and since the token is
  // deterministic per challenge, one solved challenge admits exactly one gate.
  return claimReplayValue(env.DB, "cap-token", "", sig, Math.ceil(exp / 1000));
}

/** Verify a submitted token against an external Cap Standalone server. */
async function verifyCapExternal(
  token: string,
  apiEndpoint: string,
  siteKey: string,
  secretKey: string,
): Promise<boolean> {
  const base = apiEndpoint.replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/${siteKey}/siteverify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: secretKey, response: token }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

/** Verify a Cap token, dispatching on the configured mode. */
export async function verifyCapToken(
  env: Env,
  token: string,
  mode: "embedded" | "external",
  external: { apiEndpoint: string; siteKey: string; secretKey: string },
): Promise<boolean> {
  if (!token) return false;
  if (mode === "external") {
    if (!external.apiEndpoint || !external.siteKey) return false;
    return verifyCapExternal(
      token,
      external.apiEndpoint,
      external.siteKey,
      external.secretKey,
    );
  }
  return verifyCapEmbedded(env, token);
}
