// RFC 7523 private_key_jwt client authentication.
//
// A confidential client authenticates by signing a short-lived JWT assertion
// with its private key instead of sending a shared secret. We verify the
// signature against the public keys the client registered (an inline JWK Set,
// or one fetched from its jwks_uri), and enforce the assertion claims and a
// one-time jti so a captured assertion can't be replayed.

import { base64urlToBuf } from "./crypto";
import { safeFetch } from "./safeFetch";
import type { OAuthAppRow } from "../types";

export const CLIENT_ASSERTION_TYPE =
  "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

interface Jwk {
  kty: string;
  kid?: string;
  alg?: string;
  crv?: string;
  use?: string;
  n?: string;
  e?: string;
  x?: string;
  y?: string;
}

interface AssertionHeader {
  alg: string;
  kid?: string;
  typ?: string;
}

interface AssertionPayload {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  jti?: string;
}

function decodeJson<T>(segment: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64urlToBuf(segment))) as T;
  } catch {
    return null;
  }
}

/** The client_id an assertion claims (iss / sub), read WITHOUT verifying the
 *  signature — used only to look up which client's keys to verify against. */
export function assertionClientId(assertion: string): string | null {
  const parts = assertion.split(".");
  if (parts.length !== 3) return null;
  const payload = decodeJson<AssertionPayload>(parts[1]);
  return payload?.iss ?? payload?.sub ?? null;
}

/** Map a JWK + JWS alg to a Web Crypto import + verify parameters. Returns null
 *  for key/alg combinations we don't support. Covers RS256, ES256, EdDSA. */
type VerifyAlgo = Parameters<SubtleCrypto["verify"]>[0];

async function importVerifyKey(
  jwk: Jwk,
  alg: string,
): Promise<{ key: CryptoKey; verifyAlgo: VerifyAlgo } | null> {
  try {
    if (alg === "RS256" && jwk.kty === "RSA") {
      const key = await crypto.subtle.importKey(
        "jwk",
        jwk as JsonWebKey,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      return { key, verifyAlgo: "RSASSA-PKCS1-v1_5" };
    }
    if (alg === "ES256" && jwk.kty === "EC" && jwk.crv === "P-256") {
      const key = await crypto.subtle.importKey(
        "jwk",
        jwk as JsonWebKey,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
      return { key, verifyAlgo: { name: "ECDSA", hash: "SHA-256" } };
    }
    if (alg === "EdDSA" && jwk.kty === "OKP" && jwk.crv === "Ed25519") {
      const key = await crypto.subtle.importKey(
        "jwk",
        jwk as JsonWebKey,
        { name: "Ed25519" },
        false,
        ["verify"],
      );
      return { key, verifyAlgo: "Ed25519" };
    }
  } catch {
    return null;
  }
  return null;
}

/** Resolve the client's JWK Set: the inline `jwks` first, else a cached fetch
 *  of `jwks_uri` (SSRF-guarded, cached 5 minutes). */
async function resolveClientJwks(env: Env, app: OAuthAppRow): Promise<Jwk[]> {
  if (app.jwks) {
    try {
      const parsed = JSON.parse(app.jwks) as { keys?: Jwk[] };
      if (Array.isArray(parsed.keys)) return parsed.keys;
    } catch {
      /* fall through */
    }
  }
  if (app.jwks_uri) {
    const cacheKey = `jwks:${app.client_id}`;
    const cached = await env.KV_CACHE.get(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as { keys?: Jwk[] };
        if (Array.isArray(parsed.keys)) return parsed.keys;
      } catch {
        /* ignore */
      }
    }
    try {
      const res = await safeFetch(app.jwks_uri, {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const text = await res.text();
        const parsed = JSON.parse(text) as { keys?: Jwk[] };
        if (Array.isArray(parsed.keys)) {
          await env.KV_CACHE.put(cacheKey, text, { expirationTtl: 300 });
          return parsed.keys;
        }
      }
    } catch {
      /* unreachable / invalid jwks_uri → no keys */
    }
  }
  return [];
}

/**
 * Verify a private_key_jwt client assertion for `app`. `acceptedAudiences` are
 * the values the assertion's `aud` may name (the issuer and the concrete
 * endpoint URL). Returns true only when every claim checks out, the jti has
 * not been seen before, and the signature verifies against a registered key.
 */
export async function verifyClientAssertion(
  env: Env,
  app: OAuthAppRow,
  assertion: string,
  acceptedAudiences: string[],
): Promise<boolean> {
  const parts = assertion.split(".");
  if (parts.length !== 3) return false;
  const header = decodeJson<AssertionHeader>(parts[0]);
  const payload = decodeJson<AssertionPayload>(parts[1]);
  if (!header || !payload || !header.alg || header.alg === "none") return false;

  // RFC 7523 §3: iss and sub are the client_id; aud names the AS; exp is
  // required; jti guards against replay.
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== app.client_id || payload.sub !== app.client_id)
    return false;
  const auds = Array.isArray(payload.aud)
    ? payload.aud
    : payload.aud
      ? [payload.aud]
      : [];
  if (!auds.some((a) => acceptedAudiences.includes(a))) return false;
  if (typeof payload.exp !== "number" || payload.exp < now) return false;
  if (typeof payload.nbf === "number" && payload.nbf > now + 60) return false;
  // Bound how far in the past/future an assertion may be dated.
  if (payload.exp > now + 3600) return false;
  if (!payload.jti) return false;

  // Replay guard: a jti may be presented once, until it would have expired.
  const jtiKey = `cas:${app.client_id}:${payload.jti}`;
  if (await env.KV_CACHE.get(jtiKey)) return false;

  const jwks = await resolveClientJwks(env, app);
  if (jwks.length === 0) return false;
  const candidates = header.kid
    ? jwks.filter((k) => k.kid === header.kid)
    : jwks;

  const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const sig = base64urlToBuf(parts[2]);
  for (const jwk of candidates) {
    const imported = await importVerifyKey(jwk, header.alg);
    if (!imported) continue;
    const ok = await crypto.subtle.verify(
      imported.verifyAlgo,
      imported.key,
      sig,
      signingInput,
    );
    if (ok) {
      // Burn the jti for the remainder of its validity window.
      await env.KV_CACHE.put(jtiKey, "1", {
        expirationTtl: Math.max(1, Math.min(3600, payload.exp - now)),
      });
      return true;
    }
  }
  return false;
}
