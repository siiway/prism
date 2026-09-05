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
// The embedded HMAC secret is derived from the server JWT secret (same trick
// as lib/pow.ts) so no new binding or stored secret is required.

import {
  generateChallenge,
  validateChallenge,
  type ChallengeResult,
  type ValidateChallengeBody,
} from "capjs-core";
import { getJwtSecret } from "./config";

/** Scope bound into the challenge JWT, so a token minted for captcha cannot be
 *  replayed against some other capjs-core surface. */
const CAP_SCOPE = "prism-captcha";
const NONCE_PREFIX = "cap:nonce:";
const TOKEN_PREFIX = "cap:token:";
/** Redeem-token TTL. Matches capjs-core's default; the user must submit the
 *  form within this window after solving. */
const TOKEN_TTL_MS = 20 * 60 * 1000;

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
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${jwt}\0cap-v1`),
  );
  return Array.from(new Uint8Array(material))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
 * Redeem a solved embedded Cap challenge, returning the opaque token the client
 * will later submit with the gated form. Replay of the *challenge* is prevented
 * via the KV-backed consumeNonce callback; the issued token is stored in KV so
 * verifyCapToken can confirm it later and burn it.
 */
export async function redeemCapChallenge(
  env: Env,
  body: ValidateChallengeBody,
): Promise<{ success: true; token: string } | { success: false }> {
  const secret = await getCapSecret(env);
  const result = await validateChallenge(secret, body, {
    scope: CAP_SCOPE,
    tokenTtlMs: TOKEN_TTL_MS,
    consumeNonce: async (sigHex, ttlMs) => {
      const key = `${NONCE_PREFIX}${sigHex}`;
      if (await env.KV_CACHE.get(key)) return false;
      await env.KV_CACHE.put(key, "1", {
        expirationTtl: Math.ceil(ttlMs / 1000),
      });
      return true;
    },
  });
  if (!result.success) return { success: false };

  // Persist the redeem token so the eventual form submission can be checked.
  // capjs-core hands back a `token` (given to the user) and a `tokenKey`
  // (stored server-side); store expiry keyed by tokenKey.
  const tokenKey = result.tokenKey ?? result.token;
  await env.KV_CACHE.put(`${TOKEN_PREFIX}${tokenKey}`, String(result.expires), {
    expirationTtl: Math.ceil(TOKEN_TTL_MS / 1000),
  });
  return { success: true, token: result.token };
}

/** Re-derive the stored tokenKey from a user-submitted `id:secret` token,
 *  matching capjs-core's default signToken shape. */
async function deriveTokenKey(token: string): Promise<string | null> {
  const idx = token.indexOf(":");
  if (idx === -1) return null;
  const id = token.slice(0, idx);
  const verToken = token.slice(idx + 1);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verToken),
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${id}:${hex}`;
}

/** Verify a submitted embedded Cap token: look it up, check expiry, single-use. */
async function verifyCapEmbedded(env: Env, token: string): Promise<boolean> {
  const tokenKey = await deriveTokenKey(token);
  if (!tokenKey) return false;
  const key = `${TOKEN_PREFIX}${tokenKey}`;
  const stored = await env.KV_CACHE.get(key);
  if (!stored) return false;
  // Single-use: delete on read so a captured token cannot be replayed.
  await env.KV_CACHE.delete(key);
  const expires = Number(stored);
  return Number.isFinite(expires) && expires > Date.now();
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
