export type RelativeExpiryUnit = "hours" | "days" | "months" | "years";

export function relativeInviteExpiry(
  now: Date,
  value: number,
  unit: RelativeExpiryUnit,
): Date | null {
  if (!Number.isSafeInteger(value) || value < 1) return null;
  const result = new Date(now);
  if (unit === "hours") result.setHours(result.getHours() + value);
  if (unit === "days") result.setDate(result.getDate() + value);
  if (unit === "months") result.setMonth(result.getMonth() + value);
  if (unit === "years") result.setFullYear(result.getFullYear() + value);
  return Number.isNaN(result.getTime()) ? null : result;
}

export function toLocalDateTimeInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19);
}

export function absoluteInviteExpiry(value: string, now: Date): number | null {
  const millis = new Date(value).getTime();
  if (!Number.isFinite(millis) || millis <= now.getTime()) return null;
  return Math.floor(millis / 1000);
}
