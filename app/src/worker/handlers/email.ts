// Cloudflare Email Worker handler — receives inbound emails for email verification

import { hashLookupCandidate } from "../lib/secretCrypto";

export async function handleEmailWorker(
  message: EmailMessage & { setReject(reason: string): void },
  env: Env,
): Promise<void> {
  const to = message.to.toLowerCase();

  // Extract code from verify-<code>@domain
  const match = to.match(/^verify-([a-f0-9]+)@/);
  if (!match) {
    message.setReject("Unknown recipient");
    return;
  }

  const code = match[1];
  const senderEmail = message.from.toLowerCase();

  // Check if this is an admin test email
  const testKey = `email-receive-test:${code}`;
  const testVal = await env.KV_CACHE.get(testKey);
  if (testVal) {
    await env.KV_CACHE.delete(testKey);
    console.log(`[email-receive-test] Success — received from ${senderEmail}`);
    return;
  }

  // Look up the user who owns this verify code. Try plaintext (legacy)
  // and the keyed hash so accounts created before SECRETS_KEY was wired
  // up keep working until the admin migrate sweep runs.
  const codeLookup = await hashLookupCandidate(env, code);
  if (!codeLookup) {
    message.setReject("Invalid verification code");
    return;
  }
  const user = await env.DB.prepare(
    "SELECT id, email FROM users WHERE (email_verify_code = ? OR email_verify_code = ?) AND email_verified = 0",
  )
    .bind(code, codeLookup)
    .first<{ id: string; email: string }>();

  if (!user) {
    // Also check alternate emails. The sender MUST match the address being
    // verified — otherwise anyone who can deliver to verify-<code>@<host>
    // (i.e. the entire internet) flips the row to verified just by
    // knowing the code. The matching code lives in user_emails.email so
    // we look it up case-insensitively.
    const altEmail = await env.DB.prepare(
      "SELECT id, user_id FROM user_emails WHERE (verify_code = ? OR verify_code = ?) AND LOWER(email) = ? AND verified = 0",
    )
      .bind(code, codeLookup, senderEmail)
      .first<{ id: string; user_id: string }>();
    if (altEmail) {
      await env.DB.prepare(
        "UPDATE user_emails SET verified = 1, verify_code = NULL, verified_at = ? WHERE id = ?",
      )
        .bind(Math.floor(Date.now() / 1000), altEmail.id)
        .run();
      return;
    }
    message.setReject("Invalid verification code");
    return;
  }

  // The sender must match the user's registered email or an alternate
  const emailMatches =
    user.email.toLowerCase() === senderEmail ||
    !!(await env.DB.prepare(
      "SELECT id FROM user_emails WHERE user_id = ? AND email = ?",
    )
      .bind(user.id, senderEmail)
      .first());

  if (!emailMatches) {
    message.setReject("Sender does not match registered email");
    return;
  }

  await env.DB.prepare(
    "UPDATE users SET email_verified = 1, email_verify_code = NULL, email_verify_token = NULL, updated_at = ? WHERE id = ?",
  )
    .bind(Math.floor(Date.now() / 1000), user.id)
    .run();
}
