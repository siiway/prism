// Auth routes: register, login, logout, 2FA, passkeys, email verify, social OAuth callback

import { Hono } from "hono";
import { getConfig, getConfigValue, getJwtSecret } from "../lib/config";
import {
  hashPassword,
  randomId,
  randomBase64url,
  verifyPassword,
} from "../lib/crypto";
import { sendEmail, verifyEmailTemplate } from "../lib/email";
import { signJWT } from "../lib/jwt";
import {
  generateBackupCodes,
  generateTotp,
  generateTotpSecret,
  totpUri,
  verifyTotp,
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
import { rateLimitIp } from "../middleware/rateLimit";
import { requireAuth } from "../middleware/auth";
import type {
  AuthUser,
  PasskeyRow,
  SiteInviteRow,
  TotpAuthenticatorRow,
  TotpRecoveryRow,
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
  metadata: Record<string, unknown>,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      "INSERT INTO login_errors (id, error_code, identifier, ip_address, user_agent, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      randomId(),
      errorCode,
      identifier,
      ip,
      userAgent,
      JSON.stringify(metadata),
      now,
    )
    .run();
}

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

function getIp(c: {
  req: { header: (h: string) => string | undefined };
}): string {
  return (
    c.req.header("CF-Connecting-IP") ??
    c.req.header("X-Forwarded-For") ??
    "unknown"
  );
}

async function issueSession(
  db: D1Database,
  secret: string,
  user: UserRow,
  ttlSeconds: number,
): Promise<string> {
  const sessionId = randomId(32);
  const now = Math.floor(Date.now() / 1000);
  const token = await signJWT(
    {
      sub: user.id,
      role: user.role,
      email: user.email,
      username: user.username,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
      email_verified: user.email_verified === 1,
      sessionId,
    },
    secret,
    ttlSeconds,
  );
  const hash = await sha256(token);
  await db
    .prepare(
      "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(sessionId, user.id, hash, now + ttlSeconds, now)
    .run();
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

  // Invite-only mode: validate the invite token before anything else
  let usedInvite: SiteInviteRow | null = null;
  if (config.invite_only) {
    if (!body.invite_token)
      return c.json({ error: "An invite token is required to register" }, 403);

    const now = Math.floor(Date.now() / 1000);
    const invite = await c.env.DB.prepare(
      "SELECT * FROM site_invites WHERE token = ?",
    )
      .bind(body.invite_token)
      .first<SiteInviteRow>();

    if (!invite) return c.json({ error: "Invalid invite token" }, 403);
    if (invite.expires_at !== null && invite.expires_at < now)
      return c.json({ error: "Invite token has expired" }, 403);
    if (invite.max_uses !== null && invite.use_count >= invite.max_uses)
      return c.json({ error: "Invite token has reached its usage limit" }, 403);
    if (
      invite.email &&
      invite.email.toLowerCase() !== (body.email ?? "").toLowerCase().trim()
    )
      return c.json(
        { error: "This invite is for a different email address" },
        403,
      );

    usedInvite = invite;
  }

  const captchaOk = await verifyCaptchaToken(
    c.env.DB,
    body.captcha_token,
    body.pow_challenge,
    body.pow_nonce,
    ip,
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
        verifyToken,
        now,
        now,
      )
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("UNIQUE"))
      return c.json({ error: "Email or username already taken" }, 409);
    throw err;
  }

  // Mark invite as used
  if (usedInvite) {
    await c.env.DB.prepare(
      "UPDATE site_invites SET use_count = use_count + 1 WHERE id = ?",
    )
      .bind(usedInvite.id)
      .run();
  }

  if (verifyToken && config.email_provider !== "none") {
    const verifyUrl = `${c.env.APP_URL}/api/auth/verify-email?token=${verifyToken}`;
    const tmpl = verifyEmailTemplate(config.site_name, verifyUrl);
    await sendEmail(
      {
        to: body.email,
        subject: `Verify your email — ${config.site_name}`,
        ...tmpl,
      },
      {
        provider: config.email_provider,
        from: config.email_from,
        apiKey: config.email_api_key,
        smtpHost: config.smtp_host,
        smtpPort: config.smtp_port,
        smtpSecure: config.smtp_secure,
        smtpUser: config.smtp_user,
        smtpPassword: config.smtp_password,
      },
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
  const token = await issueSession(
    c.env.DB,
    await getJwtSecret(c.env.KV_SESSIONS),
    user,
    ttl,
  );
  return c.json({ token, user: safeUser(user) }, 201);
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
      logLoginError(c.env.DB, "rate_limited", null, ip, ua, {}).catch(() => {}),
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

  const captchaOk = await verifyCaptchaToken(
    c.env.DB,
    body.captcha_token,
    body.pow_challenge,
    body.pow_nonce,
    ip,
  );
  if (!captchaOk.success) {
    c.executionCtx.waitUntil(
      logLoginError(
        c.env.DB,
        "captcha_failed",
        body.identifier ?? null,
        ip,
        ua,
        {},
      ).catch(() => {}),
    );
    return c.json({ error: captchaOk.error ?? "Captcha failed" }, 400);
  }

  const isEmail = body.identifier.includes("@");
  const identifier = body.identifier.toLowerCase().trim();
  let user: UserRow | null;
  if (isEmail) {
    // Check primary email first, then alternate emails
    user = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?")
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
          "SELECT * FROM users WHERE id = ?",
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
    user = await c.env.DB.prepare("SELECT * FROM users WHERE username = ?")
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
    const ok = await verifyAnyTotp(c.env.DB, user.id, body.totp_code);
    if (!ok) {
      c.executionCtx.waitUntil(
        logLoginError(
          c.env.DB,
          "totp_invalid",
          body.identifier ?? null,
          ip,
          ua,
          { user_id: user.id },
        ).catch(() => {}),
      );
      return c.json({ error: "Invalid TOTP code" }, 401);
    }
  }

  const config = await getConfig(c.env.DB);
  const ttl = config.session_ttl_days * 24 * 60 * 60;
  const token = await issueSession(
    c.env.DB,
    await getJwtSecret(c.env.KV_SESSIONS),
    user,
    ttl,
  );
  return c.json({ token, user: safeUser(user) });
});

// ─── Logout ──────────────────────────────────────────────────────────────────

app.post("/logout", requireAuth, async (c) => {
  const sessionId = c.get("sessionId");
  await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?")
    .bind(sessionId)
    .run();
  return c.json({ message: "Logged out" });
});

// ─── Email verification ───────────────────────────────────────────────────────

app.get("/verify-email", async (c) => {
  const token = c.req.query("token");
  const isAlt = c.req.query("alt") === "1";
  if (!token) return c.redirect(`${c.env.APP_URL}/verify-email?status=invalid`);

  const now = Math.floor(Date.now() / 1000);

  if (isAlt) {
    // Alternate email verification
    const altEmail = await c.env.DB.prepare(
      "SELECT id, verified FROM user_emails WHERE verify_token = ?",
    )
      .bind(token)
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
    "SELECT * FROM users WHERE email_verify_token = ?",
  )
    .bind(token)
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

  // Reuse existing code or generate a new one
  let code = user.email_verify_code;
  if (!code) {
    code = randomId(12);
    await c.env.DB.prepare(
      "UPDATE users SET email_verify_code = ? WHERE id = ?",
    )
      .bind(code, user.id)
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
        await runImapPoll(c.env.DB, c.env.KV_CACHE);
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

  // Generate a fresh token
  const verifyToken = randomBase64url(24);
  await c.env.DB.prepare("UPDATE users SET email_verify_token = ? WHERE id = ?")
    .bind(verifyToken, user.id)
    .run();

  const verifyUrl = `${c.env.APP_URL}/api/auth/verify-email?token=${verifyToken}`;
  const tmpl = verifyEmailTemplate(config.site_name, verifyUrl);
  await sendEmail(
    {
      to: user.email,
      subject: `Verify your email — ${config.site_name}`,
      ...tmpl,
    },
    {
      provider: config.email_provider,
      from: config.email_from,
      apiKey: config.email_api_key,
      smtpHost: config.smtp_host,
      smtpPort: config.smtp_port,
      smtpSecure: config.smtp_secure,
      smtpUser: config.smtp_user,
      smtpPassword: config.smtp_password,
    },
  );

  return c.json({ message: "Verification email sent" });
});

// ─── TOTP (multi-authenticator) ───────────────────────────────────────────────

// Verify a code against any of the user's enabled authenticators or backup codes.
// Consumes a backup code if matched.
async function verifyAnyTotp(
  db: D1Database,
  userId: string,
  code: string,
): Promise<boolean> {
  const recovery = await db
    .prepare("SELECT * FROM user_totp_recovery WHERE user_id = ?")
    .bind(userId)
    .first<TotpRecoveryRow>();
  if (recovery) {
    const codes = JSON.parse(recovery.backup_codes) as string[];
    const normalized = code.replace(/-/g, "").toUpperCase();
    const idx = codes.indexOf(normalized);
    if (idx !== -1) {
      codes.splice(idx, 1);
      await db
        .prepare(
          "UPDATE user_totp_recovery SET backup_codes = ? WHERE user_id = ?",
        )
        .bind(JSON.stringify(codes), userId)
        .run();
      return true;
    }
  }
  const totps = await db
    .prepare(
      "SELECT * FROM totp_authenticators WHERE user_id = ? AND enabled = 1",
    )
    .bind(userId)
    .all<TotpAuthenticatorRow>();
  for (const t of totps.results) {
    if (await verifyTotp(code, t.secret)) return true;
  }
  return false;
}

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

  await c.env.DB.prepare(
    "INSERT INTO totp_authenticators (id, user_id, name, secret, enabled, created_at) VALUES (?, ?, ?, ?, 0, ?)",
  )
    .bind(id, user.id, name, secret, now)
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

  const ok = await verifyTotp(body.code, auth.secret);
  if (!ok) return c.json({ error: "Invalid TOTP code" }, 400);

  await c.env.DB.prepare(
    "UPDATE totp_authenticators SET enabled = 1 WHERE id = ?",
  )
    .bind(body.id)
    .run();

  // Generate backup codes only on the first enabled authenticator
  const existing = await c.env.DB.prepare(
    "SELECT user_id FROM user_totp_recovery WHERE user_id = ?",
  )
    .bind(user.id)
    .first<{ user_id: string }>();
  if (existing) return c.json({ message: "Authenticator enabled" });

  const backupCodes = generateBackupCodes();
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    "INSERT INTO user_totp_recovery (user_id, backup_codes, updated_at) VALUES (?, ?, ?)",
  )
    .bind(user.id, JSON.stringify(backupCodes), now)
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
    "SELECT id FROM totp_authenticators WHERE id = ? AND user_id = ? AND enabled = 1",
  )
    .bind(id, user.id)
    .first<{ id: string }>();
  if (!auth) return c.json({ error: "Authenticator not found" }, 404);

  const ok = await verifyAnyTotp(c.env.DB, user.id, body.code);
  if (!ok) return c.json({ error: "Invalid TOTP code" }, 400);

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

  const ok = await verifyAnyTotp(c.env.DB, user.id, body.code);
  if (!ok) return c.json({ error: "Invalid TOTP code" }, 400);

  const backupCodes = generateBackupCodes();
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    "INSERT INTO user_totp_recovery (user_id, backup_codes, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET backup_codes = excluded.backup_codes, updated_at = excluded.updated_at",
  )
    .bind(user.id, JSON.stringify(backupCodes), now)
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
      "SELECT * FROM users WHERE username = ? OR email = ?",
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
  const token = await issueSession(
    c.env.DB,
    await getJwtSecret(c.env.KV_SESSIONS),
    user,
    ttl,
  );
  return c.json({ token, user: safeUser(user) });
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
  await c.env.DB.prepare("DELETE FROM passkeys WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .run();
  return c.json({ message: "Passkey deleted" });
});

// ─── PoW challenge ───────────────────────────────────────────────────────────

app.get("/pow-challenge", async (c) => {
  const difficulty = await getConfigValue(c.env.DB, "pow_difficulty");
  const challenge = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return c.json({ challenge, difficulty });
});

// ─── Sessions list ───────────────────────────────────────────────────────────

app.get("/sessions", requireAuth, async (c) => {
  const user = c.get("user");
  const currentSessionId = c.get("sessionId");
  const sessions = await c.env.DB.prepare(
    "SELECT id, user_agent, ip_address, created_at, expires_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC",
  )
    .bind(user.id)
    .all();
  return c.json({
    sessions: sessions.results.map((s) => ({
      ...s,
      is_current: s.id === currentSessionId,
    })),
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
  const { ipv6_rate_limit_prefix } = await getConfig(c.env.DB);
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
    ? c.env.DB.prepare("SELECT id FROM users WHERE email = ?")
        .bind(identifier)
        .first<{ id: string }>()
    : c.env.DB.prepare("SELECT id FROM users WHERE username = ?")
        .bind(identifier)
        .first<{ id: string }>());

  // Always return success to avoid user enumeration
  const userId = user?.id ?? randomId(16);

  const challenge = randomId(32);
  const now = Math.floor(Date.now() / 1000);
  const text = `Prism login\nUser: ${identifier}\nChallenge: ${challenge}\nTimestamp: ${now}`;

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
    ? c.env.DB.prepare("SELECT * FROM users WHERE email = ?")
        .bind(identifier)
        .first<UserRow>()
    : c.env.DB.prepare("SELECT * FROM users WHERE username = ?")
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
      logLoginError(c.env.DB, "gpg_no_keys", body.identifier, ip, ua, {
        user_id: user.id,
      }).catch(() => {}),
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
  const token = await issueSession(
    c.env.DB,
    await getJwtSecret(c.env.KV_SESSIONS),
    user,
    ttl,
  );
  return c.json({ token, user: safeUser(user) });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeUser(user: UserRow): AuthUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    display_name: user.display_name,
    avatar_url: user.avatar_url,
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
