// Site-admin control over an individual account.
//
// `admin.ts` could already list, inspect, disable and delete users. What it
// could not do was any of the things a user does to *themselves* — the
// account's credentials, its second factors, its tokens, its addresses. Those
// all live behind `/api/user/me/*`, which by construction only ever means the
// caller.
//
// That gap is where the real operator work is: someone is locked out of their
// authenticator, a token leaked, an address was typed wrong at registration.
// Every one of those had exactly one answer before this file existed — open
// the database and edit the row by hand.
//
// So the endpoints here are the `/me` surface again, addressed by user id.
// They are deliberately explicit rather than an "act as this user" switch on
// the self-serve routes: those routes assume the caller is the subject in
// ways that go well past authorization (session cookies, notification
// targets, restriction conversion), and quietly changing what `me` means is
// not a change anyone can audit by reading one function.
//
// Mounted under /api/admin/users, which sits behind requireAdmin. Registered
// *after* admin.ts's own /users routes, so `GET /users` and `GET /users/:id`
// keep their existing handlers and everything deeper falls through to here.

import { Hono } from "hono";
import { getIp } from "../lib/clientIp";
import { recordAudit, auditRequestMeta } from "../lib/audit";
import { hashPassword, randomId } from "../lib/crypto";
import { readPage } from "../lib/pagination";
import { proxyImageUrl } from "../lib/proxyImage";
import { isUserLocked } from "../lib/lockdown";
import type { DomainRow, UserEmailRow, Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Load the target account, or null. Team-kind rows are excluded: they are
 *  the synthetic mirror of a team and have no credentials to manage. */
async function loadTarget(
  db: D1Database,
  id: string,
): Promise<{ id: string; username: string; email: string } | null> {
  return db
    .prepare(
      "SELECT id, username, email FROM users WHERE id = ? AND kind = 'user'",
    )
    .bind(id)
    .first<{ id: string; username: string; email: string }>();
}

function auditUser(
  c: import("hono").Context<AppEnv>,
  targetId: string,
  targetName: string,
  action: string,
  metadata: Record<string, unknown> = {},
): void {
  const admin = c.get("user");
  const meta = auditRequestMeta(c);
  // Written to both scopes on purpose. The platform log is the operator's
  // record; the user-scope copy is how the account holder finds out that
  // someone else changed their credentials — which is the whole point of
  // Transparent Control, and matters most for exactly these actions.
  void recordAudit(c.env, c.executionCtx, [
    {
      scope: "platform",
      scopeId: null,
      action: `admin.${action}`,
      actorId: admin.id,
      actorName: admin.username,
      resourceType: "user",
      resourceId: targetId,
      resourceName: targetName,
      ip: meta.ip ?? getIp(c),
      userAgent: meta.userAgent,
      geo: meta.geo,
      metadata,
    },
    {
      scope: "user",
      scopeId: targetId,
      action: `admin.${action}`,
      actorId: admin.id,
      actorName: admin.username,
      resourceType: "user",
      resourceId: targetId,
      resourceName: targetName,
      ip: meta.ip ?? getIp(c),
      userAgent: meta.userAgent,
      geo: meta.geo,
      metadata: { ...metadata, site_admin: true },
    },
  ]);
}

/** Drop every session for a user. Called after anything that changes who can
 *  authenticate as them — a password reset that left the old sessions alive
 *  would not actually lock the intruder out. */
async function revokeSessions(db: D1Database, userId: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}

// ─── Credentials ──────────────────────────────────────────────────────────────

/** Set or clear the account's password.
 *
 *  `null` clears it, which is a real state in this system rather than a
 *  mistake: an account that signs in through a social provider only has no
 *  password hash. Clearing one on an account with no social connection would
 *  lock it out, so that combination is refused. */
app.post("/:id/password", async (c) => {
  const id = c.req.param("id");
  const target = await loadTarget(c.env.DB, id);
  if (!target) return c.json({ error: "User not found" }, 404);

  const body = await c.req.json<{
    password?: string | null;
    /** Default true — a credential change that leaves old sessions running
     *  has not actually taken effect. */
    revoke_sessions?: boolean;
  }>();

  let hash: string | null = null;
  if (body.password === null) {
    const connections = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM social_connections WHERE user_id = ?",
    )
      .bind(id)
      .first<{ n: number }>();
    if (!connections?.n)
      return c.json(
        {
          error:
            "Clearing the password would lock this account out — it has no social connection to sign in with",
        },
        409,
      );
  } else {
    if (typeof body.password !== "string" || body.password.length < 8)
      return c.json({ error: "Password must be at least 8 characters" }, 400);
    hash = await hashPassword(body.password);
  }

  await c.env.DB.prepare(
    "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
  )
    .bind(hash, Math.floor(Date.now() / 1000), id)
    .run();

  if (body.revoke_sessions !== false) await revokeSessions(c.env.DB, id);

  auditUser(c, id, target.username, "user.password_set", {
    cleared: hash === null,
    sessions_revoked: body.revoke_sessions !== false,
  });
  return c.json({
    message: hash === null ? "Password cleared" : "Password set",
  });
});

// ─── Second factors ───────────────────────────────────────────────────────────

/** Everything the account can authenticate with, so an operator handling a
 *  lockout can see what they're dealing with before removing anything. */
app.get("/:id/security", async (c) => {
  const id = c.req.param("id");
  const target = await loadTarget(c.env.DB, id);
  if (!target) return c.json({ error: "User not found" }, 404);

  const [totp, passkeys, recovery, user] = await Promise.all([
    c.env.DB.prepare(
      "SELECT id, name, enabled, created_at FROM totp_authenticators WHERE user_id = ? ORDER BY created_at",
    )
      .bind(id)
      .all<{ id: string; name: string; enabled: number; created_at: number }>(),
    c.env.DB.prepare(
      "SELECT id, name, device_type, backed_up, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at",
    )
      .bind(id)
      .all<Record<string, unknown>>(),
    c.env.DB.prepare(
      "SELECT backup_codes, updated_at FROM user_totp_recovery WHERE user_id = ?",
    )
      .bind(id)
      .first<{ backup_codes: string; updated_at: number }>(),
    c.env.DB.prepare(
      "SELECT password_hash IS NOT NULL AS has_password FROM users WHERE id = ?",
    )
      .bind(id)
      .first<{ has_password: number }>(),
  ]);

  let recoveryCount = 0;
  if (recovery?.backup_codes) {
    try {
      const parsed = JSON.parse(recovery.backup_codes) as unknown;
      if (Array.isArray(parsed)) recoveryCount = parsed.length;
    } catch {
      // A malformed blob is worth surfacing as "unknown" rather than 500ing
      // the page an operator opened precisely because something is wrong.
      recoveryCount = -1;
    }
  }

  return c.json({
    has_password: (user?.has_password ?? 0) === 1,
    totp_authenticators: totp.results.map((row) => ({
      ...row,
      enabled: row.enabled === 1,
    })),
    passkeys: passkeys.results.map((row) => ({
      ...row,
      backed_up: row.backed_up === 1,
    })),
    recovery_codes: {
      count: recoveryCount,
      updated_at: recovery?.updated_at ?? null,
    },
  });
});

/** Clear every second factor at once — the account-recovery button.
 *
 *  Recovery codes go with them. Leaving those behind would mean the account
 *  is still gated on a sheet of paper the holder just told you they lost. */
app.delete("/:id/2fa", async (c) => {
  const id = c.req.param("id");
  const target = await loadTarget(c.env.DB, id);
  if (!target) return c.json({ error: "User not found" }, 404);

  const [totp, passkeys] = await Promise.all([
    c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM totp_authenticators WHERE user_id = ?",
    )
      .bind(id)
      .first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?")
      .bind(id)
      .first<{ n: number }>(),
  ]);

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM totp_authenticators WHERE user_id = ?").bind(
      id,
    ),
    c.env.DB.prepare("DELETE FROM passkeys WHERE user_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM user_totp_recovery WHERE user_id = ?").bind(
      id,
    ),
  ]);

  auditUser(c, id, target.username, "user.2fa_reset", {
    totp_removed: totp?.n ?? 0,
    passkeys_removed: passkeys?.n ?? 0,
  });
  return c.json({ message: "Two-factor authentication reset" });
});

app.delete("/:id/totp/:totpId", async (c) => {
  const id = c.req.param("id");
  const target = await loadTarget(c.env.DB, id);
  if (!target) return c.json({ error: "User not found" }, 404);

  const row = await c.env.DB.prepare(
    "SELECT id, name FROM totp_authenticators WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("totpId"), id)
    .first<{ id: string; name: string }>();
  if (!row) return c.json({ error: "Authenticator not found" }, 404);

  await c.env.DB.prepare("DELETE FROM totp_authenticators WHERE id = ?")
    .bind(row.id)
    .run();
  auditUser(c, id, target.username, "user.totp_removed", { name: row.name });
  return c.json({ message: "Authenticator removed" });
});

app.delete("/:id/passkeys/:passkeyId", async (c) => {
  const id = c.req.param("id");
  const target = await loadTarget(c.env.DB, id);
  if (!target) return c.json({ error: "User not found" }, 404);

  const row = await c.env.DB.prepare(
    "SELECT id, name FROM passkeys WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("passkeyId"), id)
    .first<{ id: string; name: string | null }>();
  if (!row) return c.json({ error: "Passkey not found" }, 404);

  await c.env.DB.prepare("DELETE FROM passkeys WHERE id = ?")
    .bind(row.id)
    .run();
  auditUser(c, id, target.username, "user.passkey_removed", {
    name: row.name,
  });
  return c.json({ message: "Passkey removed" });
});

// ─── Personal access tokens ───────────────────────────────────────────────────

app.get("/:id/tokens", async (c) => {
  const id = c.req.param("id");
  const { page, limit, offset } = readPage(
    c.req.query("page"),
    c.req.query("limit"),
    20,
  );
  const [rows, count] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, name, scopes, expires_at, last_used_at, created_at
         FROM personal_access_tokens WHERE user_id = ?
        ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(id, limit, offset)
      .all<Record<string, unknown>>(),
    c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM personal_access_tokens WHERE user_id = ?",
    )
      .bind(id)
      .first<{ n: number }>(),
  ]);
  // The token itself is never returned, here or anywhere else — it is stored
  // hashed and an admin has no more business reading it than anyone else.
  return c.json({
    tokens: rows.results.map((row) => ({
      ...row,
      scopes: JSON.parse(String(row.scopes ?? "[]")) as string[],
    })),
    total: count?.n ?? 0,
    page,
    limit,
  });
});

app.delete("/:id/tokens/:tokenId", async (c) => {
  const id = c.req.param("id");
  const target = await loadTarget(c.env.DB, id);
  if (!target) return c.json({ error: "User not found" }, 404);

  const row = await c.env.DB.prepare(
    "SELECT id, name FROM personal_access_tokens WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("tokenId"), id)
    .first<{ id: string; name: string }>();
  if (!row) return c.json({ error: "Token not found" }, 404);

  await c.env.DB.prepare("DELETE FROM personal_access_tokens WHERE id = ?")
    .bind(row.id)
    .run();
  auditUser(c, id, target.username, "user.token_revoked", { name: row.name });
  return c.json({ message: "Token revoked" });
});

// ─── Social connections ───────────────────────────────────────────────────────

app.get("/:id/connections", async (c) => {
  const id = c.req.param("id");
  const { results } = await c.env.DB.prepare(
    `SELECT id, provider, provider_user_id, token_expires_at, connected_at
       FROM social_connections WHERE user_id = ? ORDER BY connected_at`,
  )
    .bind(id)
    .all<Record<string, unknown>>();
  return c.json({ connections: results });
});

/** Unlink a provider.
 *
 *  Refused when it is the last way in: an account with no password and one
 *  connection is that connection. The user-facing endpoint enforces the same
 *  rule, and an admin unlinking someone into a lockout is not a power worth
 *  having. */
app.delete("/:id/connections/:connId", async (c) => {
  const id = c.req.param("id");
  const target = await loadTarget(c.env.DB, id);
  if (!target) return c.json({ error: "User not found" }, 404);

  const row = await c.env.DB.prepare(
    "SELECT id, provider FROM social_connections WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("connId"), id)
    .first<{ id: string; provider: string }>();
  if (!row) return c.json({ error: "Connection not found" }, 404);

  const [user, count] = await Promise.all([
    c.env.DB.prepare(
      "SELECT password_hash IS NOT NULL AS has_password FROM users WHERE id = ?",
    )
      .bind(id)
      .first<{ has_password: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM social_connections WHERE user_id = ?",
    )
      .bind(id)
      .first<{ n: number }>(),
  ]);
  if (!user?.has_password && (count?.n ?? 0) <= 1)
    return c.json(
      {
        error:
          "This is the account's only way to sign in — set a password before unlinking it",
      },
      409,
    );

  await c.env.DB.prepare("DELETE FROM social_connections WHERE id = ?")
    .bind(row.id)
    .run();
  auditUser(c, id, target.username, "user.connection_removed", {
    provider: row.provider,
  });
  return c.json({ message: "Connection removed" });
});

// ─── GPG keys ─────────────────────────────────────────────────────────────────

app.get("/:id/gpg-keys", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, fingerprint, key_id, name, created_at, last_used_at
       FROM user_gpg_keys WHERE user_id = ? ORDER BY created_at`,
  )
    .bind(c.req.param("id"))
    .all<Record<string, unknown>>();
  return c.json({ keys: results });
});

app.delete("/:id/gpg-keys/:keyId", async (c) => {
  const id = c.req.param("id");
  const target = await loadTarget(c.env.DB, id);
  if (!target) return c.json({ error: "User not found" }, 404);

  const row = await c.env.DB.prepare(
    "SELECT id, fingerprint FROM user_gpg_keys WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("keyId"), id)
    .first<{ id: string; fingerprint: string }>();
  if (!row) return c.json({ error: "Key not found" }, 404);

  await c.env.DB.prepare("DELETE FROM user_gpg_keys WHERE id = ?")
    .bind(row.id)
    .run();
  auditUser(c, id, target.username, "user.gpg_key_removed", {
    fingerprint: row.fingerprint,
  });
  return c.json({ message: "Key removed" });
});

// ─── Email addresses ──────────────────────────────────────────────────────────

app.get("/:id/emails", async (c) => {
  const id = c.req.param("id");
  const [user, alternates] = await Promise.all([
    c.env.DB.prepare(
      "SELECT email, email_verified, email_verified_at FROM users WHERE id = ? AND kind = 'user'",
    )
      .bind(id)
      .first<{
        email: string;
        email_verified: number;
        email_verified_at: number | null;
      }>(),
    c.env.DB.prepare(
      `SELECT id, email, verified, verified_via, verified_at, created_at
         FROM user_emails WHERE user_id = ? ORDER BY created_at`,
    )
      .bind(id)
      .all<UserEmailRow>(),
  ]);
  if (!user) return c.json({ error: "User not found" }, 404);

  return c.json({
    primary: {
      email: user.email,
      verified: user.email_verified === 1,
      verified_at: user.email_verified_at,
    },
    emails: alternates.results.map((row) => ({
      ...row,
      verified: row.verified === 1,
    })),
  });
});

/** Mark an address verified without the round trip.
 *
 *  The address the account was registered with is `users.email`; the id
 *  `primary` addresses it, since it has no `user_emails` row of its own. */
app.post("/:id/emails/:emailId/verify", async (c) => {
  const id = c.req.param("id");
  const emailId = c.req.param("emailId");
  const target = await loadTarget(c.env.DB, id);
  if (!target) return c.json({ error: "User not found" }, 404);

  const now = Math.floor(Date.now() / 1000);
  if (emailId === "primary") {
    await c.env.DB.prepare(
      `UPDATE users SET email_verified = 1, email_verified_via = 'admin',
              email_verified_at = ?, email_verify_token = NULL,
              email_verify_code = NULL, updated_at = ? WHERE id = ?`,
    )
      .bind(now, now, id)
      .run();
    auditUser(c, id, target.username, "user.email_verified", {
      email: target.email,
      primary: true,
    });
    return c.json({ message: "Email marked as verified" });
  }

  const row = await c.env.DB.prepare(
    "SELECT id, email FROM user_emails WHERE id = ? AND user_id = ?",
  )
    .bind(emailId, id)
    .first<{ id: string; email: string }>();
  if (!row) return c.json({ error: "Email not found" }, 404);

  await c.env.DB.prepare(
    `UPDATE user_emails SET verified = 1, verified_via = 'admin',
            verified_at = ?, verify_token = NULL, verify_code = NULL
      WHERE id = ?`,
  )
    .bind(now, row.id)
    .run();
  auditUser(c, id, target.username, "user.email_verified", {
    email: row.email,
  });
  return c.json({ message: "Email marked as verified" });
});

/** Promote an alternate address to primary, demoting the current one.
 *
 *  Mirrors the swap the self-serve endpoint performs, minus its "must already
 *  be verified" gate — an admin who needs that can verify it here first, and
 *  refusing would just mean two calls instead of one for the case this exists
 *  to handle (an address typed wrong at registration). */
app.post("/:id/emails/:emailId/set-primary", async (c) => {
  const id = c.req.param("id");
  const target = await loadTarget(c.env.DB, id);
  if (!target) return c.json({ error: "User not found" }, 404);

  const row = await c.env.DB.prepare(
    "SELECT id, email, verified, verified_via, verified_at FROM user_emails WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("emailId"), id)
    .first<{
      id: string;
      email: string;
      verified: number;
      verified_via: string | null;
      verified_at: number | null;
    }>();
  if (!row) return c.json({ error: "Email not found" }, 404);

  const userRow = await c.env.DB.prepare(
    "SELECT email, email_verified, email_verified_via, email_verified_at FROM users WHERE id = ?",
  )
    .bind(id)
    .first<{
      email: string;
      email_verified: number;
      email_verified_via: string | null;
      email_verified_at: number | null;
    }>();
  if (!userRow) return c.json({ error: "User not found" }, 404);

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.batch([
    // Demote the old primary into the alternates list, carrying its
    // verification state but never its outstanding challenge tokens — those
    // are bound to a specific pending check against that address.
    c.env.DB.prepare(
      `INSERT INTO user_emails (id, user_id, email, verified, verify_token, verify_code, verified_via, verified_at, created_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
    ).bind(
      randomId(),
      id,
      userRow.email,
      userRow.email_verified,
      userRow.email_verified_via,
      userRow.email_verified_at,
      now,
    ),
    c.env.DB.prepare(
      `UPDATE users SET email = ?, email_verified = ?, email_verified_via = ?,
              email_verified_at = ?, email_verify_token = NULL,
              email_verify_code = NULL, updated_at = ? WHERE id = ?`,
    ).bind(
      row.email,
      row.verified,
      row.verified_via,
      row.verified_at,
      now,
      id,
    ),
    c.env.DB.prepare("DELETE FROM user_emails WHERE id = ?").bind(row.id),
  ]);

  auditUser(c, id, target.username, "user.primary_email_changed", {
    from: userRow.email,
    to: row.email,
  });
  return c.json({ message: "Primary email updated" });
});

app.delete("/:id/emails/:emailId", async (c) => {
  const id = c.req.param("id");
  const target = await loadTarget(c.env.DB, id);
  if (!target) return c.json({ error: "User not found" }, 404);

  const row = await c.env.DB.prepare(
    "SELECT id, email FROM user_emails WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("emailId"), id)
    .first<{ id: string; email: string }>();
  if (!row) return c.json({ error: "Email not found" }, 404);

  await c.env.DB.prepare("DELETE FROM user_emails WHERE id = ?")
    .bind(row.id)
    .run();
  auditUser(c, id, target.username, "user.email_removed", {
    email: row.email,
  });
  return c.json({ message: "Email removed" });
});

// ─── Domains ──────────────────────────────────────────────────────────────────

app.get("/:id/domains", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM domains WHERE user_id = ? AND team_id IS NULL ORDER BY created_at DESC",
  )
    .bind(c.req.param("id"))
    .all<DomainRow>();
  return c.json({
    domains: results.map((row) => ({ ...row, verified: row.verified === 1 })),
  });
});

app.delete("/:id/domains/:domainId", async (c) => {
  const id = c.req.param("id");
  const target = await loadTarget(c.env.DB, id);
  if (!target) return c.json({ error: "User not found" }, 404);

  const row = await c.env.DB.prepare(
    "SELECT id, domain FROM domains WHERE id = ? AND user_id = ? AND team_id IS NULL",
  )
    .bind(c.req.param("domainId"), id)
    .first<{ id: string; domain: string }>();
  if (!row) return c.json({ error: "Domain not found" }, 404);

  await c.env.DB.prepare("DELETE FROM domains WHERE id = ?")
    .bind(row.id)
    .run();
  auditUser(c, id, target.username, "user.domain_removed", {
    domain: row.domain,
  });
  return c.json({ message: "Domain removed" });
});

// ─── OAuth authorizations ─────────────────────────────────────────────────────

app.get("/:id/authorizations", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT oc.id, oc.client_id, oc.scopes, oc.granted_at,
            a.name AS app_name, a.icon_url
       FROM oauth_consents oc
       LEFT JOIN oauth_apps a ON a.client_id = oc.client_id
      WHERE oc.user_id = ? ORDER BY oc.granted_at DESC`,
  )
    .bind(c.req.param("id"))
    .all<{
      id: string;
      client_id: string;
      scopes: string;
      granted_at: number;
      app_name: string | null;
      icon_url: string | null;
    }>();

  return c.json({
    authorizations: await Promise.all(
      results.map(async (row) => ({
        ...row,
        scopes: row.scopes ? row.scopes.split(" ").filter(Boolean) : [],
        icon_url: await proxyImageUrl(c.env.APP_URL, c.env.DB, row.icon_url),
      })),
    ),
  });
});

/** Revoke a grant and everything issued under it. Leaving the tokens behind
 *  would revoke the *record* of the authorization and none of its effect. */
app.delete("/:id/authorizations/:consentId", async (c) => {
  const id = c.req.param("id");
  const target = await loadTarget(c.env.DB, id);
  if (!target) return c.json({ error: "User not found" }, 404);

  const row = await c.env.DB.prepare(
    "SELECT id, client_id FROM oauth_consents WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("consentId"), id)
    .first<{ id: string; client_id: string }>();
  if (!row) return c.json({ error: "Authorization not found" }, 404);

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM oauth_consents WHERE id = ?").bind(row.id),
    c.env.DB.prepare(
      "DELETE FROM oauth_tokens WHERE user_id = ? AND client_id = ?",
    ).bind(id, row.client_id),
    c.env.DB.prepare(
      "DELETE FROM oauth_codes WHERE user_id = ? AND client_id = ?",
    ).bind(id, row.client_id),
  ]);

  auditUser(c, id, target.username, "user.authorization_revoked", {
    client_id: row.client_id,
  });
  return c.json({ message: "Authorization revoked" });
});

// ─── Team memberships ─────────────────────────────────────────────────────────

/** Where this account sits across the instance. Read-only here; the team
 *  endpoints are where memberships are actually changed, and a site admin can
 *  reach every one of them. */
app.get("/:id/teams", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.avatar_url, tm.role, tm.joined_at
       FROM team_members tm JOIN teams t ON t.id = tm.team_id
      WHERE tm.user_id = ? ORDER BY tm.joined_at DESC`,
  )
    .bind(c.req.param("id"))
    .all<{
      id: string;
      name: string;
      avatar_url: string | null;
      role: string;
      joined_at: number;
    }>();

  return c.json({
    teams: await Promise.all(
      results.map(async (row) => ({
        ...row,
        avatar_url: await proxyImageUrl(c.env.APP_URL, c.env.DB, row.avatar_url),
      })),
    ),
  });
});

// ─── Impersonation guard rails ────────────────────────────────────────────────

/** Sign the account out everywhere. `admin.ts` already exposes this at
 *  `/users/:id/sessions`; kept out of here to avoid two routes for one thing.
 *
 *  What this file deliberately does NOT offer is signing in *as* someone.
 *  Every action above leaves a name in the audit log; a session minted for
 *  another account would launder the operator's actions into the user's own
 *  history, and no amount of logging at the point of issue fixes what the
 *  rest of the system then records. An operator who needs to see what a user
 *  sees has the read endpoints here and the database console. */

// ─── Lockdown ─────────────────────────────────────────────────────────────────

/** LOCKDOWN_USERS protects an account from deletion. It does not, and should
 *  not, protect it from the credential operations above — the point of the
 *  list is that the instance always retains a usable administrator, which is
 *  a reason to keep those working rather than block them. Surfaced so the UI
 *  can say why the delete button is missing. */
app.get("/:id/lockdown", async (c) => {
  const target = await loadTarget(c.env.DB, c.req.param("id"));
  if (!target) return c.json({ error: "User not found" }, 404);
  return c.json({ locked: isUserLocked(c.env, target.username) });
});

export default app;
