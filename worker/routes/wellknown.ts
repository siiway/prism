// /.well-known/* endpoints

import { Hono } from "hono";
import { cors } from "hono/cors";
import { getRsaKeyPair, getConfigValue } from "../lib/config";
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
    // RFC 8628 Device Authorization Grant
    device_authorization_endpoint: `${base}/api/oauth/device_authorization`,
    // RFC 9126 Pushed Authorization Requests
    pushed_authorization_request_endpoint: `${base}/api/oauth/par`,
    require_pushed_authorization_requests: false,
    // RFC 7591 Dynamic Client Registration
    registration_endpoint: `${base}/api/oauth/register`,
    // OpenID Connect RP-Initiated + Back-Channel Logout
    end_session_endpoint: `${base}/api/oauth/end_session`,
    backchannel_logout_supported: true,
    backchannel_logout_session_supported: true,
    jwks_uri: `${base}/.well-known/jwks.json`,
    scopes_supported: SCOPES_SUPPORTED,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: [
      "authorization_code",
      "refresh_token",
      "urn:ietf:params:oauth:grant-type:device_code",
      "urn:ietf:params:oauth:grant-type:token-exchange",
    ],
    // RFC 9207 — the authorization response carries an `iss` parameter.
    authorization_response_iss_parameter_supported: true,
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    access_token_signing_alg_values_supported: ["ML-DSA-65"],
    token_endpoint_auth_methods_supported: [
      "client_secret_post",
      "client_secret_basic",
      "private_key_jwt",
      "none",
    ],
    // RFC 7523 assertion signing algorithms accepted for private_key_jwt.
    token_endpoint_auth_signing_alg_values_supported: [
      "RS256",
      "ES256",
      "EdDSA",
    ],
    // RFC 9449 DPoP proof signing algorithms.
    dpop_signing_alg_values_supported: ["RS256", "ES256", "EdDSA"],
    code_challenge_methods_supported: ["S256", "plain"],
    // OIDC Core prompt / acr support.
    prompt_values_supported: ["none", "login", "consent"],
    acr_values_supported: ["pwd", "mfa"],
    claims_supported: [
      "sub",
      "iss",
      "aud",
      "exp",
      "iat",
      "nonce",
      "auth_time",
      "acr",
      "amr",
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

// RFC 9728 §3 — OAuth 2.0 Protected Resource Metadata. Describes Prism's own
// API surface as a protected resource: which authorization server issues its
// tokens, the scopes it recognises, and its DPoP support.
app.get("/oauth-protected-resource", (c) => {
  const base = c.env.APP_URL;
  return c.json({
    resource: base,
    authorization_servers: [base],
    jwks_uri: `${base}/.well-known/jwks.json`,
    scopes_supported: SCOPES_SUPPORTED,
    bearer_methods_supported: ["header"],
    resource_signing_alg_values_supported: ["ML-DSA-65"],
    // RFC 9449 — DPoP is accepted but not mandatory.
    dpop_signing_alg_values_supported: ["RS256", "ES256", "EdDSA"],
    dpop_bound_access_tokens_required: false,
  });
});

// RFC 7033 WebFinger — OpenID Connect issuer discovery. A client that only has
// a user identifier (acct:user@host or an https URL) queries this to learn the
// OP's issuer. Returns a JRD (application/jrd+json).
const OIDC_ISSUER_REL = "http://openid.net/specs/connect/1.0/issuer";
app.get("/webfinger", (c) => {
  const resource = c.req.query("resource");
  if (!resource)
    return c.json({ error: "the resource parameter is required" }, 400);
  const rel = c.req.query("rel");
  const links =
    !rel || rel === OIDC_ISSUER_REL
      ? [{ rel: OIDC_ISSUER_REL, href: c.env.APP_URL }]
      : [];
  c.header("Content-Type", "application/jrd+json");
  return c.body(JSON.stringify({ subject: resource, links }));
});

// RFC 9116 security.txt — the operator's security contact / policy. Served only
// when a contact is configured (a security.txt without Contact is invalid).
app.get("/security.txt", async (c) => {
  let contact = await getConfigValue(c.env.DB, "security_contact");
  if (!contact) return c.text("security.txt is not configured", 404);
  // A bare email address is normalised to a mailto: URI, as RFC 9116 requires
  // Contact to be a URI.
  if (contact.includes("@") && !contact.includes(":"))
    contact = `mailto:${contact}`;
  const policy = await getConfigValue(c.env.DB, "security_policy_url");
  const expires = new Date(
    Date.now() + 365 * 24 * 60 * 60 * 1000,
  ).toISOString();
  let body = `Contact: ${contact}\nExpires: ${expires}\n`;
  if (policy) body += `Policy: ${policy}\n`;
  c.header("Content-Type", "text/plain; charset=utf-8");
  return c.body(body);
});

// W3C well-known change-password: send password managers to the page where a
// user changes their password.
app.get("/change-password", (c) => c.redirect(`${c.env.APP_URL}/profile`, 302));

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
