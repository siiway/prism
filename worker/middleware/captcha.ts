// Captcha verification middleware (Turnstile, hCaptcha, reCAPTCHA, PoW)

import { getConfig } from "../lib/config";
import { verifyPoW } from "../lib/crypto";

interface CaptchaResult {
  success: boolean;
  error?: string;
}

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

export async function verifyCaptchaToken(
  db: D1Database,
  token: string | undefined,
  powChallenge: string | undefined,
  powNonce: number | undefined,
  ip: string,
): Promise<CaptchaResult> {
  const config = await getConfig(db);

  if (config.captcha_provider === "none") {
    return { success: true };
  }

  if (config.captcha_provider === "pow") {
    if (!powChallenge || powNonce === undefined) {
      return { success: false, error: "PoW solution required" };
    }
    const ok = await verifyPoW(powChallenge, powNonce, config.pow_difficulty);
    return { success: ok, error: ok ? undefined : "Invalid PoW solution" };
  }

  if (!token) {
    return { success: false, error: "Captcha token required" };
  }

  switch (config.captcha_provider) {
    case "turnstile":
      return verifyTurnstile(token, config.captcha_secret_key, ip);
    case "hcaptcha":
      return verifyHCaptcha(token, config.captcha_secret_key, ip);
    case "recaptcha":
      return verifyRecaptcha(token, config.captcha_secret_key, ip);
    default:
      return { success: true };
  }
}
