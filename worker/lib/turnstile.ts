// Turnstile challenge-script endpoint selection.
//
// Cloudflare serves the Turnstile widget JS from two hosts: the global
// challenges.cloudflare.com and a Mainland-China-accelerated mirror,
// challenges.cloudflare-cn.com. Which host the *browser* loads is configurable
// per site (turnstile_endpoint_mode). The server resolves the region-based
// server-side mode here — it has the request geolocation — while the remaining
// client-side modes are passed through for the browser to resolve.
//
// Server-side siteverify is unaffected: tokens minted by either host verify
// against the global https://challenges.cloudflare.com/turnstile/v0/siteverify,
// so worker/middleware/captcha.ts needs no host switch.

import type { SiteConfig, TurnstileEndpointMode } from "../types";
import { getGeo } from "./geo";

/** Directive sent to the browser. The server has already collapsed
 *  "server_region" into a concrete "global"/"china"; the client-side modes
 *  pass through for the browser to resolve against its own environment. */
export type TurnstileEndpointDirective =
  | "global"
  | "china"
  | "client_language"
  | "client_region";

/**
 * Collapse the admin-configured mode into the directive the browser receives.
 * `country` is the ISO 3166-1 alpha-2 country from the request's edge
 * geolocation (see lib/geo.ts), null when unknown — used only by
 * "server_region".
 */
function resolveTurnstileEndpoint(
  mode: TurnstileEndpointMode | undefined,
  country: string | null,
): TurnstileEndpointDirective {
  switch (mode) {
    case "china":
      return "china";
    case "client_language":
      return "client_language";
    case "client_region":
      return "client_region";
    case "server_region":
      return country === "CN" ? "china" : "global";
    case "global":
    default:
      return "global";
  }
}

/**
 * Directive for this request. Every public payload that carries a Turnstile
 * site key (site info, team-join info, OAuth 2FA info) carries this alongside
 * it so the browser knows which host to load the widget from.
 */
export function turnstileEndpointFor(
  c: { req: { raw: Request } },
  config: Pick<SiteConfig, "turnstile_endpoint_mode">,
): TurnstileEndpointDirective {
  return resolveTurnstileEndpoint(
    config.turnstile_endpoint_mode,
    getGeo(c).country,
  );
}
