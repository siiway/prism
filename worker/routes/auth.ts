// Auth routes: register, login, logout, 2FA, passkeys, email verify, social OAuth callback

import { Hono } from "hono";
import { getConfig, getConfigValue } from "../lib/config";
import { getIp } from "../lib/clientIp";
import { geoJson } from "../lib/geo";
import { clearSessionCookie } from "../lib/cookies";
import { deliverBackChannelLogout } from "../lib/backchannelLogout";
import {
  hashPassword,
  randomId,
  randomBase64url,
  verifyPassword,
} from "../lib/crypto";
import {
  emailConfigFromSite,
  sendEmail,
  verifyEmailTemplate,
} from "../lib/email";
import { hashSecret, hashLookupCandidate } from "../lib/secretCrypto";
import { verifyAnyTotp } from "../lib/totp";
import {
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  rowToPasskey,
} from "../lib/webauthn";
import {
  verifyCaptchaToken,
  extractCaptchaSubmission,
} from "../middleware/captcha";
import type { TurnstileVariant } from "../lib/turnstile";
import { issuePowChallenge } from "../lib/pow";
import { issueCapChallenge, redeemCapChallenge } from "../lib/cap";
import { rateLimitIp } from "../middleware/rateLimit";
import {
  checkLoginCredentialLimits,
  checkLoginRequestLimit,
  checkLoginTotpLimit,
  logLoginError,
} from "../lib/loginRateLimit";
import { requireAuth } from "../middleware/auth";
import { issueSession } from "../lib/session";
import { toSessionUser } from "../lib/sessionUser";
import {
  deliverUserEmailNotifications,
  notificationActorMetaFromHeaders,
} from "../lib/notifications";
import { teamsBlockingDowngrade } from "../lib/teamRequirements";
import {
  validateSiteInvite,
  claimSiteInvite,
  releaseSiteInvite,
} from "../lib/siteInvite";
import type { PasskeyRow, SiteInviteRow, UserRow, Variables } from "../types";
import totpRoutes from "./auth-totp";
import gpgLoginRoutes from "./auth-gpg";
import inboundEmailVerifyRoutes from "./auth-email-verify";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

// ─── Register ────────────────────────────────────────────────────────────────

app.post("/register", async (c) => {
  const ip = getIp(c);
  const config = await getConfig(c.env.DB);
  const rl = await rateLimitIp(
    c.env.DB,
    ip,
    "register",
    15,
    300,
    config.ipv6_rate_limit_prefix,
  );
  if (!rl.allowed) return c.json({ error: "too_many_requests" }, 429);
  if (!config.allow_registration)
    return c.json({ error: "registration_disabled" }, 403);

  const body = await c.req.json<{
    email: string;
    username: string;
    password: string;
    display_name?: string;
    invite_token?: string;
    captcha_token?: string;
    captcha_variant?: TurnstileVariant;
    pow_challenge?: string;
    pow_nonce?: number;
  }>();

  // Invite-only mode: validate the invite token before anything else.
  // Shared with the social/OAuth registration path (routes/connections.ts)
  // via validateSiteInvite so both entry points enforce invites identically.
  let usedInvite: SiteInviteRow | null = null;
  if (config.invite_only) {
    const result = await validateSiteInvite(
      c.env,
      body.invite_token,
      body.email,
    );
    if (!result.ok) return c.json({ error: result.error }, result.status);
    usedInvite = result.invite;
  }

  const captchaOk = await verifyCaptchaToken(
    c.env.DB,
    extractCaptchaSubmission(body),
    ip,
    c.env,
  );
  if (!captchaOk.success)
    return c.json({ error: captchaOk.error ?? "captcha_failed" }, 400);

  if (!body.email || !body.username || !body.password)
    return c.json(
      {
        error: "fields_required",
        params: { fields: "email, username, password" },
      },
      400,
    );
  if (body.password.length < 8)
    return c.json({ error: "password_too_short" }, 400);
  if (!/^[a-z0-9_.-]{2,32}$/i.test(body.username))
    return c.json({ error: "username_invalid" }, 400);

  const userId = randomId();
  const passwordHash = await hashPassword(body.password);
  const now = Math.floor(Date.now() / 1000);
  const verifyToken = config.require_email_verification
    ? randomBase64url(24)
    : null;
  const storedVerifyToken = await hashSecret(c.env, verifyToken);

  // Take the invite use before creating the account, so concurrent
  // registrations cannot all pass the earlier check and overrun the cap. The
  // claim is released below if the insert is rejected.
  if (usedInvite && !(await claimSiteInvite(c.env, usedInvite)))
    return c.json({ error: "invite_used_up" }, 403);

  try {
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, username, password_hash, display_name, role, email_verified, email_verify_token, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'user', ?, ?, 1, ?, ?)`,
    )
      .bind(
        userId,
        body.email.toLowerCase().trim(),
        body.username.toLowerCase().trim(),
        passwordHash,
        body.display_name ?? body.username,
        config.require_email_verification ? 0 : 1,
        storedVerifyToken,
        now,
        now,
      )
      .run();
  } catch (err) {
    if (usedInvite) await releaseSiteInvite(c.env, usedInvite);
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("UNIQUE"))
      return c.json({ error: "email_or_username_taken" }, 409);
    throw err;
  }

  if (verifyToken && config.email_provider !== "none") {
    const verifyUrl = `${c.env.APP_URL}/api/auth/verify-email?token=${verifyToken}`;
    const tmpl = verifyEmailTemplate(config.site_name, verifyUrl);
    await sendEmail(
      c.env,
      {
        to: body.email,
        subject: `Verify your email — ${config.site_name}`,
        ...tmpl,
      },
      emailConfigFromSite(config),
    );
  }

  if (config.require_email_verification) {
    return c.json({ ok: true }, 201);
  }

  const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(userId)
    .first<UserRow>();
  if (!user) return c.json({ error: "user_create_failed" }, 500);

  const ttl = config.session_ttl_days * 24 * 60 * 60;
  await issueSession(c, user, ttl, ["pwd"]);
  return c.json(
    { user: await toSessionUser(c.env.APP_URL, c.env.DB, user) },
    201,
  );
});

// ─── Login ───────────────────────────────────────────────────────────────────

app.post("/login", async (c) => {
  const ip = getIp(c);
  const ua = c.req.header("User-Agent") ?? null;
  const loginConfig = await getConfig(c.env.DB);

  const body = await c.req.json<{
    identifier: string; // email or username
    password: string;
    totp_code?: string;
    captcha_token?: string;
    captcha_variant?: TurnstileVariant;
    pow_challenge?: string;
    pow_nonce?: number;
  }>();

  // Generous per-IP backstop on *all* login POSTs. Its only job is to bound the
  // cost of captcha verification (a subrequest for the external providers) so it
  // can't be flooded; it is deliberately looser than the brute-force limit
  // below and is checked before captcha so a flood of junk can't run up work.
  const dosRl = await checkLoginRequestLimit(c.env.DB, ip, loginConfig);
  if (!dosRl.allowed) {
    c.executionCtx.waitUntil(
      logLoginError(
        c.env.DB,
        "rate_limited",
        null,
        ip,
        ua,
        geoJson(c),
        {},
      ).catch(() => {}),
    );
    return c.json({ error: "too_many_requests" }, 429);
  }

  // Captcha is verified before the brute-force limit is *consumed*, so a
  // wrong / expired / already-used captcha (e.g. a retried form still holding a
  // spent single-use token) returns "Captcha failed" without burning the
  // credential-attempt budget and pushing a legitimate user into "Too many
  // requests". Captcha tokens are single-use, so the client must submit a fresh
  // one on each attempt — including the TOTP follow-up step below.
  const captchaOk = await verifyCaptchaToken(
    c.env.DB,
    extractCaptchaSubmission(body),
    ip,
    c.env,
  );
  if (!captchaOk.success) {
    c.executionCtx.waitUntil(
      logLoginError(
        c.env.DB,
        "captcha_failed",
        body.identifier ?? null,
        ip,
        ua,
        geoJson(c),
        {},
      ).catch(() => {}),
    );
    return c.json({ error: captchaOk.error ?? "captcha_failed" }, 400);
  }

  // Brute-force guard: only credential attempts that cleared captcha count
  // toward it, so it measures real password tries rather than captcha misfires.
  const rl = await checkLoginCredentialLimits(
    c.env.DB,
    ip,
    body.identifier.toLowerCase().trim(),
    loginConfig,
  );
  if (!rl.allowed) {
    c.executionCtx.waitUntil(
      logLoginError(
        c.env.DB,
        "rate_limited",
        null,
        ip,
        ua,
        geoJson(c),
        {},
      ).catch(() => {}),
    );
    return c.json({ error: "too_many_requests" }, 429);
  }

  const isEmail = body.identifier.includes("@");
  const identifier = body.identifier.toLowerCase().trim();

  // Per-account throttle, alongside the per-IP one above. The IP limit alone
  // bounds nothing for an attacker spread across many addresses, which is the
  // shape both password spraying and TOTP guessing take. Keyed on the
  // identifier as typed rather than on a resolved user id, so an unknown
  // account throttles exactly like a real one and the 429 reveals nothing
  // about who exists.
  let user: UserRow | null;
  if (isEmail) {
    // Check primary email first, then alternate emails. kind='user' filter
    // is defensive: synthetic team-user rows have a teams.invalid email so
    // they would fail the password_hash check anyway, but excluding them
    // here prevents any future credential-bearing flow from accidentally
    // resolving the team-user.
    user = await c.env.DB.prepare(
      "SELECT * FROM users WHERE email = ? AND kind = 'user'",
    )
      .bind(identifier)
      .first<UserRow>();
    if (!user) {
      const alt = await c.env.DB.prepare(
        "SELECT user_id FROM user_emails WHERE email = ? AND verified = 1",
      )
        .bind(identifier)
        .first<{ user_id: string }>();
      if (alt) {
        const altUser = await c.env.DB.prepare(
          "SELECT * FROM users WHERE id = ? AND kind = 'user'",
        )
          .bind(alt.user_id)
          .first<UserRow>();
        if (altUser) {
          // Check if alternate email login is allowed for this user
          const allowed =
            altUser.alt_email_login !== null
              ? altUser.alt_email_login === 1
              : loginConfig.allow_alt_email_login;
          if (allowed) user = altUser;
        }
      }
    }
  } else {
    user = await c.env.DB.prepare(
      "SELECT * FROM users WHERE username = ? AND kind = 'user'",
    )
      .bind(identifier)
      .first<UserRow>();
  }

  if (!user || !user.password_hash) {
    c.executionCtx.waitUntil(
      logLoginError(
        c.env.DB,
        "invalid_credentials",
        body.identifier ?? null,
        ip,
        ua,
        geoJson(c),
        {},
      ).catch(() => {}),
    );
    return c.json({ error: "invalid_credentials" }, 401);
  }
  if (!user.is_active) {
    c.executionCtx.waitUntil(
      logLoginError(
        c.env.DB,
        "account_disabled",
        body.identifier ?? null,
        ip,
        ua,
        geoJson(c),
        { user_id: user.id },
      ).catch(() => {}),
    );
    return c.json({ error: "account_disabled" }, 403);
  }

  const passwordOk = await verifyPassword(body.password, user.password_hash);
  if (!passwordOk) {
    c.executionCtx.waitUntil(
      logLoginError(
        c.env.DB,
        "invalid_credentials",
        body.identifier ?? null,
        ip,
        ua,
        geoJson(c),
        { user_id: user.id },
      ).catch(() => {}),
    );
    return c.json({ error: "invalid_credentials" }, 401);
  }

  // Check TOTP if any authenticators enabled
  const totpCount = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM totp_authenticators WHERE user_id = ? AND enabled = 1",
  )
    .bind(user.id)
    .first<{ n: number }>();
  if ((totpCount?.n ?? 0) > 0) {
    if (!body.totp_code) {
      return c.json({ error: "totp_required", totp_required: true }, 200);
    }
    const totpRl = await checkLoginTotpLimit(c.env.DB, user.id, loginConfig);
    if (!totpRl.allowed) {
      c.executionCtx.waitUntil(
        logLoginError(
          c.env.DB,
          "rate_limited",
          body.identifier ?? null,
          ip,
          ua,
          geoJson(c),
          { user_id: user.id, factor: "totp" },
        ).catch(() => {}),
      );
      return c.json({ error: "too_many_requests" }, 429);
    }
    const ok = await verifyAnyTotp(c.env, user.id, body.totp_code);
    if (!ok) {
      c.executionCtx.waitUntil(
        logLoginError(
          c.env.DB,
          "totp_invalid",
          body.identifier ?? null,
          ip,
          ua,
          geoJson(c),
          { user_id: user.id },
        ).catch(() => {}),
      );
      return c.json({ error: "invalid_credentials" }, 401);
    }
  }

  const config = await getConfig(c.env.DB);
  const ttl = config.session_ttl_days * 24 * 60 * 60;
  // RFC 8176: password, plus OTP/MFA when a TOTP factor was verified above.
  const usedTotp = (totpCount?.n ?? 0) > 0;
  await issueSession(c, user, ttl, usedTotp ? ["pwd", "otp", "mfa"] : ["pwd"]);
  return c.json({
    user: await toSessionUser(c.env.APP_URL, c.env.DB, user),
  });
});

// ─── Logout ──────────────────────────────────────────────────────────────────

app.post("/logout", requireAuth, async (c) => {
  const sessionId = c.get("sessionId");
  const user = c.get("user");
  // OIDC Back-Channel Logout: notify the user's clients that this session ended.
  if (user)
    await deliverBackChannelLogout(c.env, c.executionCtx, user.id, sessionId);
  await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?")
    .bind(sessionId)
    .run();
  clearSessionCookie(c);
  return c.json({ ok: true });
});

// ─── Email verification ───────────────────────────────────────────────────────

app.get("/verify-email", async (c) => {
  const token = c.req.query("token");
  const isAlt = c.req.query("alt") === "1";
  if (!token) return c.redirect(`${c.env.APP_URL}/verify-email?status=invalid`);

  const now = Math.floor(Date.now() / 1000);

  const tokenLookup = await hashLookupCandidate(c.env, token);
  if (!tokenLookup)
    return c.redirect(`${c.env.APP_URL}/verify-email?status=invalid`);

  if (isAlt) {
    // Alternate email verification
    const altEmail = await c.env.DB.prepare(
      "SELECT id, verified FROM user_emails WHERE verify_token = ? OR verify_token = ?",
    )
      .bind(token, tokenLookup)
      .first<{ id: string; verified: number }>();
    if (!altEmail)
      return c.redirect(`${c.env.APP_URL}/verify-email?status=invalid`);

    await c.env.DB.prepare(
      "UPDATE user_emails SET verified = 1, verify_token = NULL, verified_at = ? WHERE id = ?",
    )
      .bind(now, altEmail.id)
      .run();

    return c.redirect(`${c.env.APP_URL}/verify-email?status=success`);
  }

  // Primary email verification
  const user = await c.env.DB.prepare(
    "SELECT * FROM users WHERE email_verify_token = ? OR email_verify_token = ?",
  )
    .bind(token, tokenLookup)
    .first<UserRow>();
  if (!user) return c.redirect(`${c.env.APP_URL}/verify-email?status=invalid`);

  await c.env.DB.prepare(
    "UPDATE users SET email_verified = 1, email_verify_token = NULL, updated_at = ? WHERE id = ?",
  )
    .bind(now, user.id)
    .run();

  return c.redirect(`${c.env.APP_URL}/verify-email?status=success`);
});

app.route("/", inboundEmailVerifyRoutes);

app.route("/", totpRoutes);

// ─── Passkey registration ────────────────────────────────────────────────────

app.post("/passkey/register/begin", requireAuth, async (c) => {
  const user = c.get("user");
  const rpId = new URL(c.env.APP_URL).hostname;
  const config = await getConfig(c.env.DB);

  const existingRows = await c.env.DB.prepare(
    "SELECT * FROM passkeys WHERE user_id = ?",
  )
    .bind(user.id)
    .all<PasskeyRow>();

  const options = await beginPasskeyRegistration(
    user.id,
    user.email,
    user.display_name,
    existingRows.results.map(rowToPasskey),
    rpId,
    config.site_name,
  );

  // Store challenge in KV (5 minute TTL)
  await c.env.KV_CACHE.put(`passkey:reg:${user.id}`, JSON.stringify(options), {
    expirationTtl: 300,
  });

  return c.json(options);
});

app.post("/passkey/register/finish", requireAuth, async (c) => {
  const user = c.get("user");
  const rpId = new URL(c.env.APP_URL).hostname;
  const origin = c.env.APP_URL;

  const stored = await c.env.KV_CACHE.get(`passkey:reg:${user.id}`);
  if (!stored) return c.json({ error: "registration_session_expired" }, 400);

  const options = JSON.parse(stored) as { challenge: string };
  const body = await c.req.json<{
    response: Parameters<typeof finishPasskeyRegistration>[0];
    name?: string;
  }>();

  let verification;
  try {
    verification = await finishPasskeyRegistration(
      body.response,
      options.challenge,
      rpId,
      origin,
    );
  } catch (err) {
    // The library's reason is for operators, not the person signing in.
    console.warn("[passkey] registration failed:", err);
    return c.json({ error: "passkey_registration_failed" }, 400);
  }

  if (!verification.verified || !verification.registrationInfo) {
    return c.json({ error: "verification_failed" }, 400);
  }

  await c.env.KV_CACHE.delete(`passkey:reg:${user.id}`);

  const { credential, credentialDeviceType, credentialBackedUp } =
    verification.registrationInfo;
  const now = Math.floor(Date.now() / 1000);
  const passkeyId = randomId();
  const name = body.name ?? "Passkey";

  // Encode public key as base64url
  const pkBase64 = btoa(String.fromCharCode(...credential.publicKey))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  await c.env.DB.prepare(
    `INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, device_type, backed_up, transports, name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      passkeyId,
      user.id,
      credential.id,
      pkBase64,
      credential.counter,
      credentialDeviceType,
      credentialBackedUp ? 1 : 0,
      JSON.stringify(credential.transports ?? []),
      name,
      now,
    )
    .run();

  c.executionCtx.waitUntil(
    deliverUserEmailNotifications(
      c.env,
      user.id,
      "security.passkey_added",
      {
        name,
        ...notificationActorMetaFromHeaders(c.req.raw.headers),
      },
      c.env.APP_URL,
    ).catch(() => {}),
  );

  return c.json({ id: passkeyId });
});

// ─── Passkey authentication ──────────────────────────────────────────────────

app.post("/passkey/auth/begin", async (c) => {
  const rpId = new URL(c.env.APP_URL).hostname;

  const body = await c.req
    .json<{ username?: string }>()
    .catch(() => ({ username: undefined }));
  let passkeys: PasskeyRow[] = [];

  const username = "username" in body ? body.username : undefined;
  if (username) {
    const user = await c.env.DB.prepare(
      "SELECT * FROM users WHERE (username = ? OR email = ?) AND kind = 'user'",
    )
      .bind(username, username)
      .first<{ id: string }>();
    if (user) {
      const rows = await c.env.DB.prepare(
        "SELECT * FROM passkeys WHERE user_id = ?",
      )
        .bind(user.id)
        .all<PasskeyRow>();
      passkeys = rows.results;
    }
  }

  const options = await beginPasskeyAuthentication(
    passkeys.map(rowToPasskey),
    rpId,
  );

  // Store challenge in KV (5 minute TTL)
  const challengeKey = `passkey:auth:${options.challenge}`;
  await c.env.KV_CACHE.put(challengeKey, JSON.stringify(options), {
    expirationTtl: 300,
  });

  return c.json(options);
});

app.post("/passkey/auth/finish", async (c) => {
  const rpId = new URL(c.env.APP_URL).hostname;
  const origin = c.env.APP_URL;

  const body = await c.req.json<{ challenge?: string; response?: unknown }>();
  if (!body.challenge)
    return c.json(
      { error: "field_required", params: { field: "challenge" } },
      400,
    );

  const stored = await c.env.KV_CACHE.get(`passkey:auth:${body.challenge}`);
  if (!stored) return c.json({ error: "auth_session_expired" }, 400);

  // Spend the challenge up front rather than on success only: a failed
  // attempt otherwise leaves it usable for the rest of its TTL.
  await c.env.KV_CACHE.delete(`passkey:auth:${body.challenge}`);

  const options = JSON.parse(stored) as { challenge: string };

  // Find passkey by credential id
  const response = body.response as { id?: string };
  if (!response?.id) return c.json({ error: "invalid_response" }, 400);

  const passkeyRow = await c.env.DB.prepare(
    "SELECT * FROM passkeys WHERE credential_id = ?",
  )
    .bind(response.id)
    .first<PasskeyRow>();
  if (!passkeyRow) return c.json({ error: "passkey_not_found" }, 400);

  let verification;
  try {
    verification = await finishPasskeyAuthentication(
      body.response as Parameters<typeof finishPasskeyAuthentication>[0],
      options.challenge,
      rowToPasskey(passkeyRow),
      rpId,
      origin,
    );
  } catch (err) {
    console.warn("[passkey] authentication failed:", err);
    return c.json({ error: "passkey_auth_failed" }, 400);
  }

  if (!verification.verified)
    return c.json({ error: "verification_failed" }, 400);

  // Update counter
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    "UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?",
  )
    .bind(verification.authenticationInfo.newCounter, now, passkeyRow.id)
    .run();

  const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(passkeyRow.user_id)
    .first<UserRow>();
  if (!user || !user.is_active)
    return c.json({ error: "account_not_found_or_disabled" }, 400);

  const config = await getConfig(c.env.DB);
  const ttl = config.session_ttl_days * 24 * 60 * 60;
  // Passkey sign-in is a hardware/software cryptographic authenticator.
  await issueSession(c, user, ttl, ["webauthn"]);
  return c.json({
    user: await toSessionUser(c.env.APP_URL, c.env.DB, user),
  });
});

// ─── Passkey verify (for site-scope 2FA gate) ────────────────────────────────

// Begin a passkey challenge for the current authenticated user.
// Returns WebAuthn options targeting only the user's own passkeys.
app.post("/passkey/verify/begin", requireAuth, async (c) => {
  const user = c.get("user");
  const rpId = new URL(c.env.APP_URL).hostname;

  const rows = await c.env.DB.prepare(
    "SELECT * FROM passkeys WHERE user_id = ?",
  )
    .bind(user.id)
    .all<PasskeyRow>();

  if (rows.results.length === 0) {
    return c.json({ error: "no_passkeys" }, 400);
  }

  const options = await beginPasskeyAuthentication(
    rows.results.map(rowToPasskey),
    rpId,
  );

  const challengeKey = `passkey:verify:${options.challenge}:${user.id}`;
  await c.env.KV_CACHE.put(challengeKey, JSON.stringify(options), {
    expirationTtl: 300,
  });

  return c.json(options);
});

// Finish passkey verification and return a short-lived one-time verify token.
app.post("/passkey/verify/finish", requireAuth, async (c) => {
  const user = c.get("user");
  const rpId = new URL(c.env.APP_URL).hostname;
  const origin = c.env.APP_URL;

  const body = await c.req.json<{ challenge?: string; response?: unknown }>();
  if (!body.challenge)
    return c.json(
      { error: "field_required", params: { field: "challenge" } },
      400,
    );

  const challengeKey = `passkey:verify:${body.challenge}:${user.id}`;
  const stored = await c.env.KV_CACHE.get(challengeKey);
  if (!stored) return c.json({ error: "session_invalid" }, 400);

  const options = JSON.parse(stored) as { challenge: string };

  const response = body.response as { id?: string };
  if (!response?.id) return c.json({ error: "invalid_response" }, 400);

  const passkeyRow = await c.env.DB.prepare(
    "SELECT * FROM passkeys WHERE credential_id = ? AND user_id = ?",
  )
    .bind(response.id, user.id)
    .first<PasskeyRow>();
  if (!passkeyRow) return c.json({ error: "passkey_not_found" }, 400);

  let verification;
  try {
    verification = await finishPasskeyAuthentication(
      body.response as Parameters<typeof finishPasskeyAuthentication>[0],
      options.challenge,
      rowToPasskey(passkeyRow),
      rpId,
      origin,
    );
  } catch (err) {
    console.warn("[passkey] verification failed:", err);
    return c.json({ error: "verification_failed" }, 400);
  }

  if (!verification.verified)
    return c.json({ error: "verification_failed" }, 400);

  await c.env.KV_CACHE.delete(challengeKey);

  // Update counter
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    "UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?",
  )
    .bind(verification.authenticationInfo.newCounter, now, passkeyRow.id)
    .run();

  // Issue a one-time verify token (5 min TTL) consumed by the OAuth authorize endpoint
  const { randomId } = await import("../lib/crypto");
  const verifyToken = randomId();
  await c.env.KV_CACHE.put(
    `passkey_site_verify:${user.id}:${verifyToken}`,
    "1",
    { expirationTtl: 300 },
  );

  return c.json({ verify_token: verifyToken });
});

// ─── List passkeys ───────────────────────────────────────────────────────────

app.get("/passkeys", requireAuth, async (c) => {
  const user = c.get("user");
  const rows = await c.env.DB.prepare(
    "SELECT id, name, device_type, backed_up, created_at, last_used_at FROM passkeys WHERE user_id = ?",
  )
    .bind(user.id)
    .all<
      Pick<
        PasskeyRow,
        | "id"
        | "name"
        | "device_type"
        | "backed_up"
        | "created_at"
        | "last_used_at"
      >
    >();
  return c.json({ passkeys: rows.results });
});

app.delete("/passkeys/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT name FROM passkeys WHERE id = ? AND user_id = ?",
  )
    .bind(id, user.id)
    .first<{ name: string }>();
  if (!row) return c.json({ error: "passkey_not_found" }, 404);

  const otherPasskey = await c.env.DB.prepare(
    "SELECT 1 AS x FROM passkeys WHERE user_id = ? AND id != ? LIMIT 1",
  )
    .bind(user.id, id)
    .first<{ x: number }>();
  const totp = await c.env.DB.prepare(
    "SELECT 1 AS x FROM totp_authenticators WHERE user_id = ? AND enabled = 1 LIMIT 1",
  )
    .bind(user.id)
    .first<{ x: number }>();
  const has2faAfter = !!otherPasskey || !!totp;
  if (!has2faAfter) {
    const blockers = await teamsBlockingDowngrade(c.env.DB, user.id, {
      email_verified: user.email_verified,
      has_2fa: false,
    });
    if (blockers.length) {
      return c.json(
        {
          error: "team_requires_2fa",
          teams: blockers,
        },
        409,
      );
    }
  }

  await c.env.DB.prepare("DELETE FROM passkeys WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .run();
  c.executionCtx.waitUntil(
    deliverUserEmailNotifications(
      c.env,
      user.id,
      "security.passkey_removed",
      {
        name: row.name,
        ...notificationActorMetaFromHeaders(c.req.raw.headers),
      },
      c.env.APP_URL,
    ).catch(() => {}),
  );
  return c.json({ ok: true });
});

// ─── PoW challenge ───────────────────────────────────────────────────────────

app.get("/pow-challenge", async (c) => {
  const difficulty = await getConfigValue(c.env.DB, "pow_difficulty");
  const issued = await issuePowChallenge(c.env);
  return c.json({
    challenge: issued.challenge,
    difficulty,
    expires_at: issued.expires_at,
  });
});

// ─── Cap challenge (embedded mode) ───────────────────────────────────────────
//
// The @cap.js/widget POSTs to <endpoint>challenge then <endpoint>redeem; these
// two routes are that endpoint for embedded mode. External mode points the
// widget at a self-hosted Cap Standalone server instead, so these are unused
// there. Both are unauthenticated by design — a captcha gates anonymous flows.

app.post("/cap/challenge", async (c) => {
  const config = await getConfig(c.env.DB);
  if (
    !config.captcha_providers.includes("cap") ||
    config.cap_mode !== "embedded"
  ) {
    return c.json({ error: "captcha_provider_disabled" }, 404);
  }
  const challenge = await issueCapChallenge(c.env, {
    challengeCount: config.cap_challenge_count,
    challengeDifficulty: config.cap_challenge_difficulty,
    instrumentation: config.cap_instrumentation,
  });
  return c.json(challenge);
});

app.post("/cap/redeem", async (c) => {
  const config = await getConfig(c.env.DB);
  if (
    !config.captcha_providers.includes("cap") ||
    config.cap_mode !== "embedded"
  ) {
    return c.json({ error: "captcha_provider_disabled" }, 404);
  }
  const body = await c.req.json<{
    token?: string;
    solutions?: unknown;
    instr?: unknown;
    instr_blocked?: boolean;
    instr_timeout?: boolean;
  }>();
  if (!body.token || !Array.isArray(body.solutions)) {
    return c.json({ success: false }, 400);
  }
  const result = await redeemCapChallenge(
    c.env,
    body as Parameters<typeof redeemCapChallenge>[1],
  );
  if (!result.success) return c.json({ success: false }, 200);
  // `expires` (ms) is required by @cap.js/widget — it validates it client-side.
  return c.json({
    success: true,
    token: result.token,
    expires: result.expires,
  });
});

// ─── Sessions list ───────────────────────────────────────────────────────────

app.get("/sessions", requireAuth, async (c) => {
  const user = c.get("user");
  const currentSessionId = c.get("sessionId");
  const now = Math.floor(Date.now() / 1000);
  // Only live sessions. Expired rows are swept by the cron sweep, but filter
  // here too so a session that lapsed since the last sweep never shows up as
  // "active" — that was the whole complaint behind this view.
  //
  // The LEFT JOIN pulls the geolocation Cloudflare recorded for the IP the
  // session was created from (session_ips row keyed on that same IP), so the
  // list can show an "IP location" column without a second round trip.
  const sessions = await c.env.DB.prepare(
    `SELECT s.id, s.user_agent, s.ip_address, s.created_at, s.expires_at,
            si.geo AS ip_geo
       FROM sessions s
       LEFT JOIN session_ips si
         ON si.session_id = s.id AND si.ip_address = s.ip_address
      WHERE s.user_id = ? AND s.expires_at > ?
      ORDER BY s.created_at DESC`,
  )
    .bind(user.id, now)
    .all();
  return c.json({
    sessions: sessions.results.map((s) => ({
      ...s,
      is_current: s.id === currentSessionId,
    })),
  });
});

// Every distinct IP a single session has authenticated from, most recent
// first, with the geolocation captured at the edge. Powers the "IP history"
// block in the session detail dialog.
app.get("/sessions/:id/ips", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  // Ownership check: never leak one user's session history to another.
  const owns = await c.env.DB.prepare(
    "SELECT 1 FROM sessions WHERE id = ? AND user_id = ?",
  )
    .bind(id, user.id)
    .first();
  if (!owns) return c.json({ error: "not_found" }, 404);
  const ips = await c.env.DB.prepare(
    `SELECT ip_address, geo, first_seen, last_seen
       FROM session_ips
      WHERE session_id = ?
      ORDER BY last_seen DESC`,
  )
    .bind(id)
    .all();
  return c.json({ ips: ips.results });
});

// Revoke every session except the one making the request — the "sign out
// everywhere else" panic button. Keeping the current session avoids logging
// the user out of the very page they clicked it on.
app.delete("/sessions", requireAuth, async (c) => {
  const user = c.get("user");
  const currentSessionId = c.get("sessionId");
  const result = await c.env.DB.prepare(
    "DELETE FROM sessions WHERE user_id = ? AND id != ?",
  )
    .bind(user.id, currentSessionId ?? "")
    .run();
  return c.json({
    revoked: result.meta.changes ?? 0,
  });
});

app.delete("/sessions/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM sessions WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .run();
  return c.json({ ok: true });
});

app.route("/", gpgLoginRoutes);

export default app;
