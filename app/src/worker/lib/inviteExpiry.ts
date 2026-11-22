import type { CodedError } from "./apiError";

export const MAX_INVITE_EXPIRY_SECONDS = 10 * 365 * 24 * 60 * 60;

export function parseInviteExpiry(
  expiresAt: unknown,
  now: number,
): { ok: true; expiresAt: number } | ({ ok: false } & CodedError) {
  if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt))
    return {
      ok: false,
      error: "field_invalid",
      params: { field: "expires_at" },
    };
  if (expiresAt <= now) return { ok: false, error: "invite_expiry_past" };
  if (expiresAt - now > MAX_INVITE_EXPIRY_SECONDS)
    return { ok: false, error: "invite_expiry_too_far" };
  return { ok: true, expiresAt };
}

/** `expires_in_days` from an invite request. Left out, the invite doesn't
 *  expire; otherwise it must be a whole number of days, from one to the
 *  same ten-year cap. 0 used to mean "never" by accident, and a negative
 *  number made an invite that had already expired. */
export function inviteExpiryFromDays(
  days: unknown,
  now: number,
): { ok: true; expiresAt: number | null } | ({ ok: false } & CodedError) {
  if (days === undefined || days === null) return { ok: true, expiresAt: null };
  const max = MAX_INVITE_EXPIRY_SECONDS / 86400;
  if (
    typeof days !== "number" ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > max
  )
    return {
      ok: false,
      error: "field_int_range",
      params: { field: "expires_in_days", min: 1, max },
    };
  return { ok: true, expiresAt: now + days * 86400 };
}
