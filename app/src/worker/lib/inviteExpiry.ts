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
