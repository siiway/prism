// Cron task: poll IMAP inbox for inbound verification emails.
// Users send an email with their verification code as the subject
// to the IMAP mailbox address (e.g. receive@prism.example.com).

import { emailOwnedElsewhere } from "../lib/accountEmails";
import { getConfig } from "../lib/config";
import { pollVerifyEmails } from "../lib/imap";
import { decryptSecret, hashLookupCandidate } from "../lib/secretCrypto";

export async function runImapPoll(env: Env, kv: KVNamespace): Promise<void> {
  const db = env.DB;
  const config = await getConfig(db);

  if (config.email_receive_provider !== "imap") return;
  if (!config.imap_host || !config.imap_user || !config.imap_password) return;

  const password = (await decryptSecret(env, config.imap_password)) ?? "";
  if (!password) return;

  const messages = await pollVerifyEmails({
    host: config.imap_host,
    port: config.imap_port,
    secure: config.imap_secure,
    user: config.imap_user,
    password,
  });

  // The messages are already gone from the mailbox, so one that fails must
  // not stop the rest from being read.
  for (const msg of messages) {
    try {
      await verifyFromMessage(env, kv, msg);
    } catch (err) {
      console.error("[imap-poll] Failed to process a message", err);
    }
  }
}

async function verifyFromMessage(
  env: Env,
  kv: KVNamespace,
  msg: { from: string; subject: string },
): Promise<void> {
  const db = env.DB;
  // Subject should be exactly the hex verification code
  const code = msg.subject.trim().toLowerCase();
  if (!/^[a-f0-9]+$/.test(code)) return;

  const senderEmail = msg.from.toLowerCase();

  // Check admin test emails first
  const testKey = `email-receive-test:${code}`;
  const testVal = await kv.get(testKey);
  if (testVal) {
    await kv.delete(testKey);
    console.log(`[imap-poll] Test email received from ${senderEmail}`);
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  // Look up user by verify code (primary email). Try both plaintext
  // (legacy) and the keyed hash so users created before SECRETS_KEY
  // was wired up keep verifying.
  const codeLookup = await hashLookupCandidate(env, code);
  if (!codeLookup) return;
  const user = await db
    .prepare(
      "SELECT id, email FROM users WHERE (email_verify_code = ? OR email_verify_code = ?) AND email_verified = 0",
    )
    .bind(code, codeLookup)
    .first<{ id: string; email: string }>();

  if (user) {
    // Sender must match registered email or an alternate
    const emailMatches =
      user.email.toLowerCase() === senderEmail ||
      !!(await db
        .prepare("SELECT id FROM user_emails WHERE user_id = ? AND email = ?")
        .bind(user.id, senderEmail)
        .first());
    if (!emailMatches) return;
    // Another account may have proved it owns the address meanwhile.
    if (await emailOwnedElsewhere(db, user.email, user.id)) {
      console.log(`[imap-poll] Email for user ${user.id} is taken`);
      return;
    }

    await db
      .prepare(
        "UPDATE users SET email_verified = 1, email_verify_code = NULL, email_verify_token = NULL, updated_at = ? WHERE id = ?",
      )
      .bind(now, user.id)
      .run();
    console.log(`[imap-poll] Verified email for user ${user.id}`);
    return;
  }

  // Check alternate emails by verify_code. Sender MUST match the
  // address being verified — see handlers/email.ts for the rationale.
  const altEmail = await db
    .prepare(
      "SELECT id, user_id FROM user_emails WHERE (verify_code = ? OR verify_code = ?) AND LOWER(email) = ? AND verified = 0",
    )
    .bind(code, codeLookup, senderEmail)
    .first<{ id: string; user_id: string }>();

  if (altEmail) {
    // Someone else may have signed up with it since it was added.
    if (await emailOwnedElsewhere(db, senderEmail, altEmail.user_id)) {
      console.log(`[imap-poll] Alternate email ${altEmail.id} is taken`);
      return;
    }
    await db
      .prepare(
        "UPDATE user_emails SET verified = 1, verify_code = NULL, verified_at = ? WHERE id = ?",
      )
      .bind(now, altEmail.id)
      .run();
    console.log(`[imap-poll] Verified alternate email ${altEmail.id}`);
  }
}
