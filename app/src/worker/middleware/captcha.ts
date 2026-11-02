// Captcha verification middleware.
//
// The site enables an *ordered set* of providers (config.captcha_providers).
// Element 0 is the default the browser renders first; the rest are alternates a
// visitor may switch to. A submission therefore names which provider produced
// it (`provider`); this middleware confirms that provider is a member of the
// enabled set and dispatches to its verifier. A token for a provider that is
// not enabled is rejected — the client cannot smuggle in a provider the mod
// never turned on.

import type { CaptchaProvider } from "../../shared/types";
import { getConfig } from "../lib/config";
import { getIp } from "../lib/clientIp";
import { verifyPowChallenge } from "../lib/pow";
import { verifyGeetest, type GeetestOutput } from "../lib/geetest";
import { verifyCapToken } from "../lib/cap";
import { decryptSecret } from "../lib/secretCrypto";
import type { TurnstileVariant } from "../lib/turnstile";

interface CaptchaResult {
  success: boolean;
  error?: string;
}

/** Everything a gated route may carry to prove a captcha was solved. The
 *  `provider` discriminator says which widget minted the proof; the remaining
 *  fields are provider-specific and only the ones for `provider` are read. */
export interface CaptchaSubmission {
  provider?: CaptchaProvider;
  captcha_token?: string;
  captcha_variant?: TurnstileVariant;
  pow_challenge?: string;
  pow_nonce?: number;
  geetest?: GeetestOutput;
  cap_token?: string;
}

/** Pull the captcha fields out of a parsed request body. Keeps the route
 *  handlers from re-listing the field set at every callsite. */
function extractCaptchaSubmission(body: unknown): CaptchaSubmission {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    provider: b.provider as CaptchaProvider | undefined,
    captcha_token: b.captcha_token as string | undefined,
    captcha_variant: b.captcha_variant as TurnstileVariant | undefined,
    pow_challenge: b.pow_challenge as string | undefined,
    pow_nonce: b.pow_nonce as number | undefined,
    geetest: b.geetest as GeetestOutput | undefined,
    cap_token: b.cap_token as string | undefined,
  };
}

const POW_ERRORS: Record<string, string> = {
  malformed: "pow_malformed",
  bad_signature: "pow_bad_signature",
  expired: "pow_expired",
  replayed: "pow_replayed",
  wrong_difficulty: "pow_invalid",
};

async function verifyTurnstile(
  token: string,
  secretKey: string,
  ip: string,
): Promise<CaptchaResult> {
  const res = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: secretKey,
        response: token,
        remoteip: ip,
      }),
    },
  );
  const data = (await res.json()) as { success: boolean };
  return { success: data.success };
}

async function verifyHCaptcha(
  token: string,
  secretKey: string,
  ip: string,
): Promise<CaptchaResult> {
  const body = new URLSearchParams({
    secret: secretKey,
    response: token,
    remoteip: ip,
  });
  const res = await fetch("https://hcaptcha.com/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as { success: boolean };
  return { success: data.success };
}

async function verifyRecaptcha(
  token: string,
  secretKey: string,
  ip: string,
): Promise<CaptchaResult> {
  const body = new URLSearchParams({
    secret: secretKey,
    response: token,
    remoteip: ip,
  });
  const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as { success: boolean; score?: number };
  // For reCAPTCHA v3, require score >= 0.5
  const ok = data.success && (data.score === undefined || data.score >= 0.5);
  return { success: ok };
}

/**
 * Verify a captcha submission against the site's enabled provider set.
 *
 * The provider is chosen as follows: the client's declared `provider` if it is
 * a member of the enabled set, otherwise the default (element 0) — which keeps
 * older clients that don't send the field working as long as they used the
 * default provider. A declared provider that is *not* enabled is rejected
 * outright rather than silently downgraded, so a stale/forged field cannot pick
 * a provider the site turned off.
 */
async function verifyCaptchaToken(
  db: D1Database,
  submission: CaptchaSubmission,
  ip: string,
  env?: Env,
): Promise<CaptchaResult> {
  const config = await getConfig(db);

  // Enabled set with "none" filtered out. Empty means captcha is off.
  const enabled: CaptchaProvider[] = config.captcha_providers.filter(
    (p) => p !== "none",
  );
  if (enabled.length === 0) {
    return { success: true };
  }

  const declared = submission.provider;
  const provider: CaptchaProvider =
    declared && enabled.includes(declared) ? declared : enabled[0];

  // A declared provider outside the enabled set is a hard failure.
  if (declared && !enabled.includes(declared)) {
    return { success: false, error: "captcha_provider_disabled" };
  }

  // Decrypt an at-rest secret; no-op when SECRETS_KEY isn't bound or the value
  // is already plaintext.
  const decrypt = async (v: string): Promise<string> =>
    env ? ((await decryptSecret(env, v)) ?? "") : v;

  switch (provider) {
    case "pow": {
      if (!env) return { success: false, error: "captcha_unavailable" };
      if (!submission.pow_challenge || submission.pow_nonce === undefined) {
        return { success: false, error: "captcha_required" };
      }
      const result = await verifyPowChallenge(
        env,
        submission.pow_challenge,
        submission.pow_nonce,
        config.pow_difficulty,
      );
      return result.ok
        ? { success: true }
        : {
            success: false,
            error: POW_ERRORS[result.reason] ?? "pow_invalid",
          };
    }

    case "cap": {
      if (!env) return { success: false, error: "captcha_unavailable" };
      if (!submission.cap_token) {
        return { success: false, error: "captcha_required" };
      }
      const ok = await verifyCapToken(
        env,
        submission.cap_token,
        config.cap_mode,
        {
          apiEndpoint: config.cap_api_endpoint,
          siteKey: config.cap_site_key,
          secretKey: await decrypt(config.cap_secret_key),
        },
      );
      return ok
        ? { success: true }
        : { success: false, error: "captcha_failed" };
    }

    case "geetest": {
      if (!submission.geetest) {
        return { success: false, error: "captcha_required" };
      }
      const ok = await verifyGeetest(
        submission.geetest,
        config.geetest_captcha_id,
        await decrypt(config.geetest_captcha_key),
        config.geetest_fail_open,
      );
      return ok
        ? { success: true }
        : { success: false, error: "captcha_failed" };
    }

    case "turnstile": {
      if (!submission.captcha_token) {
        return { success: false, error: "captcha_required" };
      }
      // Two Turnstile widgets can be configured — the global one and a
      // region:"china" one for visitors on challenges.cloudflare-cn.com — and a
      // token only verifies against the secret of the widget that minted it.
      // The browser reports which one via captcha_variant; anything else falls
      // back to the global secret, where a mismatched token simply fails.
      const useChinaSecret =
        submission.captcha_variant === "china" &&
        config.turnstile_china_site_key.trim() !== "" &&
        config.turnstile_china_secret_key !== "";
      const secret = await decrypt(
        useChinaSecret
          ? config.turnstile_china_secret_key
          : config.turnstile_secret_key,
      );
      return verifyTurnstile(submission.captcha_token, secret, ip);
    }

    case "hcaptcha": {
      if (!submission.captcha_token) {
        return { success: false, error: "captcha_required" };
      }
      return verifyHCaptcha(
        submission.captcha_token,
        await decrypt(config.hcaptcha_secret_key),
        ip,
      );
    }

    case "recaptcha": {
      if (!submission.captcha_token) {
        return { success: false, error: "captcha_required" };
      }
      return verifyRecaptcha(
        submission.captcha_token,
        await decrypt(config.recaptcha_secret_key),
        ip,
      );
    }

    default:
      return { success: true };
  }
}

/**
 * Check the captcha fields of a request body. Returns null when they pass
 * (or no captcha is enabled), otherwise the error code to answer with.
 */
export async function captchaRefusal(
  c: { env: Env; req: { header: (h: string) => string | undefined } },
  body: unknown,
): Promise<string | null> {
  const result = await verifyCaptchaToken(
    c.env.DB,
    extractCaptchaSubmission(body),
    getIp(c),
    c.env,
  );
  return result.success ? null : (result.error ?? "captcha_failed");
}
