// /.well-known/* endpoints

import { Hono } from "hono";
import { cors } from "hono/cors";
import { getRsaKeyPair } from "../lib/config";
import type { Variables } from "../types";
import { USER_GRANTABLE_SCOPES } from "../../shared/scopes";

const SCOPES_SUPPORTED = USER_GRANTABLE_SCOPES;

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", cors());

app.get("/openid-configuration", (c) => {
  const base = c.env.APP_URL;
  return c.json({
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    userinfo_endpoint: `${base}/api/oauth/userinfo`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    introspection_endpoint: `${base}/api/oauth/introspect`,
    jwks_uri: `${base}/.well-known/jwks.json`,
    scopes_supported: SCOPES_SUPPORTED,
    response_types_supported: ["code"],
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
      "name",
      "preferred_username",
      "picture",
      "email",
      "email_verified",
    ],
  });
});

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
