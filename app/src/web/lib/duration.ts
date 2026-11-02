// Parse human-friendly durations like "60min", "1 hour", "30 days" into
// integer minutes or days, depending on the field's storage unit.
//
// Accepted unit aliases (case-insensitive, optional whitespace, optional
// trailing 's'):
//   s, sec, second
//   m, min, minute
//   h, hr, hour
//   d, day
//   w, wk, week
//   mo, month        (treated as 30 days for refresh tokens)
//   y, yr, year      (treated as 365 days for refresh tokens)
//
// If no unit is provided, the field's `defaultUnit` is assumed — so the
// existing UI hints ("(minutes)", "(days)") still apply for bare numbers.

export type DurationUnit = "minutes" | "days";

const UNIT_ALIASES: Record<string, "s" | "m" | "h" | "d" | "w" | "mo" | "y"> = {
  s: "s",
  sec: "s",
  secs: "s",
  second: "s",
  seconds: "s",
  m: "m",
  min: "m",
  mins: "m",
  minute: "m",
  minutes: "m",
  h: "h",
  hr: "h",
  hrs: "h",
  hour: "h",
  hours: "h",
  d: "d",
  day: "d",
  days: "d",
  w: "w",
  wk: "w",
  wks: "w",
  week: "w",
  weeks: "w",
  mo: "mo",
  mon: "mo",
  month: "mo",
  months: "mo",
  y: "y",
  yr: "y",
  yrs: "y",
  year: "y",
  years: "y",
};

/**
 * Parse a duration string. Returns the integer count in the field's
 * `defaultUnit`, or `null` for an empty string ("use the site default"),
 * or a `string` error code for an unparseable input.
 */
export type ParseResult =
  | { kind: "ok"; value: number }
  | { kind: "blank" }
  | { kind: "error"; reason: "format" | "non_positive" | "unknown_unit" };

export function parseDuration(
  input: string,
  defaultUnit: DurationUnit,
): ParseResult {
  const trimmed = input.trim();
  if (!trimmed) return { kind: "blank" };

  // Strict: a number, optional whitespace, optional unit. Reject anything
  // else (commas, multiple numbers, units without a number, etc.).
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([a-z]*)$/i);
  if (!match) return { kind: "error", reason: "format" };

  const num = parseFloat(match[1]);
  if (!Number.isFinite(num) || num <= 0) {
    return { kind: "error", reason: "non_positive" };
  }

  const unitRaw = match[2].toLowerCase();
  const canonical = unitRaw === "" ? null : UNIT_ALIASES[unitRaw];
  if (unitRaw !== "" && !canonical) {
    return { kind: "error", reason: "unknown_unit" };
  }

  // Convert to minutes first, then down to the field's unit.
  let totalMinutes: number;
  switch (canonical) {
    case "s":
      totalMinutes = num / 60;
      break;
    case "m":
      totalMinutes = num;
      break;
    case "h":
      totalMinutes = num * 60;
      break;
    case "d":
      totalMinutes = num * 60 * 24;
      break;
    case "w":
      totalMinutes = num * 60 * 24 * 7;
      break;
    case "mo":
      totalMinutes = num * 60 * 24 * 30;
      break;
    case "y":
      totalMinutes = num * 60 * 24 * 365;
      break;
    case null:
      // No unit — interpret in the field's default unit.
      totalMinutes = defaultUnit === "minutes" ? num : num * 60 * 24;
      break;
    default: {
      // Exhaustiveness check.
      const _exhaustive: never = canonical;
      void _exhaustive;
      totalMinutes = num;
    }
  }

  const value =
    defaultUnit === "minutes"
      ? Math.round(totalMinutes)
      : Math.round(totalMinutes / (60 * 24));

  // Round-down for very small inputs (e.g. "30s" in a days-unit field) but
  // never let a positive duration round to 0 — that would mint zero-TTL
  // tokens. Clamp to 1 of the field's unit.
  if (value < 1) return { kind: "ok", value: 1 };
  return { kind: "ok", value };
}

/**
 * Format an integer count back into a string with the unit suffix, suitable
 * for display in an input field after the user blurs.
 */
export function formatDuration(
  value: number,
  defaultUnit: DurationUnit,
): string {
  return `${value} ${defaultUnit === "minutes" ? "min" : "days"}`;
}
