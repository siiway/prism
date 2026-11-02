// Inbound email verification: proving an address by sending an email to the
// instance (Email Workers or IMAP poll) instead of clicking a link.

import { Hono } from "hono";
import { getConfig } from "../lib/config";
import { getIp } from "../lib/clientIp";
import { randomId, randomBase64url } from "../lib/crypto";
import {
  emailConfigFromSite,
  sendEmail,
  verifyEmailTemplate,
} from "../lib/email";
import { hashSecret, isHashedSecret } from "../lib/secretCrypto";
import {
  verifyCaptchaToken,
  extractCaptchaSubmission,
} from "../middleware/captcha";
import type { TurnstileVariant } from "../lib/turnstile";
import { requireAuth } from "../middleware/auth";
import type { Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

// ─── Inbound email verification (user sends email to us) ─────────────────────

app.post("/email-verify-code", requireAuth, async (c) => {
  const body = await c.req
    .json<{
      captcha_token?: string;
      captcha_variant?: TurnstileVariant;
      pow_challenge?: string;
      pow_nonce?: number;
    }>()
    .catch(
      (): {
        captcha_token?: string;
        captcha_variant?: TurnstileVariant;
        pow_challenge?: string;
        pow_nonce?: number;
      } => ({}),
    );
  const ip = getIp(c);
  const captchaOk = await verifyCaptchaToken(
    c.env.DB,
    extractCaptchaSubmission(body),
    ip,
    c.env,
  );
  if (!captchaOk.success)
    return c.json({ error: captchaOk.error ?? "captcha_failed" }, 403);

  const authUser = c.get("user");

  const user = await c.env.DB.prepare(
    "SELECT id, email_verified, email_verify_code FROM users WHERE id = ?",
  )
    .bind(authUser.id)
    .first<{
      id: string;
      email_verified: number;
      email_verify_code: string | null;
    }>();
  if (!user) return c.json({ error: "user_not_found" }, 404);
  if (user.email_verified)
    return c.json({ error: "email_already_verified" }, 400);

  // Reuse existing code or generate a new one. Stored value is the
  // keyed hash (or legacy plaintext when SECRETS_KEY is unbound) — but
  // the user is shown the plaintext via the response so they can paste
  // it into the email subject.
  let code: string;
  const storedCode = user.email_verify_code;
  if (storedCode && !isHashedSecret(storedCode)) {
    // Legacy unmigrated plaintext row — return as-is so the user can
    // continue with the same code. Migration will hash it later.
    code = storedCode;
  } else if (storedCode) {
    // Already hashed: we can't recover the plaintext, so generate a
    // fresh code and overwrite. (Rare path: only triggers if the user
    // previously requested a code, then SECRETS_KEY was rotated /
    // migration ran.)
    code = randomId(12);
    const newStored = await hashSecret(c.env, code);
    await c.env.DB.prepare(
      "UPDATE users SET email_verify_code = ? WHERE id = ?",
    )
      .bind(newStored, user.id)
      .run();
  } else {
    code = randomId(12);
    const newStored = await hashSecret(c.env, code);
    await c.env.DB.prepare(
      "UPDATE users SET email_verify_code = ? WHERE id = ?",
    )
      .bind(newStored, user.id)
      .run();
  }

  const config = await getConfig(c.env.DB);

  if (config.email_receive_provider === "imap") {
    // IMAP mode: user sends email with code as subject to the IMAP mailbox
    return c.json({ address: config.imap_user, code, method: "imap" as const });
  }

  // Cloudflare Email Workers mode: user sends email to verify-<code>@<host>
  const emailHost =
    config.email_receive_host || new URL(c.env.APP_URL).hostname;
  const verifyAddress = `verify-${code}@${emailHost}`;
  return c.json({ address: verifyAddress, code, method: "email" as const });
});

app.post("/check-email-verification", requireAuth, async (c) => {
  const authUser = c.get("user");

  // Quick DB check first
  const user = await c.env.DB.prepare(
    "SELECT email_verified FROM users WHERE id = ?",
  )
    .bind(authUser.id)
    .first<{ email_verified: number }>();
  if (!user) return c.json({ error: "user_not_found" }, 404);
  if (user.email_verified) return c.json({ verified: true });

  // If IMAP, do an on-demand poll to process any pending emails
  const config = await getConfig(c.env.DB);
  if (config.email_receive_provider === "imap") {
    if (config.imap_host && config.imap_user && config.imap_password) {
      try {
        const { runImapPoll } = await import("../cron/imap-poll");
        await runImapPoll(c.env, c.env.KV_CACHE);
      } catch {
        // IMAP poll failure shouldn't block the status check
      }
    }
  }

  // Re-check after potential IMAP poll
  const updated = await c.env.DB.prepare(
    "SELECT email_verified FROM users WHERE id = ?",
  )
    .bind(authUser.id)
    .first<{ email_verified: number }>();

  return c.json({ verified: !!updated?.email_verified });
});

app.post("/resend-verify-email", requireAuth, async (c) => {
  const body = await c.req
    .json<{
      captcha_token?: string;
      captcha_variant?: TurnstileVariant;
      pow_challenge?: string;
      pow_nonce?: number;
    }>()
    .catch(
      (): {
        captcha_token?: string;
        captcha_variant?: TurnstileVariant;
        pow_challenge?: string;
        pow_nonce?: number;
      } => ({}),
    );
  const ip = getIp(c);
  const captchaOk = await verifyCaptchaToken(
    c.env.DB,
    extractCaptchaSubmission(body),
    ip,
    c.env,
  );
  if (!captchaOk.success)
    return c.json({ error: captchaOk.error ?? "captcha_failed" }, 403);

  const authUser = c.get("user");

  const user = await c.env.DB.prepare(
    "SELECT id, email, email_verified, display_name FROM users WHERE id = ?",
  )
    .bind(authUser.id)
    .first<{
      id: string;
      email: string;
      email_verified: number;
      display_name: string;
    }>();
  if (!user) return c.json({ error: "user_not_found" }, 404);
  if (user.email_verified)
    return c.json({ error: "email_already_verified" }, 400);

  const config = await getConfig(c.env.DB);
  if (config.email_provider === "none")
    return c.json({ error: "email_not_configured" }, 503);

  // Generate a fresh token; stored as the keyed hash but emailed as
  // plaintext so the click-through URL is verifiable.
  const verifyToken = randomBase64url(24);
  const storedVerifyToken = await hashSecret(c.env, verifyToken);
  await c.env.DB.prepare("UPDATE users SET email_verify_token = ? WHERE id = ?")
    .bind(storedVerifyToken, user.id)
    .run();

  const verifyUrl = `${c.env.APP_URL}/api/auth/verify-email?token=${verifyToken}`;
  const tmpl = verifyEmailTemplate(config.site_name, verifyUrl);
  await sendEmail(
    c.env,
    {
      to: user.email,
      subject: `Verify your email — ${config.site_name}`,
      ...tmpl,
    },
    emailConfigFromSite(config),
  );

  return c.json({ ok: true });
});

export default app;
