// Proof-of-Work challenge issuance and verification.
//
// The previous design handed out a random 64-char hex string as the
// challenge with no server-side state, then verified solutions by purely
// re-hashing. Three problems:
//   1. Replay: a solved (challenge, nonce) pair worked forever.
//   2. No expiry: an attacker could pre-mine challenges at leisure.
//   3. No integrity: the verifier didn't know if the server even issued
//      the challenge — it just trusted whatever string the client sent.
//
// The new design fixes all three:
//   - Challenge = base64url( payload(25 B) || HMAC-SHA256(secret, payload) )
//     payload = u8 version(1) || i64-be expiry(8) || u8[16] random nonce
//   - Verify recomputes HMAC, rejects on mismatch / expiry / replay.
//   - Single-use is enforced by inserting the payload nonce into pow_used
//     with `INSERT … ON CONFLICT DO NOTHING`; if the row already exists,
//     the verifier rejects.
//
// The PoW puzzle itself is unchanged: SHA-256(challenge_string ||
// be32(nonce)) must have `difficulty` leading zero bits. The solver only
// sees the opaque challenge string, so it doesn't need to know about the
// HMAC envelope.

import { getJwtSecret } from "./config";

const VERSION = 1;
const PAYLOAD_LEN = 1 + 8 + 16; // version + expiry + nonce
const HMAC_LEN = 32;
const CHALLENGE_TTL_SECONDS = 5 * 60;

/** Derive a PoW-domain HMAC key from the JWT secret. Avoids storing yet
 *  another secret in KV while keeping the keys cryptographically separate
 *  (different domain string = different output). */
async function getPowKey(env: Env): Promise<CryptoKey> {
  const jwt = await getJwtSecret(env.KV_SESSIONS);
  // Domain-separate the key with HKDF-style suffix so a leak of one HMAC
  // output can't be reused as the other.
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${jwt}\0pow-v1`),
  );
  return crypto.subtle.importKey(
    "raw",
    material,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(s: string): Uint8Array | null {
  try {
    const padded =
      s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let acc = 0;
  for (let i = 0; i < a.length; i++) acc |= a[i] ^ b[i];
  return acc === 0;
}

export interface IssuedPowChallenge {
  challenge: string;
  expires_at: number;
}

/** Issue a fresh signed challenge that expires in CHALLENGE_TTL_SECONDS. */
export async function issuePowChallenge(env: Env): Promise<IssuedPowChallenge> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + CHALLENGE_TTL_SECONDS;

  const payload = new Uint8Array(PAYLOAD_LEN);
  payload[0] = VERSION;
  // 8-byte big-endian expiry. JS bitwise ops are 32-bit, so split.
  const view = new DataView(payload.buffer);
  view.setBigUint64(1, BigInt(expiresAt), false);
  crypto.getRandomValues(payload.subarray(9));

  const key = await getPowKey(env);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, payload));

  const out = new Uint8Array(PAYLOAD_LEN + HMAC_LEN);
  out.set(payload, 0);
  out.set(sig, PAYLOAD_LEN);

  return { challenge: bytesToBase64Url(out), expires_at: expiresAt };
}

export type PowVerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "malformed"
        | "bad_signature"
        | "expired"
        | "replayed"
        | "wrong_difficulty";
    };

/**
 * Verify a (challenge, nonce) submission. Performs, in order:
 *  1. base64url decode + length check
 *  2. HMAC verification (constant time)
 *  3. expiry check
 *  4. single-use claim in pow_used (INSERT OR IGNORE)
 *  5. SHA-256(utf8(challenge) || be32(nonce)) leading-zero-bits check
 *
 * Returns a tagged result so the caller can distinguish "this was a forged
 * or expired token" from "user solved the wrong puzzle" if it ever wants
 * to react differently.
 */
export async function verifyPowChallenge(
  env: Env,
  challenge: string,
  nonce: number,
  difficulty: number,
): Promise<PowVerifyResult> {
  const raw = base64UrlToBytes(challenge);
  if (!raw || raw.length !== PAYLOAD_LEN + HMAC_LEN) {
    return { ok: false, reason: "malformed" };
  }
  if (raw[0] !== VERSION) {
    return { ok: false, reason: "malformed" };
  }

  const payload = raw.subarray(0, PAYLOAD_LEN);
  const sig = raw.subarray(PAYLOAD_LEN);

  const key = await getPowKey(env);
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, payload),
  );
  if (!constantTimeEqual(sig, expected)) {
    return { ok: false, reason: "bad_signature" };
  }

  const expiresAt = Number(
    new DataView(payload.buffer, payload.byteOffset).getBigUint64(1, false),
  );
  const now = Math.floor(Date.now() / 1000);
  if (expiresAt <= now) {
    return { ok: false, reason: "expired" };
  }

  // Single-use claim. INSERT OR IGNORE returns meta.changes = 0 when the
  // row already exists. Treat that as a replay.
  const challengeId = payload.subarray(9); // 16 random bytes
  const claim = await env.DB.prepare(
    "INSERT OR IGNORE INTO pow_used (challenge_id, expires_at) VALUES (?, ?)",
  )
    .bind(challengeId, expiresAt)
    .run();
  if ((claim.meta?.changes ?? 0) === 0) {
    return { ok: false, reason: "replayed" };
  }

  // Finally check the actual proof.
  const enc = new TextEncoder().encode(challenge);
  const buf = new Uint8Array(enc.length + 4);
  buf.set(enc, 0);
  new DataView(buf.buffer).setUint32(enc.length, nonce >>> 0, false);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));

  let remaining = difficulty;
  for (const byte of hash) {
    if (remaining >= 8) {
      if (byte !== 0) return { ok: false, reason: "wrong_difficulty" };
      remaining -= 8;
    } else {
      const mask = 0xff << (8 - remaining);
      return (byte & mask) === 0
        ? { ok: true }
        : { ok: false, reason: "wrong_difficulty" };
    }
    if (remaining === 0) return { ok: true };
  }
  return { ok: true };
}

/** Sweep expired single-use rows. Called from the scheduled worker. */
export async function sweepExpiredPowUsed(db: D1Database): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare("DELETE FROM pow_used WHERE expires_at <= ?")
    .bind(now)
    .run();
}
