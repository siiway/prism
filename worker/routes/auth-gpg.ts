// Signing in with a GPG key: /api/auth/gpg/* — a challenge the user clearsigns
// with a key registered on their account.

import { Hono } from "hono";
import { getConfig } from "../lib/config";
import { getIp } from "../lib/clientIp";
import { geoJson } from "../lib/geo";
import { randomId } from "../lib/crypto";
import { verifyAnyTotp } from "../lib/totp";
import { verifyClearsign } from "../lib/gpg";
import { rateLimitIp } from "../middleware/rateLimit";
import { logLoginError } from "../lib/loginRateLimit";
import { issueSession } from "../lib/session";
import { toSessionUser } from "../lib/sessionUser";
import type { UserRow, Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

// ─── GPG login ───────────────────────────────────────────────────────────────

// Step 1: request a challenge
app.post("/gpg-challenge", async (c) => {
  const ip = getIp(c);
  const { ipv6_rate_limit_prefix, gpg_challenge_prefix, site_name } =
    await getConfig(c.env.DB);
  const rl = await rateLimitIp(
    c.env.DB,
    ip,
    "gpg-challenge",
    30,
    60,
    ipv6_rate_limit_prefix,
  );
  if (!rl.allowed) return c.json({ error: "too_many_requests" }, 429);
  const body = await c.req.json<{ identifier: string }>();
  if (!body.identifier?.trim())
    return c.json(
      { error: "field_required", params: { field: "identifier" } },
      400,
    );

  const identifier = body.identifier.toLowerCase().trim();
  const isEmail = identifier.includes("@");
  const user = await (isEmail
    ? c.env.DB.prepare("SELECT id FROM users WHERE email = ? AND kind = 'user'")
        .bind(identifier)
        .first<{ id: string }>()
    : c.env.DB.prepare(
        "SELECT id FROM users WHERE username = ? AND kind = 'user'",
      )
        .bind(identifier)
        .first<{ id: string }>());

  // Always return success to avoid user enumeration
  const userId = user?.id ?? randomId(16);

  const challenge = randomId(32);
  const now = Math.floor(Date.now() / 1000);
  const prefix = gpg_challenge_prefix.trim();
  const text = [
    `${site_name} login`,
    ...(prefix ? [prefix] : []),
    `User: ${identifier}`,
    `Challenge: ${challenge}`,
    `Timestamp: ${now}`,
  ].join("\n");

  await c.env.KV_CACHE.put(`gpg:challenge:${challenge}`, userId, {
    expirationTtl: 300, // 5 minutes
  });

  return c.json({ challenge, text });
});

// Step 2: verify the signed challenge
app.post("/gpg-login", async (c) => {
  const rlIp = getIp(c);
  const gpgLoginConfig = await getConfig(c.env.DB);
  const rl2 = await rateLimitIp(
    c.env.DB,
    rlIp,
    "gpg-login",
    10,
    60,
    gpgLoginConfig.ipv6_rate_limit_prefix,
  );
  if (!rl2.allowed) return c.json({ error: "too_many_requests" }, 429);
  const body = await c.req.json<{
    identifier: string;
    signed_message: string;
    totp_code?: string;
  }>();
  if (!body.identifier?.trim() || !body.signed_message?.trim())
    return c.json(
      {
        error: "fields_required",
        params: { fields: "identifier, signed_message" },
      },
      400,
    );

  const ip = getIp(c);
  const ua = c.req.header("User-Agent") ?? null;
  const identifier = body.identifier.toLowerCase().trim();
  const isEmail = identifier.includes("@");

  const user = await (isEmail
    ? c.env.DB.prepare("SELECT * FROM users WHERE email = ? AND kind = 'user'")
        .bind(identifier)
        .first<UserRow>()
    : c.env.DB.prepare(
        "SELECT * FROM users WHERE username = ? AND kind = 'user'",
      )
        .bind(identifier)
        .first<UserRow>());

  if (!user || !user.is_active) {
    c.executionCtx.waitUntil(
      logLoginError(
        c.env.DB,
        "invalid_credentials",
        body.identifier,
        ip,
        ua,
        geoJson(c),
        {},
      ).catch(() => {}),
    );
    return c.json({ error: "invalid_credentials" }, 401);
  }

  // Load the user's GPG keys
  const { results: gpgKeys } = await c.env.DB.prepare(
    "SELECT id, public_key, key_id FROM user_gpg_keys WHERE user_id = ?",
  )
    .bind(user.id)
    .all<{ id: string; public_key: string; key_id: string }>();

  if (gpgKeys.length === 0) {
    c.executionCtx.waitUntil(
      logLoginError(
        c.env.DB,
        "gpg_no_keys",
        body.identifier,
        ip,
        ua,
        geoJson(c),
        {
          user_id: user.id,
        },
      ).catch(() => {}),
    );
    return c.json({ error: "no_gpg_keys" }, 401);
  }

  // Verify the clearsign signature
  let verifyResult: Awaited<ReturnType<typeof verifyClearsign>>;
  try {
    verifyResult = await verifyClearsign(
      body.signed_message,
      gpgKeys.map((k) => k.public_key),
    );
  } catch {
    c.executionCtx.waitUntil(
      logLoginError(
        c.env.DB,
        "gpg_invalid_signature",
        body.identifier,
        ip,
        ua,
        geoJson(c),
        { user_id: user.id },
      ).catch(() => {}),
    );
    return c.json({ error: "signature_invalid" }, 401);
  }

  if (!verifyResult.valid) {
    c.executionCtx.waitUntil(
      logLoginError(
        c.env.DB,
        "gpg_invalid_signature",
        body.identifier,
        ip,
        ua,
        geoJson(c),
        { user_id: user.id },
      ).catch(() => {}),
    );
    return c.json({ error: "signature_invalid" }, 401);
  }

  // Extract and validate the challenge from the signed text
  const challengeMatch = verifyResult.signedText.match(
    /\nChallenge:\s*([a-f0-9]+)/,
  );
  if (!challengeMatch) {
    return c.json({ error: "signed_message_invalid" }, 401);
  }
  const challenge = challengeMatch[1];

  // Verify challenge was issued for this user
  const storedUserId = await c.env.KV_CACHE.get(`gpg:challenge:${challenge}`);
  if (!storedUserId || storedUserId !== user.id) {
    c.executionCtx.waitUntil(
      logLoginError(
        c.env.DB,
        "gpg_challenge_mismatch",
        body.identifier,
        ip,
        ua,
        geoJson(c),
        { user_id: user.id },
      ).catch(() => {}),
    );
    return c.json({ error: "challenge_expired" }, 401);
  }

  // Same 2FA gate the password flow applies. A GPG key is a possession
  // factor, not a second one: without this, an account that enabled TOTP
  // could still be entered with the key alone, which is not what enabling it
  // promises. Checked before the challenge is consumed so the client can
  // resubmit the signed message with a code instead of signing again.
  //
  // The account holder can opt out via `gpg_require_2fa = 0` on the user row
  // (Security > GPG keys > "Require 2FA after GPG verification"). That flag
  // asserts explicit trust in the signing key as a standalone factor; when
  // clear, we skip the TOTP prompt even if authenticators are enrolled.
  const gpgTotpCount = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM totp_authenticators WHERE user_id = ? AND enabled = 1",
  )
    .bind(user.id)
    .first<{ n: number }>();
  if ((gpgTotpCount?.n ?? 0) > 0 && user.gpg_require_2fa !== 0) {
    if (!body.totp_code)
      return c.json({ error: "totp_required", totp_required: true }, 200);
    if (!(await verifyAnyTotp(c.env, user.id, body.totp_code))) {
      c.executionCtx.waitUntil(
        logLoginError(
          c.env.DB,
          "totp_invalid",
          body.identifier,
          ip,
          ua,
          geoJson(c),
          { user_id: user.id },
        ).catch(() => {}),
      );
      return c.json({ error: "totp_invalid" }, 401);
    }
  }

  // Consume the challenge (one-time use)
  await c.env.KV_CACHE.delete(`gpg:challenge:${challenge}`);

  // Update last_used_at on the matching key
  if (verifyResult.signerKeyId) {
    const matchedKey = gpgKeys.find((k) =>
      k.key_id.endsWith(verifyResult.signerKeyId!),
    );
    if (matchedKey) {
      c.executionCtx.waitUntil(
        c.env.DB.prepare(
          "UPDATE user_gpg_keys SET last_used_at = ? WHERE id = ?",
        )
          .bind(Math.floor(Date.now() / 1000), matchedKey.id)
          .run(),
      );
    }
  }

  const ttl = gpgLoginConfig.session_ttl_days * 24 * 60 * 60;
  await issueSession(c, user, ttl);
  return c.json({
    user: await toSessionUser(c.env.APP_URL, c.env.DB, user),
  });
});

export default app;
