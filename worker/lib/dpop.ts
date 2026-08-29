// RFC 9449 — OAuth 2.0 Demonstrating Proof of Possession (DPoP).
//
// A client proves it holds a private key by sending a `DPoP` header: a JWT,
// signed by that key and carrying the public key in its header, that is bound
// to the HTTP method + URI (and, at a resource, the access token). The access
// token is then bound to the key's SHA-256 thumbprint (`jkt`), so a stolen
// bearer value is useless without the key.

import { bufToBase64url, base64urlToBuf } from "./crypto";

interface Jwk {
  kty: string;
  crv?: string;
  x?: string;
  y?: string;
  n?: string;
  e?: string;
}

interface DpopHeader {
  typ?: string;
  alg?: string;
  jwk?: Jwk;
}

interface DpopPayload {
  htm?: string;
  htu?: string;
  iat?: number;
  jti?: string;
  ath?: string;
  nonce?: string;
}

function decodeJson<T>(segment: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64urlToBuf(segment))) as T;
  } catch {
    return null;
  }
}

async function sha256Base64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return bufToBase64url(digest);
}

/** RFC 7638 JWK thumbprint: base64url(SHA-256(canonical JWK)). The canonical
 *  form contains only the required members, in lexicographic order, no space. */
export async function jwkThumbprint(jwk: Jwk): Promise<string | null> {
  let canonical: string;
  if (jwk.kty === "EC" && jwk.crv && jwk.x && jwk.y) {
    canonical = `{"crv":"${jwk.crv}","kty":"EC","x":"${jwk.x}","y":"${jwk.y}"}`;
  } else if (jwk.kty === "RSA" && jwk.n && jwk.e) {
    canonical = `{"e":"${jwk.e}","kty":"RSA","n":"${jwk.n}"}`;
  } else if (jwk.kty === "OKP" && jwk.crv && jwk.x) {
    canonical = `{"crv":"${jwk.crv}","kty":"OKP","x":"${jwk.x}"}`;
  } else {
    return null;
  }
  return sha256Base64url(canonical);
}

type VerifyAlgo = Parameters<SubtleCrypto["verify"]>[0];

async function importPublicJwk(
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

/** Strip query + fragment: the DPoP `htu` is compared against the bare URI. */
export function htuOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

export interface DpopVerifyOptions {
  /** Expected HTTP method (htm). */
  htm: string;
  /** Expected HTTP target URI (htu); query/fragment are ignored. */
  htu: string;
  /** When verifying at a resource, the access token whose hash must match `ath`. */
  accessToken?: string;
}

/**
 * Verify a DPoP proof. Returns the key thumbprint (`jkt`) on success, or an
 * RFC 9449 error code on failure. Enforces typ/alg, the embedded public-key
 * signature, htm/htu binding, a recent iat, a one-time jti, and — at a resource
 * — the access-token hash `ath`.
 */
export async function verifyDpopProof(
  env: Env,
  proof: string,
  opts: DpopVerifyOptions,
): Promise<{ jkt: string } | { error: string }> {
  const parts = proof.split(".");
  if (parts.length !== 3) return { error: "invalid_dpop_proof" };
  const header = decodeJson<DpopHeader>(parts[0]);
  const payload = decodeJson<DpopPayload>(parts[1]);
  if (!header || !payload) return { error: "invalid_dpop_proof" };
  if (header.typ !== "dpop+jwt" || !header.alg || !header.jwk)
    return { error: "invalid_dpop_proof" };

  const imported = await importPublicJwk(header.jwk, header.alg);
  if (!imported) return { error: "invalid_dpop_proof" };
  const ok = await crypto.subtle.verify(
    imported.verifyAlgo,
    imported.key,
    base64urlToBuf(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) return { error: "invalid_dpop_proof" };

  if ((payload.htm ?? "").toUpperCase() !== opts.htm.toUpperCase())
    return { error: "invalid_dpop_proof" };
  if (htuOf(payload.htu ?? "") !== htuOf(opts.htu))
    return { error: "invalid_dpop_proof" };

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.iat !== "number" || Math.abs(now - payload.iat) > 300)
    return { error: "invalid_dpop_proof" };
  if (!payload.jti) return { error: "invalid_dpop_proof" };

  if (opts.accessToken) {
    const expected = await sha256Base64url(opts.accessToken);
    if (payload.ath !== expected) return { error: "invalid_dpop_proof" };
  }

  const jkt = await jwkThumbprint(header.jwk);
  if (!jkt) return { error: "invalid_dpop_proof" };

  // One-time jti (scoped to the key) for the proof's lifetime.
  const jtiKey = `dpop:${jkt}:${payload.jti}`;
  if (await env.KV_CACHE.get(jtiKey)) return { error: "invalid_dpop_proof" };
  await env.KV_CACHE.put(jtiKey, "1", { expirationTtl: 300 });

  return { jkt };
}
