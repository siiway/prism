// RFC 9449 — OAuth 2.0 Demonstrating Proof of Possession (DPoP).
//
// A client proves it holds a private key by sending a `DPoP` header: a JWT,
// signed by that key and carrying the public key in its header, that is bound
// to the HTTP method + URI (and, at a resource, the access token). The access
// token is then bound to the key's SHA-256 thumbprint (`jkt`), so a stolen
// bearer value is useless without the key.

import {
  base64urlToBuf,
  bufToBase64url,
  decodeBase64urlJson,
  sha256,
} from "./crypto";
import { importVerifyKey, type PublicJwk as Jwk } from "./jwk";
import { claimReplayValue } from "./securityState";

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

async function sha256Base64url(input: string): Promise<string> {
  return bufToBase64url(await sha256(input));
}

/** RFC 7638 JWK thumbprint: base64url(SHA-256(canonical JWK)). The canonical
 *  form contains only the required members, in lexicographic order, no space. */
async function jwkThumbprint(jwk: Jwk): Promise<string | null> {
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

/** Strip query + fragment: the DPoP `htu` is compared against the bare URI. */
function htuOf(url: string): string {
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
  const header = decodeBase64urlJson<DpopHeader>(parts[0]);
  const payload = decodeBase64urlJson<DpopPayload>(parts[1]);
  if (!header || !payload) return { error: "invalid_dpop_proof" };
  if (header.typ !== "dpop+jwt" || !header.alg || !header.jwk)
    return { error: "invalid_dpop_proof" };

  const imported = await importVerifyKey(header.jwk, header.alg);
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
  if (
    typeof payload.jti !== "string" ||
    payload.jti.length === 0 ||
    payload.jti.length > 512
  )
    return { error: "invalid_dpop_proof" };

  if (opts.accessToken) {
    const expected = await sha256Base64url(opts.accessToken);
    if (payload.ath !== expected) return { error: "invalid_dpop_proof" };
  }

  const jkt = await jwkThumbprint(header.jwk);
  if (!jkt) return { error: "invalid_dpop_proof" };

  // One-time jti (scoped to the key) for the proof's full validity window.
  // The conditional D1 upsert is the consume decision, so concurrent copies
  // cannot both pass even when they arrive at different Worker locations.
  const expiresAt = Math.floor(payload.iat) + 301;
  if (
    !(await claimReplayValue(env.DB, "dpop", jkt, payload.jti, expiresAt, now))
  )
    return { error: "invalid_dpop_proof" };

  return { jkt };
}
