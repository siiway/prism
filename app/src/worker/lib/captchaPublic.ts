// Public captcha descriptor shared by every payload that renders a captcha
// (site info, OAuth 2FA info, team-invite info). Centralised so the browser
// always receives the same shape and a new provider's public fields are added
// in exactly one place.
//
// Only *public* material is included — site keys, the GeeTest public id, the
// Cap endpoint/site key. Secrets never appear here.

import type { CaptchaProvider, SiteConfig } from "../types";
import type {
  PublicCaptchaConfig,
  TurnstileEndpointDirective,
} from "../../shared/api";

export type { PublicCaptchaConfig };

/**
 * Build the public captcha descriptor. `providers` is the set actually exposed
 * to this surface: pass `config.captcha_providers` normally, or `[]` to render
 * nothing (e.g. a 2FA challenge that doesn't require a captcha).
 */
export function buildPublicCaptcha(
  config: SiteConfig,
  turnstileDirective: TurnstileEndpointDirective,
  turnstileChinaSiteKey: string,
  providers: CaptchaProvider[],
): PublicCaptchaConfig {
  return {
    captcha_providers: providers,
    captcha_switch_timeout_seconds: config.captcha_switch_timeout_seconds,
    turnstile_site_key: config.turnstile_site_key,
    turnstile_endpoint: turnstileDirective,
    turnstile_china_site_key: turnstileChinaSiteKey,
    hcaptcha_site_key: config.hcaptcha_site_key,
    recaptcha_site_key: config.recaptcha_site_key,
    geetest_captcha_id: config.geetest_captcha_id,
    cap_mode: config.cap_mode,
    cap_site_key: config.cap_site_key,
    cap_api_endpoint: config.cap_api_endpoint,
  };
}
