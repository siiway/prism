export const MAX_INVITE_EXPIRY_SECONDS = 10 * 365 * 24 * 60 * 60;

export function parseInviteExpiry(
  expiresAt: unknown,
  now: number,
): { ok: true; expiresAt: number } | { ok: false; error: string } {
  if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt))
    return { ok: false, error: "expires_at must be a Unix timestamp" };
  if (expiresAt <= now)
    return { ok: false, error: "Invite expiry must be in the future" };
  if (expiresAt - now > MAX_INVITE_EXPIRY_SECONDS)
    return { ok: false, error: "Invite expiry cannot exceed 10 years" };
  return { ok: true, expiresAt };
}
