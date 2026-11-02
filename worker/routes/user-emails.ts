// Alternate email addresses: /api/user/me/emails — adding, verifying,
// promoting and removing the addresses on an account.

import { isSyntheticEmail } from "../lib/userCapabilities";
import { Hono } from "hono";
import { randomId, randomBase64url } from "../lib/crypto";
import { getConfig } from "../lib/config";
import { hashSecret } from "../lib/secretCrypto";
import {
  emailConfigFromSite,
  sendEmail,
  verifyEmailTemplate,
} from "../lib/email";
import type { UserEmailRow, Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

// ─── Alternate Emails ─────────────────────────────────────────────────────────

// GET /api/user/me/emails — list primary + alternates
app.get("/me/emails", async (c) => {
  const user = c.get("user");
  const row = await c.env.DB.prepare(
    "SELECT email, email_verified FROM users WHERE id = ?",
  )
    .bind(user.id)
    .first<{ email: string; email_verified: number }>();
  if (!row) return c.json({ error: "user_not_found" }, 404);

  const { results } = await c.env.DB.prepare(
    "SELECT id, email, verified, verified_via, created_at FROM user_emails WHERE user_id = ? ORDER BY created_at ASC",
  )
    .bind(user.id)
    .all<
      Pick<
        UserEmailRow,
        "id" | "email" | "verified" | "verified_via" | "created_at"
      >
    >();

  return c.json({
    primary: { email: row.email, verified: row.email_verified === 1 },
    emails: results.map((r) => ({
      ...r,
      verified: r.verified === 1,
    })),
  });
});

// POST /api/user/me/emails — add alternate email
app.post("/me/emails", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ email: string }>();

  const email = (body.email ?? "").toLowerCase().trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return c.json({ error: "email_invalid" }, 400);

  // Check uniqueness against primary emails
  const existing = await c.env.DB.prepare(
    "SELECT id FROM users WHERE email = ?",
  )
    .bind(email)
    .first();
  if (existing) return c.json({ error: "email_taken" }, 409);

  // Check uniqueness against other alternate emails
  const altExisting = await c.env.DB.prepare(
    "SELECT id FROM user_emails WHERE email = ?",
  )
    .bind(email)
    .first();
  if (altExisting) return c.json({ error: "email_taken" }, 409);

  const now = Math.floor(Date.now() / 1000);
  const id = randomId();
  const verifyToken = randomBase64url(24);
  const storedVerifyToken = await hashSecret(c.env, verifyToken);

  await c.env.DB.prepare(
    "INSERT INTO user_emails (id, user_id, email, verified, verify_token, created_at) VALUES (?, ?, ?, 0, ?, ?)",
  )
    .bind(id, user.id, email, storedVerifyToken, now)
    .run();

  // Send verification email if provider is configured
  const config = await getConfig(c.env.DB);
  if (config.email_provider !== "none") {
    const verifyUrl = `${c.env.APP_URL}/api/auth/verify-email?token=${verifyToken}&alt=1`;
    const tmpl = verifyEmailTemplate(config.site_name, verifyUrl);
    c.executionCtx.waitUntil(
      sendEmail(
        c.env,
        {
          to: email,
          subject: `Verify your email — ${config.site_name}`,
          ...tmpl,
        },
        emailConfigFromSite(config),
      ).catch(() => {}),
    );
  }

  return c.json({ id, email, verified: false, created_at: now }, 201);
});

// POST /api/user/me/emails/:id/resend — resend verification for alternate email
app.post("/me/emails/:id/resend", async (c) => {
  const user = c.get("user");
  const emailRow = await c.env.DB.prepare(
    "SELECT id, email, verified FROM user_emails WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), user.id)
    .first<Pick<UserEmailRow, "id" | "email" | "verified">>();
  if (!emailRow) return c.json({ error: "email_not_found" }, 404);
  if (emailRow.verified) return c.json({ error: "already_verified" }, 400);

  const config = await getConfig(c.env.DB);
  if (config.email_provider === "none")
    return c.json({ error: "email_not_configured" }, 503);

  const verifyToken = randomBase64url(24);
  const storedVerifyToken = await hashSecret(c.env, verifyToken);
  await c.env.DB.prepare("UPDATE user_emails SET verify_token = ? WHERE id = ?")
    .bind(storedVerifyToken, emailRow.id)
    .run();

  const verifyUrl = `${c.env.APP_URL}/api/auth/verify-email?token=${verifyToken}&alt=1`;
  const tmpl = verifyEmailTemplate(config.site_name, verifyUrl);
  await sendEmail(
    c.env,
    {
      to: emailRow.email,
      subject: `Verify your email — ${config.site_name}`,
      ...tmpl,
    },
    emailConfigFromSite(config),
  );

  return c.json({ ok: true });
});

// POST /api/user/me/emails/:id/set-primary — make an alternate email the primary
app.post("/me/emails/:id/set-primary", async (c) => {
  const user = c.get("user");
  const emailRow = await c.env.DB.prepare(
    "SELECT id, email, verified, verified_via, verified_at FROM user_emails WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), user.id)
    .first<
      Pick<
        UserEmailRow,
        "id" | "email" | "verified" | "verified_via" | "verified_at"
      >
    >();
  if (!emailRow) return c.json({ error: "email_not_found" }, 404);
  if (!emailRow.verified)
    return c.json({ error: "email_unverified_primary" }, 400);

  const userRow = await c.env.DB.prepare(
    "SELECT email, email_verified, email_verified_via, email_verified_at, email_verify_token, email_verify_code FROM users WHERE id = ?",
  )
    .bind(user.id)
    .first<{
      email: string;
      email_verified: number;
      email_verified_via: string | null;
      email_verified_at: number | null;
      email_verify_token: string | null;
      email_verify_code: string | null;
    }>();
  if (!userRow) return c.json({ error: "user_not_found" }, 404);

  const now = Math.floor(Date.now() / 1000);

  // Swap: move current primary to user_emails, promote alternate to users.email
  const oldPrimaryId = randomId();
  // A synthesised placeholder is not an address anyone can reach, so it is
  // dropped rather than demoted — keeping it would leave an unreachable
  // `@users.invalid` row sitting in the account's email list forever.
  const demoteOldPrimary = !isSyntheticEmail(userRow.email);
  await c.env.DB.batch([
    // Insert old primary as alternate. Carry the verification *state* but
    // explicitly drop the verify_token / verify_code — those are tied to a
    // specific outstanding inbound-mail challenge against the old primary
    // address; reusing them on a new alternate row would let a user replay
    // a code they already learned to flip a different address to verified.
    ...(demoteOldPrimary
      ? [
          c.env.DB.prepare(
            "INSERT INTO user_emails (id, user_id, email, verified, verify_token, verify_code, verified_via, verified_at, created_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)",
          ).bind(
            oldPrimaryId,
            user.id,
            userRow.email,
            userRow.email_verified,
            userRow.email_verified_via,
            userRow.email_verified_at,
            now,
          ),
        ]
      : []),
    // Update users table with new primary
    c.env.DB.prepare(
      "UPDATE users SET email = ?, email_verified = ?, email_verified_via = ?, email_verified_at = ?, email_verify_token = NULL, email_verify_code = NULL, updated_at = ? WHERE id = ?",
    ).bind(
      emailRow.email,
      emailRow.verified,
      emailRow.verified_via,
      emailRow.verified_at,
      now,
      user.id,
    ),
    // Delete the promoted alternate
    c.env.DB.prepare("DELETE FROM user_emails WHERE id = ?").bind(emailRow.id),
  ]);

  return c.json({ ok: true });
});

export default app;
