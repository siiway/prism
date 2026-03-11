// Cron task: poll IMAP inbox for inbound verification emails.
// Runs alongside the domain reverification cron.

import { getConfig } from "../lib/config";
import { pollVerifyEmails } from "../lib/imap";

export async function runImapPoll(
  db: D1Database,
  kv: KVNamespace,
  appUrl: string,
): Promise<void> {
  const config = await getConfig(db);

  if (config.email_receive_provider !== "imap") return;
  if (!config.imap_host || !config.imap_user || !config.imap_password) return;

  const receiveHost = config.email_receive_host || new URL(appUrl).hostname;

  const messages = await pollVerifyEmails(
    {
      host: config.imap_host,
      port: config.imap_port,
      secure: config.imap_secure,
      user: config.imap_user,
      password: config.imap_password,
    },
    receiveHost,
  );

  for (const msg of messages) {
    // Extract code from to address: verify-<code>@host
    const match = msg.to.match(/^verify-([a-f0-9]+)@/);
    if (!match) continue;

    const code = match[1];
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
