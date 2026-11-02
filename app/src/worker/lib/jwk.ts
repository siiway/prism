// Public-key JWK import for verifying JWS signatures (DPoP proofs and
// private_key_jwt client assertions).

export interface PublicJwk {
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

type VerifyAlgo = Parameters<SubtleCrypto["verify"]>[0];

/** Map a JWK + JWS alg to a Web Crypto import + verify parameters. Returns null
 *  for key/alg combinations we don't support. Covers RS256, ES256, EdDSA. */
export async function importVerifyKey(
  jwk: PublicJwk,
  alg: string,
): Promise<{ key: CryptoKey; verifyAlgo: VerifyAlgo } | null> {
  const params = verifyParams(jwk, alg);
  if (!params) return null;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk as JsonWebKey,
      params.importAlgo,
      false,
      ["verify"],
    );
    return { key, verifyAlgo: params.verifyAlgo };
  } catch {
    return null;
  }
}

function verifyParams(
  jwk: PublicJwk,
  alg: string,
): {
  importAlgo: Parameters<SubtleCrypto["importKey"]>[2];
  verifyAlgo: VerifyAlgo;
} | null {
  if (alg === "RS256" && jwk.kty === "RSA") {
    return {
      importAlgo: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      verifyAlgo: "RSASSA-PKCS1-v1_5",
    };
  }
  if (alg === "ES256" && jwk.kty === "EC" && jwk.crv === "P-256") {
    return {
      importAlgo: { name: "ECDSA", namedCurve: "P-256" },
      verifyAlgo: { name: "ECDSA", hash: "SHA-256" },
    };
  }
  if (alg === "EdDSA" && jwk.kty === "OKP" && jwk.crv === "Ed25519") {
    return { importAlgo: { name: "Ed25519" }, verifyAlgo: "Ed25519" };
  }
  return null;
}
