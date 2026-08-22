// Auth routes: register, login, logout, 2FA, passkeys, email verify, social OAuth callback

import { Hono } from "hono";
import type { Context } from "hono";
import { getConfig, getConfigValue, getJwtSecret } from "../lib/config";
import { getIp } from "../lib/clientIp";
import { geoJson, recordSessionIp } from "../lib/geo";
import { recordAudit, auditRequestMeta } from "../lib/audit";
import { clearSessionCookie, setSessionCookie } from "../lib/cookies";
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
import {
  encryptSecret,
  hashSecret,
  hashLookupCandidate,
  decryptSecret,
  isHashedSecret,
} from "../lib/secretCrypto";
import { signJWT } from "../lib/jwt";
import {
  claimEnrolmentCounter,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCodes,
  matchTotpCounter,
  totpUri,
  verifyAnyTotp,
} from "../lib/totp";
import {
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  rowToPasskey,
} from "../lib/webauthn";
import { verifyClearsign } from "../lib/gpg";
import { verifyCaptchaToken } from "../middleware/captcha";
import { issuePowChallenge } from "../lib/pow";
import { rateLimit, rateLimitIp } from "../middleware/rateLimit";
import { requireAuth } from "../middleware/auth";
import { proxyImageUrl } from "../lib/proxyImage";
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
import type {
  AuthUser,
  PasskeyRow,
  SiteInviteRow,
  TotpAuthenticatorRow,
  UserRow,
  Variables,
} from "../types";

// ─── Login error logging ─────────────────────────────────────────────────────

async function logLoginError(
  db: D1Database,
  errorCode: string,
  identifier: string | null,
  ip: string,
  userAgent: string | null,
  geo: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      "INSERT INTO login_errors (id, error_code, identifier, ip_address, user_agent, ip_geo, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      randomId(),
      errorCode,
      identifier,
      ip,
      userAgent,
      geo,
      JSON.stringify(metadata),
      now,
    )
    .run();
}

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

/** Exported so the invite-registration flow can mint a session through the
 *  same path as ordinary login rather than re-implementing cookie handling,
 *  JWT signing and session-row bookkeeping. */
export async function issueSession(
  c: Context<AppEnv>,
  user: UserRow,
  ttlSeconds: number,
): Promise<string> {
  const db = c.env.DB;
  const secret = await getJwtSecret(c.env.KV_SESSIONS);
  const sessionId = randomId(32);
  const now = Math.floor(Date.now() / 1000);
  const token = await signJWT(
    {
      sub: user.id,
      role: user.role,
      email: user.email,
      username: user.username,
      display_name: user.display_name,
      avatar_url: await proxyImageUrl(c.env.APP_URL, db, user.avatar_url),
      unproxied_avatar_url: user.avatar_url,
      email_verified: user.email_verified === 1,
      sessionId,
    },
    secret,
    ttlSeconds,
  );
  const hash = await sha256(token);
  await db
    .prepare(
      "INSERT INTO sessions (id, user_id, token_hash, user_agent, ip_address, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      sessionId,
      user.id,
      hash,
      c.req.header("User-Agent") ?? null,
      getIp(c),
      now + ttlSeconds,
      now,
    )
    .run();
  // Seed the session's IP history with the login IP + geolocation so the
  // security page has a location for a session the moment it is created,
  // rather than only after the next authenticated request.
  c.executionCtx.waitUntil(
    recordSessionIp(c.env.DB, sessionId, getIp(c), geoJson(c), now).catch(
      () => undefined,
    ),
  );
  // Mirror the JWT into a cookie so SSR can authenticate the next request
  // without any client JS. Bearer-header callers get the token in the JSON
  // body as before.
  setSessionCookie(c, token, ttlSeconds);

  // Transparent User Control: record every session issuance (login, social
  // login, 2FA completion, GPG login, registration) in the user's own log.
  const meta = auditRequestMeta(c);
  c.executionCtx.waitUntil(
    recordAudit(c.env, c.executionCtx, {
      scope: "user",
      scopeId: user.id,
      action: "user.login",
      actorId: user.id,
      actorName: user.username,
      resourceType: "session",
      resourceId: sessionId,
      resourceName: `@${user.username}`,
      ip: meta.ip,
      userAgent: meta.userAgent,
      geo: meta.geo,
      metadata: {},
    }),
  );
  return token;
}

// ─── Register ────────────────────────────────────────────────────────────────

app.post("/register", async (c) => {
  const ip = getIp(c);
  const config = await getConfig(c.env.DB);
  const rl = await rateLimitIp(
    c.env.KV_SESSIONS,
    ip,
    "register",
    5,
    300,
    config.ipv6_rate_limit_prefix,
  );
  if (!rl.allowed) return c.json({ error: "Too many requests" }, 429);
  if (!config.allow_registration)
    return c.json({ error: "Registration is disabled" }, 403);

  const body = await c.req.json<{
    email: string;
    username: string;
    password: string;
    display_name?: string;
    invite_token?: string;
    captcha_token?: string;
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
    body.captcha_token,
    body.pow_challenge,
    body.pow_nonce,
    ip,
    c.env,
  );
  if (!captchaOk.success)
    return c.json({ error: captchaOk.error ?? "Captcha failed" }, 400);

  if (!body.email || !body.username || !body.password)
    return c.json({ error: "email, username and password are required" }, 400);
  if (body.password.length < 8)
    return c.json({ error: "Password must be at least 8 characters" }, 400);
  if (!/^[a-z0-9_.-]{2,32}$/i.test(body.username))
    return c.json(
      { error: "Username must be 2-32 alphanumeric characters" },
      400,
    );

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
    return c.json({ error: "Invite token has reached its usage limit" }, 403);

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
      return c.json({ error: "Email or username already taken" }, 409);
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
    return c.json(
      { message: "Registration successful. Please verify your email." },
      201,
    );
  }

  const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(userId)
    .first<UserRow>();
  if (!user) return c.json({ error: "User not found after creation" }, 500);

  const ttl = config.session_ttl_days * 24 * 60 * 60;
  const token = await issueSession(c, user, ttl);
  return c.json(
    { token, user: await safeUser(c.env.APP_URL, c.env.DB, user) },
    201,
  );
});

// ─── Login ───────────────────────────────────────────────────────────────────

app.post("/login", async (c) => {
  const ip = getIp(c);
  const ua = c.req.header("User-Agent") ?? null;
  const loginConfig = await getConfig(c.env.DB);
  const rl = await rateLimitIp(
    c.env.KV_SESSIONS,
    ip,
    "login",
    10,
    60,
    loginConfig.ipv6_rate_limit_prefix,
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
    return c.json({ error: "Too many requests" }, 429);
  }

  const body = await c.req.json<{
    identifier: string; // email or username
    password: string;
    totp_code?: string;
    captcha_token?: string;
    pow_challenge?: string;
    pow_nonce?: number;
  }>();

  // Login is a two-step flow when 2FA is enrolled: the first call (no
  // totp_code) validates password+captcha and returns totp_required; the
  // second call replays password and adds totp_code. Captcha tokens are
  // single-use (provider replay protection / PoW nonce), but we verify on
  // every call — including the TOTP follow-up — because skipping captcha on
  // step 2 would let an attacker probe passwords without solving captcha and
  // would leak whether the password was correct via the TOTP error message.
  // The client must submit a fresh captcha token on each step.
  const captchaOk = await verifyCaptchaToken(
    c.env.DB,
    body.captcha_token,
    body.pow_challenge,
    body.pow_nonce,
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
    return c.json({ error: captchaOk.error ?? "Captcha failed" }, 400);
  }

  const isEmail = body.identifier.includes("@");
  const identifier = body.identifier.toLowerCase().trim();

  // Per-account throttle, alongside the per-IP one above. The IP limit alone
  // bounds nothing for an attacker spread across many addresses, which is the
  // shape both password spraying and TOTP guessing take. Keyed on the
  // identifier as typed rather than on a resolved user id, so an unknown
  // account throttles exactly like a real one and the 429 reveals nothing
  // about who exists.
  const idRl = await rateLimit(
    c.env.KV_SESSIONS,
    `login-id:${await sha256(identifier)}`,
    10,
    300,
  );
  if (!idRl.allowed) {
    c.executionCtx.waitUntil(
      logLoginError(
        c.env.DB,
        "rate_limited",
        body.identifier ?? null,
        ip,
        ua,
        geoJson(c),
        {},
      ).catch(() => {}),
    );
    return c.json({ error: "Too many requests" }, 429);
  }

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
    return c.json({ error: "Invalid credentials" }, 401);
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
    return c.json({ error: "Account is disabled" }, 403);
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
    return c.json({ error: "Invalid credentials" }, 401);
  }

  // Check TOTP if any authenticators enabled
  const totpCount = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM totp_authenticators WHERE user_id = ? AND enabled = 1",
  )
    .bind(user.id)
    .first<{ n: number }>();
  if ((totpCount?.n ?? 0) > 0) {
    if (!body.totp_code) {
      return c.json({ error: "TOTP code required", totp_required: true }, 200);
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
      return c.json({ error: "Invalid credentials" }, 401);
    }
  }

  const config = await getConfig(c.env.DB);
  const ttl = config.session_ttl_days * 24 * 60 * 60;
  const token = await issueSession(c, user, ttl);
  return c.json({
    token,
    user: await safeUser(c.env.APP_URL, c.env.DB, user),
  });
});

// ─── Logout ──────────────────────────────────────────────────────────────────

app.post("/logout", requireAuth, async (c) => {
  const sessionId = c.get("sessionId");
  await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?")
    .bind(sessionId)
    .run();
  clearSessionCookie(c);
  return c.json({ message: "Logged out" });
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

// ─── Inbound email verification (user sends email to us) ─────────────────────

app.post("/email-verify-code", requireAuth, async (c) => {
  const body = await c.req
    .json<{
      captcha_token?: string;
      pow_challenge?: string;
      pow_nonce?: number;
    }>()
    .catch(
      (): {
        captcha_token?: string;
        pow_challenge?: string;
        pow_nonce?: number;
      } => ({}),
    );
  const ip = getIp(c);
  const captchaOk = await verifyCaptchaToken(
    c.env.DB,
    body.captcha_token,
    body.pow_challenge,
    body.pow_nonce,
    ip,
    c.env,
  );
  if (!captchaOk.success)
    return c.json({ error: captchaOk.error ?? "Captcha failed" }, 403);

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
  if (!user) return c.json({ error: "User not found" }, 404);
  if (user.email_verified)
    return c.json({ error: "Email is already verified" }, 400);

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
  if (!user) return c.json({ error: "User not found" }, 404);
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
      pow_challenge?: string;
      pow_nonce?: number;
    }>()
    .catch(
      (): {
        captcha_token?: string;
        pow_challenge?: string;
        pow_nonce?: number;
      } => ({}),
    );
  const ip = getIp(c);
  const captchaOk = await verifyCaptchaToken(
    c.env.DB,
    body.captcha_token,
    body.pow_challenge,
    body.pow_nonce,
    ip,
    c.env,
  );
  if (!captchaOk.success)
    return c.json({ error: captchaOk.error ?? "Captcha failed" }, 403);

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
  if (!user) return c.json({ error: "User not found" }, 404);
  if (user.email_verified)
    return c.json({ error: "Email is already verified" }, 400);

  const config = await getConfig(c.env.DB);
  if (config.email_provider === "none")
    return c.json({ error: "Email sending is not configured" }, 503);

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

  return c.json({ message: "Verification email sent" });
});

// ─── TOTP (multi-authenticator) ───────────────────────────────────────────────

app.get("/totp/list", requireAuth, async (c) => {
  const user = c.get("user");
  const rows = await c.env.DB.prepare(
    "SELECT id, name, enabled, created_at FROM totp_authenticators WHERE user_id = ? ORDER BY created_at ASC",
  )
    .bind(user.id)
    .all<
      Pick<TotpAuthenticatorRow, "id" | "name" | "enabled" | "created_at">
    >();
  const recovery = await c.env.DB.prepare(
    "SELECT backup_codes FROM user_totp_recovery WHERE user_id = ?",
  )
    .bind(user.id)
    .first<{ backup_codes: string }>();
  const backup_codes_remaining = recovery
    ? (JSON.parse(recovery.backup_codes) as string[]).length
    : 0;
  return c.json({ authenticators: rows.results, backup_codes_remaining });
});

app.post("/totp/setup", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ name?: string }>();
  const config = await getConfig(c.env.DB);

  const secret = generateTotpSecret();
  const id = crypto.randomUUID();
  const name = body.name?.trim() || "Authenticator";
  const now = Math.floor(Date.now() / 1000);

  // Encrypt the seed at rest. The plaintext is also returned to the
  // client (for the QR code / manual entry) on this single response —
  // after that, all reads go through decryptSecret to compute OTPs.
  const storedSecret = await encryptSecret(c.env, secret);
  await c.env.DB.prepare(
    "INSERT INTO totp_authenticators (id, user_id, name, secret, enabled, created_at) VALUES (?, ?, ?, ?, 0, ?)",
  )
    .bind(id, user.id, name, storedSecret, now)
    .run();

  const uri = totpUri(secret, user.email, config.site_name);
  return c.json({ id, secret, uri });
});

app.post("/totp/verify", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ id: string; code: string }>();

  const auth = await c.env.DB.prepare(
    "SELECT * FROM totp_authenticators WHERE id = ? AND user_id = ?",
  )
    .bind(body.id, user.id)
    .first<TotpAuthenticatorRow>();
  if (!auth) return c.json({ error: "Authenticator not found" }, 404);
  if (auth.enabled) return c.json({ error: "Already enabled" }, 409);

  const plainSecret = (await decryptSecret(c.env, auth.secret)) ?? auth.secret;
  const counter = await matchTotpCounter(body.code, plainSecret);
  if (counter === null) return c.json({ error: "Invalid TOTP code" }, 400);

  await c.env.DB.prepare(
    "UPDATE totp_authenticators SET enabled = 1 WHERE id = ?",
  )
    .bind(body.id)
    .run();
  // Retire the enrolment code too — otherwise the code the user just typed
  // here is still live at the login form for the rest of its window.
  await claimEnrolmentCounter(c.env.DB, body.id, counter);

  c.executionCtx.waitUntil(
    deliverUserEmailNotifications(
      c.env,
      user.id,
      "security.totp_enabled",
      {
        name: auth.name,
        ...notificationActorMetaFromHeaders(c.req.raw.headers),
      },
      c.env.APP_URL,
    ).catch(() => {}),
  );

  // Generate backup codes only on the first enabled authenticator
  const existing = await c.env.DB.prepare(
    "SELECT user_id FROM user_totp_recovery WHERE user_id = ?",
  )
    .bind(user.id)
    .first<{ user_id: string }>();
  if (existing) return c.json({ message: "Authenticator enabled" });

  const backupCodes = generateBackupCodes();
  const hashedCodes = await hashBackupCodes(backupCodes);
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    "INSERT INTO user_totp_recovery (user_id, backup_codes, updated_at) VALUES (?, ?, ?)",
  )
    .bind(user.id, JSON.stringify(hashedCodes), now)
    .run();
  return c.json({
    message: "Authenticator enabled",
    backup_codes: backupCodes,
  });
});

app.delete("/totp/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();
  const body = await c.req.json<{ code: string }>();

  const auth = await c.env.DB.prepare(
    "SELECT id, name FROM totp_authenticators WHERE id = ? AND user_id = ? AND enabled = 1",
  )
    .bind(id, user.id)
    .first<{ id: string; name: string }>();
  if (!auth) return c.json({ error: "Authenticator not found" }, 404);

  const ok = await verifyAnyTotp(c.env, user.id, body.code);
  if (!ok) return c.json({ error: "Invalid TOTP code" }, 400);

  // Would removing this authenticator leave the user with no 2FA?
  // Compute hypothetical post-delete state and reject the change if a team
  // membership still requires 2FA.
  const otherTotp = await c.env.DB.prepare(
    "SELECT 1 AS x FROM totp_authenticators WHERE user_id = ? AND enabled = 1 AND id != ? LIMIT 1",
  )
    .bind(user.id, id)
    .first<{ x: number }>();
  const passkey = await c.env.DB.prepare(
    "SELECT 1 AS x FROM passkeys WHERE user_id = ? LIMIT 1",
  )
    .bind(user.id)
    .first<{ x: number }>();
  const has2faAfter = !!otherTotp || !!passkey;
  if (!has2faAfter) {
    const blockers = await teamsBlockingDowngrade(c.env.DB, user.id, {
      email_verified: user.email_verified,
      has_2fa: false,
    });
    if (blockers.length) {
      return c.json(
        {
          error:
            "Cannot remove your last 2FA factor while you're a member of a team that requires 2FA",
          teams: blockers,
        },
        409,
      );
    }
  }

  await c.env.DB.prepare(
    "DELETE FROM totp_authenticators WHERE id = ? AND user_id = ?",
  )
    .bind(id, user.id)
    .run();

  // If no enabled authenticators remain, clean up everything
  const remaining = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM totp_authenticators WHERE user_id = ? AND enabled = 1",
  )
    .bind(user.id)
    .first<{ n: number }>();
  if ((remaining?.n ?? 0) === 0) {
    await c.env.DB.prepare("DELETE FROM user_totp_recovery WHERE user_id = ?")
      .bind(user.id)
      .run();
    await c.env.DB.prepare("DELETE FROM totp_authenticators WHERE user_id = ?")
      .bind(user.id)
      .run();
  }

  c.executionCtx.waitUntil(
    deliverUserEmailNotifications(
      c.env,
      user.id,
      "security.totp_disabled",
      {
        name: auth.name,
        ...notificationActorMetaFromHeaders(c.req.raw.headers),
      },
      c.env.APP_URL,
    ).catch(() => {}),
  );

  return c.json({ message: "Authenticator removed" });
});

app.post("/totp/backup-codes", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ code: string }>();

  const count = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM totp_authenticators WHERE user_id = ? AND enabled = 1",
  )
    .bind(user.id)
    .first<{ n: number }>();
  if ((count?.n ?? 0) === 0)
    return c.json({ error: "No TOTP authenticators enabled" }, 400);

  const ok = await verifyAnyTotp(c.env, user.id, body.code);
  if (!ok) return c.json({ error: "Invalid TOTP code" }, 400);

  const backupCodes = generateBackupCodes();
  const hashedCodes = await hashBackupCodes(backupCodes);
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    "INSERT INTO user_totp_recovery (user_id, backup_codes, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET backup_codes = excluded.backup_codes, updated_at = excluded.updated_at",
  )
    .bind(user.id, JSON.stringify(hashedCodes), now)
    .run();
  return c.json({ backup_codes: backupCodes });
});

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
  if (!stored) return c.json({ error: "Registration session expired" }, 400);

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
    return c.json({ error: `Registration failed: ${String(err)}` }, 400);
  }

  if (!verification.verified || !verification.registrationInfo) {
    return c.json({ error: "Verification failed" }, 400);
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

  return c.json({ message: "Passkey registered", id: passkeyId });
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
  if (!body.challenge) return c.json({ error: "challenge required" }, 400);

  const stored = await c.env.KV_CACHE.get(`passkey:auth:${body.challenge}`);
  if (!stored) return c.json({ error: "Authentication session expired" }, 400);

  const options = JSON.parse(stored) as { challenge: string };

  // Find passkey by credential id
  const response = body.response as { id?: string };
  if (!response?.id) return c.json({ error: "Invalid response" }, 400);

  const passkeyRow = await c.env.DB.prepare(
    "SELECT * FROM passkeys WHERE credential_id = ?",
  )
    .bind(response.id)
    .first<PasskeyRow>();
  if (!passkeyRow) return c.json({ error: "Passkey not found" }, 400);

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
    return c.json({ error: `Authentication failed: ${String(err)}` }, 400);
  }

  if (!verification.verified)
    return c.json({ error: "Verification failed" }, 400);

  await c.env.KV_CACHE.delete(`passkey:auth:${body.challenge}`);

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
    return c.json({ error: "Account not found or disabled" }, 400);

  const config = await getConfig(c.env.DB);
  const ttl = config.session_ttl_days * 24 * 60 * 60;
  const token = await issueSession(c, user, ttl);
  return c.json({
    token,
    user: await safeUser(c.env.APP_URL, c.env.DB, user),
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
    return c.json({ error: "No passkeys registered for this account" }, 400);
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
  if (!body.challenge) return c.json({ error: "challenge required" }, 400);

  const challengeKey = `passkey:verify:${body.challenge}:${user.id}`;
  const stored = await c.env.KV_CACHE.get(challengeKey);
  if (!stored) return c.json({ error: "Verification session expired" }, 400);

  const options = JSON.parse(stored) as { challenge: string };

  const response = body.response as { id?: string };
  if (!response?.id) return c.json({ error: "Invalid response" }, 400);

  const passkeyRow = await c.env.DB.prepare(
    "SELECT * FROM passkeys WHERE credential_id = ? AND user_id = ?",
  )
    .bind(response.id, user.id)
    .first<PasskeyRow>();
  if (!passkeyRow) return c.json({ error: "Passkey not found" }, 400);

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
    return c.json({ error: `Verification failed: ${String(err)}` }, 400);
  }

  if (!verification.verified)
    return c.json({ error: "Verification failed" }, 400);

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
  if (!row) return c.json({ error: "Passkey not found" }, 404);

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
          error:
            "Cannot remove your last 2FA factor while you're a member of a team that requires 2FA",
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
  return c.json({ message: "Passkey deleted" });
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
  if (!owns) return c.json({ error: "Not found" }, 404);
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
    message: "Other sessions revoked",
    revoked: result.meta.changes ?? 0,
  });
});

app.delete("/sessions/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM sessions WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .run();
  return c.json({ message: "Session revoked" });
});

// ─── GPG login ───────────────────────────────────────────────────────────────

// Step 1: request a challenge
app.post("/gpg-challenge", async (c) => {
  const ip = getIp(c);
  const { ipv6_rate_limit_prefix, gpg_challenge_prefix, site_name } =
    await getConfig(c.env.DB);
  const rl = await rateLimitIp(
    c.env.KV_SESSIONS,
    ip,
    "gpg-challenge",
    30,
    60,
    ipv6_rate_limit_prefix,
  );
  if (!rl.allowed) return c.json({ error: "Too many requests" }, 429);
  const body = await c.req.json<{ identifier: string }>();
  if (!body.identifier?.trim())
    return c.json({ error: "identifier is required" }, 400);

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
    c.env.KV_SESSIONS,
    rlIp,
    "gpg-login",
    10,
    60,
    gpgLoginConfig.ipv6_rate_limit_prefix,
  );
  if (!rl2.allowed) return c.json({ error: "Too many requests" }, 429);
  const body = await c.req.json<{
    identifier: string;
    signed_message: string;
  }>();
  if (!body.identifier?.trim() || !body.signed_message?.trim())
    return c.json({ error: "identifier and signed_message are required" }, 400);

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
    return c.json({ error: "Invalid credentials" }, 401);
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
    return c.json({ error: "No GPG keys registered" }, 401);
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
    return c.json({ error: "Invalid signature" }, 401);
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
    return c.json({ error: "Invalid signature" }, 401);
  }

  // Extract and validate the challenge from the signed text
  const challengeMatch = verifyResult.signedText.match(
    /\nChallenge:\s*([a-f0-9]+)/,
  );
  if (!challengeMatch) {
    return c.json({ error: "Invalid signed message format" }, 401);
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
    return c.json({ error: "Challenge expired or invalid" }, 401);
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
  const token = await issueSession(c, user, ttl);
  return c.json({
    token,
    user: await safeUser(c.env.APP_URL, c.env.DB, user),
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Exported for the invite-registration flow, which needs to hand the client
 *  the same profile shape ordinary registration returns. */
export async function safeUser(
  baseUrl: string,
  db: D1Database,
  user: UserRow,
): Promise<AuthUser & { unproxied_avatar_url: string | null }> {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    display_name: user.display_name,
    avatar_url: await proxyImageUrl(baseUrl, db, user.avatar_url),
    unproxied_avatar_url: user.avatar_url,
    role: user.role,
    email_verified: user.email_verified === 1,
  };
}

async function sha256(str: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(str),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default app;
