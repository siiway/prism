// /.well-known/* endpoints

import { Hono } from "hono";
import { getRsaKeyPair } from "../lib/config";
import type { Variables } from "../types";

const SCOPES_SUPPORTED = [
  "openid",
  "profile",
  "profile:write",
  "email",
  "apps:read",
  "apps:write",
  "teams:read",
  "teams:write",
  "teams:create",
  "teams:delete",
  "domains:read",
  "domains:write",
  "gpg:read",
  "gpg:write",
  "social:read",
  "social:write",
  "admin:users:read",
  "admin:users:write",
  "admin:users:delete",
  "admin:config:read",
  "admin:config:write",
  "admin:invites:read",
  "admin:invites:create",
  "admin:invites:delete",
  "admin:webhooks:read",
  "admin:webhooks:write",
  "admin:webhooks:delete",
  "webhooks:read",
  "webhooks:write",
  "offline_access",
];

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

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
  const { kid, publicKeyJwk } = await getRsaKeyPair(c.env.KV_SESSIONS);
  return c.json({
    keys: [
      {
        kty: publicKeyJwk.kty,
        use: "sig",
        alg: "RS256",
        kid,
        n: publicKeyJwk.n,
        e: publicKeyJwk.e,
      },
    ],
  });
});

export default app;
