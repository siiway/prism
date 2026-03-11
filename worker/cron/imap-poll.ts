// Cron task: poll IMAP inbox for inbound verification emails.
// Users send an email with their verification code as the subject
// to the IMAP mailbox address (e.g. receive@prism.example.com).

import { getConfig } from "../lib/config";
import { pollVerifyEmails } from "../lib/imap";

export async function runImapPoll(
  db: D1Database,
  kv: KVNamespace,
): Promise<void> {
  const config = await getConfig(db);

  if (config.email_receive_provider !== "imap") return;
  if (!config.imap_host || !config.imap_user || !config.imap_password) return;

  const messages = await pollVerifyEmails({
    host: config.imap_host,
    port: config.imap_port,
    secure: config.imap_secure,
    user: config.imap_user,
    password: config.imap_password,
  });

  for (const msg of messages) {
    // Subject should be exactly the hex verification code
    const code = msg.subject.trim().toLowerCase();
    if (!/^[a-f0-9]+$/.test(code)) continue;

    const senderEmail = msg.from.toLowerCase();

    // Check admin test emails first
    const testKey = `email-receive-test:${code}`;
    const testVal = await kv.get(testKey);
    if (testVal) {
      await kv.delete(testKey);
      console.log(`[imap-poll] Test email received from ${senderEmail}`);
      continue;
    }

    // Look up user by verify code
    const user = await db
      .prepare(
        "SELECT id, email FROM users WHERE email_verify_code = ? AND email_verified = 0",
      )
      .bind(code)
      .first<{ id: string; email: string }>();

    if (!user) continue;

    // Sender must match registered email
    if (user.email.toLowerCase() !== senderEmail) continue;

    // Mark email as verified
    await db
      .prepare(
        "UPDATE users SET email_verified = 1, email_verify_code = NULL, email_verify_token = NULL, updated_at = ? WHERE id = ?",
      )
      .bind(Math.floor(Date.now() / 1000), user.id)
      .run();

    console.log(`[imap-poll] Verified email for user ${user.id}`);
  }
}
