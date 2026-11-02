// OAuth client helpers shared by the authorization server's endpoints:
// grant-type identifiers, reading a request body, client authentication,
// and the app summary shown on consent screens.

import type { Context } from "hono";
import { timingSafeSecretEqual } from "./secretCrypto";
import { parseBasicAuth } from "./basicAuth";
import {
  assertionClientId,
  CLIENT_ASSERTION_TYPE,
  verifyClientAssertion,
} from "./clientAssertion";
import { proxyImageUrl } from "./proxyImage";
import type { OAuthAppRow, Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };

/** RFC 8628 device authorization grant. */
export const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

/** RFC 8693 token exchange. */
export const TOKEN_EXCHANGE_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:token-exchange";
export const TOKEN_TYPE_ACCESS_TOKEN =
  "urn:ietf:params:oauth:token-type:access_token";

/**
 * Authenticate an OAuth client against its stored secret.
 *
 * Public clients (PKCE) carry no secret and always pass — PKCE binds the
 * exchange instead. Confidential clients are verified in constant time via
 * timingSafeSecretEqual; this returns false (never throws) when either the
 * stored or presented secret is empty, so a confidential app whose secret is
 * unset can never authenticate by sending an empty one.
 *
 * Centralized so the three token-issuing endpoints (token, 2FA verify,
 * authorize-confirm) enforce byte-for-byte identical client-auth rules.
 */
async function clientSecretValid(
  env: Env,
  oauthApp: OAuthAppRow,
  clientSecret: string | undefined,
): Promise<boolean> {
  if (oauthApp.is_public) return true;
  return timingSafeSecretEqual(env, oauthApp.client_secret, clientSecret ?? "");
}

/**
 * Build the public "app" summary returned by the consent and 2FA screens.
 * Proxies the icon URL so the browser fetches it through the image proxy and
 * maps the SQLite 0/1 flags to booleans. Shared so both screens describe an
 * app identically.
 */
export async function buildConsentAppSummary(
  env: Env,
  app: OAuthAppRow,
  isVerified: boolean,
) {
  return {
    id: app.id,
    name: app.name,
    description: app.description,
    icon_url: await proxyImageUrl(env.APP_URL, env.DB, app.icon_url),
    unproxied_icon_url: app.icon_url,
    website_url: app.website_url,
    is_verified: isVerified,
    is_official: app.is_official === 1,
    is_first_party: app.is_first_party === 1,
    is_public: app.is_public === 1,
  };
}

/** Read an OAuth request body as either JSON or form-encoded, exposing the raw
 *  URLSearchParams (for repeated parameters like `resource`) and the parsed
 *  JSON value when present. */
export async function readOAuthBody(c: Context<AppEnv>): Promise<{
  params: Record<string, string>;
  form: URLSearchParams | null;
  json: Record<string, unknown> | null;
}> {
  const ct = c.req.header("Content-Type") ?? "";
  if (ct.includes("application/json")) {
    const json = await c.req
      .json<Record<string, unknown>>()
      .catch(() => ({}) as Record<string, unknown>);
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(json))
      if (typeof v === "string") params[k] = v;
    return { params, form: null, json };
  }
  const text = await c.req.text();
  const form = new URLSearchParams(text);
  return { params: Object.fromEntries(form), form, json: null };
}

/** Audiences a private_key_jwt client assertion may name (RFC 7523 §3): the
 *  issuer, the token endpoint, and the concrete endpoint being called. */
function acceptedAssertionAudiences(c: Context<AppEnv>): string[] {
  const base = c.env.APP_URL;
  const url = new URL(c.req.url);
  return [base, `${base}/api/oauth/token`, `${url.origin}${url.pathname}`];
}

/**
 * Authenticate the calling OAuth client. Supports three methods:
 *   - private_key_jwt (RFC 7523): a signed `client_assertion` verified against
 *     the client's registered JWKS.
 *   - client_secret_basic / client_secret_post: a shared secret.
 *   - none: a public client (client_id only, PKCE binds the exchange).
 *
 * `usedBasic` reports whether an HTTP Basic header was presented, so the caller
 * can add the RFC 6749 §5.2 `WWW-Authenticate` challenge to a 401.
 */
export async function authenticateClient(
  c: Context<AppEnv>,
  params: Record<string, string>,
): Promise<
  | {
      ok: true;
      app: OAuthAppRow;
      method: "none" | "client_secret" | "private_key_jwt";
      usedBasic: boolean;
    }
  | { ok: false; usedBasic: boolean; badRequest?: boolean }
> {
  const basic = parseBasicAuth(c.req.header("Authorization"));
  const usedBasic = !!basic;

  // ── private_key_jwt (RFC 7523) ─────────────────────────────────────────────
  const assertion = params.client_assertion;
  const assertionType = params.client_assertion_type;
  if (assertion || assertionType) {
    if (assertionType !== CLIENT_ASSERTION_TYPE || !assertion)
      return { ok: false, usedBasic, badRequest: true };
    const clientId = params.client_id ?? assertionClientId(assertion);
    const app = clientId
      ? await c.env.DB.prepare(
          "SELECT * FROM oauth_apps WHERE client_id = ? AND is_active = 1",
        )
          .bind(clientId)
          .first<OAuthAppRow>()
      : null;
    if (!app) return { ok: false, usedBasic };
    const ok = await verifyClientAssertion(
      c.env,
      app,
      assertion,
      acceptedAssertionAudiences(c),
    );
    return ok
      ? { ok: true, app, method: "private_key_jwt", usedBasic }
      : { ok: false, usedBasic };
  }

  // ── client_secret_* / none ─────────────────────────────────────────────────
  const clientId = basic?.clientId ?? params.client_id;
  const clientSecret = basic?.clientSecret ?? params.client_secret;
  const app = clientId
    ? await c.env.DB.prepare(
        "SELECT * FROM oauth_apps WHERE client_id = ? AND is_active = 1",
      )
        .bind(clientId)
        .first<OAuthAppRow>()
    : null;
  if (!app) return { ok: false, usedBasic };
  // A client that registered private_key_jwt must not fall back to a secret.
  if (app.token_endpoint_auth_method === "private_key_jwt")
    return { ok: false, usedBasic };
  if (!(await clientSecretValid(c.env, app, clientSecret)))
    return { ok: false, usedBasic };
  return {
    ok: true,
    app,
    method: app.is_public ? "none" : "client_secret",
    usedBasic,
  };
}
