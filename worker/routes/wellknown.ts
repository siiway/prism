// /.well-known/* endpoints

import { Hono } from "hono";
import { cors } from "hono/cors";
import { getRsaKeyPair } from "../lib/config";
import type { Variables } from "../types";
import { USER_GRANTABLE_SCOPES } from "../../shared/scopes";

const SCOPES_SUPPORTED = USER_GRANTABLE_SCOPES;

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", cors());

/**
 * Provider metadata shared by the OpenID Connect Discovery document
 * (`/.well-known/openid-configuration`, OIDC Discovery 1.0 §3) and the OAuth
 * 2.0 Authorization Server Metadata document (`/.well-known/oauth-authorization-server`,
 * RFC 8414 §2). Both are served from the same object: the OIDC-only members
 * (userinfo_endpoint, subject_types_supported, id_token_signing_alg_values_supported,
 * claims_supported) are permitted extension metadata under RFC 8414 §2.
 */
function providerMetadata(base: string) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    userinfo_endpoint: `${base}/api/oauth/userinfo`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    revocation_endpoint_auth_methods_supported: [
      "client_secret_post",
      "client_secret_basic",
      "none",
    ],
    introspection_endpoint: `${base}/api/oauth/introspect`,
    introspection_endpoint_auth_methods_supported: [
      "client_secret_post",
      "client_secret_basic",
    ],
    jwks_uri: `${base}/.well-known/jwks.json`,
    scopes_supported: SCOPES_SUPPORTED,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    access_token_signing_alg_values_supported: ["ML-DSA-65"],
    token_endpoint_auth_methods_supported: [
      "client_secret_post",
      "client_secret_basic",
      "none",
    ],
    code_challenge_methods_supported: ["S256", "plain"],
    claims_supported: [
      "sub",
      "iss",
      "aud",
      "exp",
      "iat",
      "nonce",
      "name",
      "preferred_username",
      "picture",
      "email",
      "email_verified",
    ],
  };
}

// OpenID Connect Discovery 1.0 §3
app.get("/openid-configuration", (c) =>
  c.json(providerMetadata(c.env.APP_URL)),
);

// RFC 8414 §3 — OAuth 2.0 Authorization Server Metadata
app.get("/oauth-authorization-server", (c) =>
  c.json(providerMetadata(c.env.APP_URL)),
);

app.get("/jwks.json", async (c) => {
  const rsa = await getRsaKeyPair(c.env.KV_SESSIONS);
  return c.json({
    keys: [
      {
        kty: rsa.publicKeyJwk.kty,
        use: "sig",
        alg: "RS256",
        kid: rsa.kid,
        n: rsa.publicKeyJwk.n,
        e: rsa.publicKeyJwk.e,
      },
    ],
  });
});

export default app;
