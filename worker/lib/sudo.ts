// Sudo mode: after a successful 2FA, the user can opt into a short grace
// window during which subsequent challenges from the same app on the same
// session bypass the TOTP/passkey check. The grant is bound to the tuple
// (user_id, session_id, client_id) so it doesn't leak across apps, sessions,
// or users.
//
// Prism itself uses the synthetic client id `PRISM_INTERNAL_CLIENT_ID` to
// gate first-party privileged actions (e.g. "Reset everything") through the
// same primitive without needing a real oauth_apps row.

export const PRISM_INTERNAL_CLIENT_ID = "__prism_internal__";

export function sudoKvKey(
  userId: string,
  sessionId: string,
  clientId: string,
): string {
  return `2fa-sudo:${userId}:${sessionId}:${clientId}`;
}

export async function isSudoActive(
  kv: KVNamespace,
  userId: string,
  sessionId: string,
  clientId: string,
): Promise<boolean> {
  const v = await kv.get(sudoKvKey(userId, sessionId, clientId));
  return v !== null;
}

export async function grantSudo(
  kv: KVNamespace,
  userId: string,
  sessionId: string,
  clientId: string,
  ttlMinutes: number,
): Promise<void> {
  if (ttlMinutes <= 0) return;
  // KV requires expirationTtl >= 60s; treat anything below as 60s.
  const ttl = Math.max(60, Math.floor(ttlMinutes * 60));
  await kv.put(sudoKvKey(userId, sessionId, clientId), "1", {
    expirationTtl: ttl,
  });
}

export async function revokeSudo(
  kv: KVNamespace,
  userId: string,
  sessionId: string,
  clientId: string,
): Promise<void> {
  await kv.delete(sudoKvKey(userId, sessionId, clientId));
}
