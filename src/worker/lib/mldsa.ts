// ML-DSA-65 keypair management (NIST FIPS 204 — post-quantum signatures)
// The 32-byte seed is stored in KV; the full keypair is derived on demand.

import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { bufToBase64url, base64urlToBuf } from "./crypto";

const KV_SEED_KEY = "system:ml_dsa65_v1_seed";

export interface MLDSAKey {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  /** Base64url-encoded SHA-256 prefix of the public key — stable key ID for JWKS */
  kid: string;
}

async function deriveKid(publicKey: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", publicKey);
  return bufToBase64url(new Uint8Array(hash)).slice(0, 22);
}

export async function getMLDSAKey(kv: KVNamespace): Promise<MLDSAKey> {
  const existing = await kv.get(KV_SEED_KEY);
  let seed: Uint8Array;

  if (existing) {
    seed = base64urlToBuf(existing);
  } else {
    seed = crypto.getRandomValues(new Uint8Array(32));
    await kv.put(KV_SEED_KEY, bufToBase64url(seed));
  }

  const { secretKey, publicKey } = ml_dsa65.keygen(seed);
  const kid = await deriveKid(publicKey);
  return { publicKey, secretKey, kid };
}
