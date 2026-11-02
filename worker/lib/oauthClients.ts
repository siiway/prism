// OAuth client helpers shared by the authorization server's endpoints:
// grant-type identifiers, client-secret authentication, and the app summary
// shown on consent screens.

import { timingSafeSecretEqual } from "./secretCrypto";
import { proxyImageUrl } from "./proxyImage";
import type { OAuthAppRow } from "../types";

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
export async function clientSecretValid(
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
