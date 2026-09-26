// Age thresholds Prism asks AgeKey to answer, shared by the Worker and the UI.
//
// A result is a boolean per threshold ("is this person at least 18?"), never
// a date of birth. A passing higher threshold implies every lower one: someone
// who is 18+ is also 13+ and 16+, even if that lower key was not stored.

export const AGE_THRESHOLDS = [13, 16, 18, 21] as const;

export type AgeThreshold = (typeof AGE_THRESHOLDS)[number];

const THRESHOLD_SET = new Set<number>(AGE_THRESHOLDS);

/** Team and site-floor values. `0` means the age requirement is off. */
export function isMinAgeSetting(value: number): value is 0 | AgeThreshold {
  return value === 0 || THRESHOLD_SET.has(value);
}

/** Coerce a stored value. Anything outside the allowed set is off, so a
 *  corrupt row cannot invent a threshold nobody can satisfy. */
export function readMinAge(value: number | null | undefined): number {
  return typeof value === "number" && isMinAgeSetting(value) ? value : 0;
}

/** Boolean map for a single minimum age. Every threshold at or below `minAge`
 *  passes; every higher one fails. `0` is all false. */
export function thresholdsForMinAge(minAge: number): Record<string, boolean> {
  const age = readMinAge(minAge);
  const out: Record<string, boolean> = {};
  for (const threshold of AGE_THRESHOLDS)
    out[String(threshold)] = age > 0 && threshold <= age;
  return out;
}

/** Highest standard threshold the map satisfies, or 0 when none do. */
export function highestSatisfiedAge(
  thresholds: Record<string, boolean> | null | undefined,
): number {
  let best = 0;
  for (const threshold of AGE_THRESHOLDS) {
    if (meetsMinAge(thresholds, threshold)) best = threshold;
  }
  return best;
}

/** True when `thresholds` contains a passing result at or above `minAge`.
 *  `minAge <= 0` is always satisfied. */
export function meetsMinAge(
  thresholds: Record<string, boolean> | null | undefined,
  minAge: number,
): boolean {
  if (minAge <= 0) return true;
  if (!thresholds) return false;
  for (const [key, ok] of Object.entries(thresholds)) {
    if (ok !== true) continue;
    const n = Number(key);
    if (Number.isInteger(n) && n >= minAge) return true;
  }
  return false;
}
