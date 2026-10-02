export const INVITE_EXPIRY_UNITS = [
  "hours",
  "days",
  "months",
  "years",
] as const;

export type InviteExpiryUnit = (typeof INVITE_EXPIRY_UNITS)[number];

const SECONDS_PER_UNIT: Record<InviteExpiryUnit, number> = {
  hours: 60 * 60,
  days: 24 * 60 * 60,
  months: 30 * 24 * 60 * 60,
  years: 365 * 24 * 60 * 60,
};

export const MAX_INVITE_EXPIRY_SECONDS = 10 * 365 * 24 * 60 * 60;

export function parseInviteExpiry(
  body: {
    expires_in_value?: unknown;
    expires_in_unit?: unknown;
    ttl_hours?: unknown;
    expires_in_hours?: unknown;
  },
  now: number,
):
  | { ok: true; expiresAt: number; value: number; unit: InviteExpiryUnit }
  | { ok: false; error: string } {
  const hasValueUnit =
    body.expires_in_value !== undefined || body.expires_in_unit !== undefined;
  let value: unknown;
  let unit: unknown;

  if (hasValueUnit) {
    value = body.expires_in_value;
    unit = body.expires_in_unit;
  } else {
    value = body.ttl_hours ?? body.expires_in_hours ?? 72;
    unit = "hours";
  }

  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    return { ok: false, error: "Expiry value must be a positive integer" };
  if (!INVITE_EXPIRY_UNITS.includes(unit as InviteExpiryUnit))
    return {
      ok: false,
      error: "Expiry unit must be hours, days, months, or years",
    };

  const typedUnit = unit as InviteExpiryUnit;
  const seconds = value * SECONDS_PER_UNIT[typedUnit];
  if (!Number.isSafeInteger(seconds) || seconds > MAX_INVITE_EXPIRY_SECONDS)
    return { ok: false, error: "Invite expiry cannot exceed 10 years" };

  return { ok: true, expiresAt: now + seconds, value, unit: typedUnit };
}
