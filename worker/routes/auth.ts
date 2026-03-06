// Auth routes: register, login, logout, 2FA, passkeys, email verify, social OAuth callback

import { Hono } from 'hono';
import { getConfig, getConfigValue } from '../lib/config';
import { hashPassword, randomId, randomBase64url, verifyPassword } from '../lib/crypto';
import { sendEmail, verifyEmailTemplate } from '../lib/email';
import { signJWT } from '../lib/jwt';
import {
  generateBackupCodes,
  generateTotp,
  generateTotpSecret,
  totpUri,
  verifyTotp,
} from '../lib/totp';
import {
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  rowToPasskey,
} from '../lib/webauthn';
import { verifyCaptchaToken } from '../middleware/captcha';
import { rateLimitIp } from '../middleware/rateLimit';
import { requireAuth } from '../middleware/auth';
import type { AuthUser, PasskeyRow, TotpRow, UserRow, Variables } from '../types';

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

function getIp(c: { req: { header: (h: string) => string | undefined } }): string {
  return c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? 'unknown';
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
      'INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(sessionId, user.id, hash, now + ttlSeconds, now)
    .run();
  return token;
}

// ─── Register ────────────────────────────────────────────────────────────────

app.post('/register', async (c) => {
  const ip = getIp(c);
  const rl = await rateLimitIp(c.env.KV_SESSIONS, ip, 'register', 5, 300);
  if (!rl.allowed) return c.json({ error: 'Too many requests' }, 429);

  const config = await getConfig(c.env.DB);
  if (!config.allow_registration) return c.json({ error: 'Registration is disabled' }, 403);

  const body = await c.req.json<{
    email: string;
    username: string;
    password: string;
    display_name?: string;
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
  if (!captchaOk.success) return c.json({ error: captchaOk.error ?? 'Captcha failed' }, 400);

  if (!body.email || !body.username || !body.password)
    return c.json({ error: 'email, username and password are required' }, 400);
  if (body.password.length < 8)
    return c.json({ error: 'Password must be at least 8 characters' }, 400);
  if (!/^[a-z0-9_.-]{2,32}$/i.test(body.username))
    return c.json({ error: 'Username must be 2-32 alphanumeric characters' }, 400);

  const userId = randomId();
  const passwordHash = await hashPassword(body.password);
  const now = Math.floor(Date.now() / 1000);
  const verifyToken = config.require_email_verification ? randomBase64url(24) : null;

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
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('UNIQUE')) return c.json({ error: 'Email or username already taken' }, 409);
    throw err;
  }

  if (verifyToken && config.email_provider !== 'none') {
    const verifyUrl = `${c.env.APP_URL}/verify-email?token=${verifyToken}`;
    const tmpl = verifyEmailTemplate(config.site_name, verifyUrl);
    await sendEmail(
      { to: body.email, subject: `Verify your email — ${config.site_name}`, ...tmpl },
      { provider: config.email_provider, from: config.email_from, apiKey: config.email_api_key },
    );
  }

  if (config.require_email_verification) {
    return c.json({ message: 'Registration successful. Please verify your email.' }, 201);
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?')
    .bind(userId)
    .first<UserRow>();
  if (!user) return c.json({ error: 'User not found after creation' }, 500);

  const ttl = config.session_ttl_days * 24 * 60 * 60;
  const token = await issueSession(c.env.DB, c.env.JWT_SECRET, user, ttl);
  return c.json({ token, user: safeUser(user) }, 201);
});

// ─── Login ───────────────────────────────────────────────────────────────────

app.post('/login', async (c) => {
  const ip = getIp(c);
  const rl = await rateLimitIp(c.env.KV_SESSIONS, ip, 'login', 10, 60);
  if (!rl.allowed) return c.json({ error: 'Too many requests' }, 429);

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
  if (!captchaOk.success) return c.json({ error: captchaOk.error ?? 'Captcha failed' }, 400);

  const isEmail = body.identifier.includes('@');
  const user = await c.env.DB.prepare(
    isEmail ? 'SELECT * FROM users WHERE email = ?' : 'SELECT * FROM users WHERE username = ?',
  )
    .bind(isEmail ? body.identifier.toLowerCase().trim() : body.identifier.toLowerCase().trim())
    .first<UserRow>();

  if (!user || !user.password_hash) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }
  if (!user.is_active) return c.json({ error: 'Account is disabled' }, 403);

  const passwordOk = await verifyPassword(body.password, user.password_hash);
  if (!passwordOk) return c.json({ error: 'Invalid credentials' }, 401);

  // Check TOTP if enabled
  const totp = await c.env.DB.prepare('SELECT * FROM totp_secrets WHERE user_id = ?')
    .bind(user.id)
    .first<TotpRow>();
  if (totp?.enabled) {
    if (!body.totp_code) {
      return c.json({ error: 'TOTP code required', totp_required: true }, 200);
    }
    // Check backup codes first
    const backupCodes = JSON.parse(totp.backup_codes) as string[];
    const backupIdx = backupCodes.indexOf(body.totp_code.replace(/-/g, '').toUpperCase());
    if (backupIdx !== -1) {
      backupCodes.splice(backupIdx, 1);
      await c.env.DB.prepare('UPDATE totp_secrets SET backup_codes = ? WHERE user_id = ?')
        .bind(JSON.stringify(backupCodes), user.id)
        .run();
    } else {
      const totpOk = await verifyTotp(body.totp_code, totp.secret);
      if (!totpOk) return c.json({ error: 'Invalid TOTP code' }, 401);
    }
  }

  const config = await getConfig(c.env.DB);
  const ttl = config.session_ttl_days * 24 * 60 * 60;
  const token = await issueSession(c.env.DB, c.env.JWT_SECRET, user, ttl);
  return c.json({ token, user: safeUser(user) });
});

// ─── Logout ──────────────────────────────────────────────────────────────────

app.post('/logout', requireAuth, async (c) => {
  const sessionId = c.get('sessionId');
  await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
  return c.json({ message: 'Logged out' });
});

// ─── Email verification ───────────────────────────────────────────────────────

app.get('/verify-email', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.json({ error: 'Token required' }, 400);

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email_verify_token = ?')
    .bind(token)
    .first<UserRow>();
  if (!user) return c.json({ error: 'Invalid or expired token' }, 400);

  await c.env.DB.prepare(
    'UPDATE users SET email_verified = 1, email_verify_token = NULL, updated_at = ? WHERE id = ?',
  )
    .bind(Math.floor(Date.now() / 1000), user.id)
    .run();

  return c.json({ message: 'Email verified successfully' });
});

// ─── TOTP setup ───────────────────────────────────────────────────────────────

app.post('/totp/setup', requireAuth, async (c) => {
  const user = c.get('user');
  const config = await getConfig(c.env.DB);

  const existing = await c.env.DB.prepare('SELECT * FROM totp_secrets WHERE user_id = ?')
    .bind(user.id)
    .first<TotpRow>();
  if (existing?.enabled) return c.json({ error: 'TOTP already enabled' }, 409);

  const secret = generateTotpSecret();
  const now = Math.floor(Date.now() / 1000);

  if (existing) {
    await c.env.DB.prepare('UPDATE totp_secrets SET secret = ?, enabled = 0 WHERE user_id = ?')
      .bind(secret, user.id)
      .run();
  } else {
    await c.env.DB.prepare(
      'INSERT INTO totp_secrets (user_id, secret, enabled, backup_codes, created_at) VALUES (?, ?, 0, ?, ?)',
    )
      .bind(user.id, secret, '[]', now)
      .run();
  }

  const uri = totpUri(secret, user.email, config.site_name);
  return c.json({ secret, uri });
});

app.post('/totp/verify', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ code: string }>();

  const totp = await c.env.DB.prepare('SELECT * FROM totp_secrets WHERE user_id = ?')
    .bind(user.id)
    .first<TotpRow>();
  if (!totp) return c.json({ error: 'TOTP not set up' }, 400);

  const ok = await verifyTotp(body.code, totp.secret);
  if (!ok) return c.json({ error: 'Invalid TOTP code' }, 400);

  const backupCodes = generateBackupCodes();
  await c.env.DB.prepare(
    'UPDATE totp_secrets SET enabled = 1, backup_codes = ? WHERE user_id = ?',
  )
    .bind(JSON.stringify(backupCodes), user.id)
    .run();

  return c.json({ message: 'TOTP enabled', backup_codes: backupCodes });
});

app.delete('/totp', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ code: string }>();

  const totp = await c.env.DB.prepare('SELECT * FROM totp_secrets WHERE user_id = ?')
    .bind(user.id)
    .first<TotpRow>();
  if (!totp?.enabled) return c.json({ error: 'TOTP not enabled' }, 400);

  const ok = await verifyTotp(body.code, totp.secret);
  if (!ok) return c.json({ error: 'Invalid TOTP code' }, 400);

  await c.env.DB.prepare('DELETE FROM totp_secrets WHERE user_id = ?').bind(user.id).run();
  return c.json({ message: 'TOTP disabled' });
});

app.post('/totp/backup-codes', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ code: string }>();

  const totp = await c.env.DB.prepare('SELECT * FROM totp_secrets WHERE user_id = ?')
    .bind(user.id)
    .first<TotpRow>();
  if (!totp?.enabled) return c.json({ error: 'TOTP not enabled' }, 400);

  const ok = await verifyTotp(body.code, totp.secret);
  if (!ok) return c.json({ error: 'Invalid TOTP code' }, 400);

  const backupCodes = generateBackupCodes();
  await c.env.DB.prepare('UPDATE totp_secrets SET backup_codes = ? WHERE user_id = ?')
    .bind(JSON.stringify(backupCodes), user.id)
    .run();

  return c.json({ backup_codes: backupCodes });
});

// ─── Passkey registration ────────────────────────────────────────────────────

app.post('/passkey/register/begin', requireAuth, async (c) => {
  const user = c.get('user');
  const rpId = new URL(c.env.APP_URL).hostname;
  const config = await getConfig(c.env.DB);

  const existingRows = await c.env.DB.prepare('SELECT * FROM passkeys WHERE user_id = ?')
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
  await c.env.KV_CACHE.put(
    `passkey:reg:${user.id}`,
    JSON.stringify(options),
    { expirationTtl: 300 },
  );

  return c.json(options);
});

app.post('/passkey/register/finish', requireAuth, async (c) => {
  const user = c.get('user');
  const rpId = new URL(c.env.APP_URL).hostname;
  const origin = c.env.APP_URL;

  const stored = await c.env.KV_CACHE.get(`passkey:reg:${user.id}`);
  if (!stored) return c.json({ error: 'Registration session expired' }, 400);

  const options = JSON.parse(stored) as { challenge: string };
  const body = await c.req.json<{ response: Parameters<typeof finishPasskeyRegistration>[0]; name?: string }>();

  let verification;
  try {
    verification = await finishPasskeyRegistration(body.response, options.challenge, rpId, origin);
  } catch (err) {
    return c.json({ error: `Registration failed: ${String(err)}` }, 400);
  }

  if (!verification.verified || !verification.registrationInfo) {
    return c.json({ error: 'Verification failed' }, 400);
  }

  await c.env.KV_CACHE.delete(`passkey:reg:${user.id}`);

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const now = Math.floor(Date.now() / 1000);
  const passkeyId = randomId();
  const name = body.name ?? 'Passkey';

  // Encode public key as base64url
  const pkBase64 = btoa(String.fromCharCode(...credential.publicKey))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

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

  return c.json({ message: 'Passkey registered', id: passkeyId });
});

// ─── Passkey authentication ──────────────────────────────────────────────────

app.post('/passkey/auth/begin', async (c) => {
  const rpId = new URL(c.env.APP_URL).hostname;

  const body = await c.req.json<{ username?: string }>().catch(() => ({ username: undefined }));
  let passkeys: PasskeyRow[] = [];

  const username = 'username' in body ? body.username : undefined;
  if (username) {
    const user = await c.env.DB.prepare('SELECT * FROM users WHERE username = ? OR email = ?')
      .bind(username, username)
      .first<{ id: string }>();
    if (user) {
      const rows = await c.env.DB.prepare('SELECT * FROM passkeys WHERE user_id = ?')
        .bind(user.id)
        .all<PasskeyRow>();
      passkeys = rows.results;
    }
  }

  const options = await beginPasskeyAuthentication(passkeys.map(rowToPasskey), rpId);

  // Store challenge in KV (5 minute TTL)
  const challengeKey = `passkey:auth:${options.challenge}`;
  await c.env.KV_CACHE.put(challengeKey, JSON.stringify(options), { expirationTtl: 300 });

  return c.json(options);
});

app.post('/passkey/auth/finish', async (c) => {
  const rpId = new URL(c.env.APP_URL).hostname;
  const origin = c.env.APP_URL;

  const body = await c.req.json<{ challenge?: string; response?: unknown }>();
  if (!body.challenge) return c.json({ error: 'challenge required' }, 400);

  const stored = await c.env.KV_CACHE.get(`passkey:auth:${body.challenge}`);
  if (!stored) return c.json({ error: 'Authentication session expired' }, 400);

  const options = JSON.parse(stored) as { challenge: string };

  // Find passkey by credential id
  const response = body.response as { id?: string };
  if (!response?.id) return c.json({ error: 'Invalid response' }, 400);

  const passkeyRow = await c.env.DB.prepare('SELECT * FROM passkeys WHERE credential_id = ?')
    .bind(response.id)
    .first<PasskeyRow>();
  if (!passkeyRow) return c.json({ error: 'Passkey not found' }, 400);

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

  if (!verification.verified) return c.json({ error: 'Verification failed' }, 400);

  await c.env.KV_CACHE.delete(`passkey:auth:${body.challenge}`);

  // Update counter
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?')
    .bind(verification.authenticationInfo.newCounter, now, passkeyRow.id)
    .run();

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?')
    .bind(passkeyRow.user_id)
    .first<UserRow>();
  if (!user || !user.is_active) return c.json({ error: 'Account not found or disabled' }, 400);

  const config = await getConfig(c.env.DB);
  const ttl = config.session_ttl_days * 24 * 60 * 60;
  const token = await issueSession(c.env.DB, c.env.JWT_SECRET, user, ttl);
  return c.json({ token, user: safeUser(user) });
});

// ─── List passkeys ───────────────────────────────────────────────────────────

app.get('/passkeys', requireAuth, async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    'SELECT id, name, device_type, backed_up, created_at, last_used_at FROM passkeys WHERE user_id = ?',
  )
    .bind(user.id)
    .all<Pick<PasskeyRow, 'id' | 'name' | 'device_type' | 'backed_up' | 'created_at' | 'last_used_at'>>();
  return c.json({ passkeys: rows.results });
});

app.delete('/passkeys/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?')
    .bind(id, user.id)
    .run();
  return c.json({ message: 'Passkey deleted' });
});

// ─── PoW challenge ───────────────────────────────────────────────────────────

app.get('/pow-challenge', async (c) => {
  const difficulty = await getConfigValue(c.env.DB, 'pow_difficulty');
  const challenge = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return c.json({ challenge, difficulty });
});

// ─── Sessions list ───────────────────────────────────────────────────────────

app.get('/sessions', requireAuth, async (c) => {
  const user = c.get('user');
  const sessions = await c.env.DB.prepare(
    'SELECT id, user_agent, ip_address, created_at, expires_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC',
  )
    .bind(user.id)
    .all();
  return c.json({ sessions: sessions.results });
});

app.delete('/sessions/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?')
    .bind(id, user.id)
    .run();
  return c.json({ message: 'Session revoked' });
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
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default app;
