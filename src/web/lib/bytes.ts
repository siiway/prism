// Human-readable sizes ("12 kB", "3.4 MB") in the browser's locale, in
// binary steps since that's what the limits are set in.

const UNITS = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;

export function formatBytes(bytes: number): string {
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < UNITS.length - 1) {
    value /= 1024;
    i++;
  }
  return new Intl.NumberFormat(undefined, {
    style: "unit",
    unit: UNITS[i],
    unitDisplay: "short",
    maximumFractionDigits: i === 0 ? 0 : 1,
  }).format(value);
}
