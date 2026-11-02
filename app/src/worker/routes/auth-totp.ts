// TOTP authenticators: /api/auth/totp* — enrolling, verifying and removing
// authenticator apps, and backup codes.

import { Hono } from "hono";
import { getConfig } from "../lib/config";
import { encryptSecret, decryptSecret } from "../lib/secretCrypto";
import {
  claimEnrolmentCounter,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCodes,
  matchTotpCounter,
  totpUri,
  verifyAnyTotp,
} from "../lib/totp";
import { requireAuth } from "../middleware/auth";
import {
  deliverUserEmailNotifications,
  notificationActorMetaFromHeaders,
} from "../lib/notifications";
import { teamsBlockingDowngrade } from "../lib/teamRequirements";
import type { TotpAuthenticatorRow, Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

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
  if (!auth) return c.json({ error: "authenticator_not_found" }, 404);
  if (auth.enabled) return c.json({ error: "already_enabled" }, 409);

  const plainSecret = (await decryptSecret(c.env, auth.secret)) ?? auth.secret;
  const counter = await matchTotpCounter(body.code, plainSecret);
  if (counter === null) return c.json({ error: "totp_invalid" }, 400);

  // Retire the enrolment code before enabling anything - otherwise a failure
  // between the two leaves 2FA on with the code the user just typed still live
  // at the login form. Claiming first can only ever leave a counter recorded
  // against an authenticator that was never enabled, which costs nothing.
  await claimEnrolmentCounter(c.env.DB, body.id, counter);

  await c.env.DB.prepare(
    "UPDATE totp_authenticators SET enabled = 1 WHERE id = ?",
  )
    .bind(body.id)
    .run();

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
  if (existing) return c.json({ ok: true });

  const backupCodes = generateBackupCodes();
  const hashedCodes = await hashBackupCodes(backupCodes);
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    "INSERT INTO user_totp_recovery (user_id, backup_codes, updated_at) VALUES (?, ?, ?)",
  )
    .bind(user.id, JSON.stringify(hashedCodes), now)
    .run();
  return c.json({
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
  if (!auth) return c.json({ error: "authenticator_not_found" }, 404);

  const ok = await verifyAnyTotp(c.env, user.id, body.code);
  if (!ok) return c.json({ error: "totp_invalid" }, 400);

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
          error: "team_requires_2fa",
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

  return c.json({ ok: true });
});

app.post("/totp/backup-codes", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ code: string }>();

  const count = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM totp_authenticators WHERE user_id = ? AND enabled = 1",
  )
    .bind(user.id)
    .first<{ n: number }>();
  if ((count?.n ?? 0) === 0) return c.json({ error: "no_totp" }, 400);

  const ok = await verifyAnyTotp(c.env, user.id, body.code);
  if (!ok) return c.json({ error: "totp_invalid" }, 400);

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

export default app;
