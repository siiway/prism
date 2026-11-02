export interface HsvColor {
  h: number;
  s: number;
  v: number;
}

const HEX_COLOR = /^#?([0-9a-f]{6})$/i;
const SHORT_HEX_COLOR = /^#?([0-9a-f]{3})$/i;

export function normalizeHexColor(value: string): string | null {
  const input = value.trim();
  const full = HEX_COLOR.exec(input);
  if (full) return `#${full[1].toLowerCase()}`;

  const short = SHORT_HEX_COLOR.exec(input);
  if (!short) return null;

  return `#${[...short[1]].map((digit) => digit.repeat(2)).join("")}`.toLowerCase();
}

export function hexToHsv(value: string): HsvColor | null {
  const normalized = normalizeHexColor(value);
  if (!normalized) return null;

  const red = Number.parseInt(normalized.slice(1, 3), 16) / 255;
  const green = Number.parseInt(normalized.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(normalized.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta !== 0) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }

  if (hue < 0) hue += 360;
  return { h: hue, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToHex({ h, s, v }: HsvColor): string {
  const hue = ((h % 360) + 360) % 360;
  const saturation = Math.min(1, Math.max(0, s));
  const value = Math.min(1, Math.max(0, v));
  const chroma = value * saturation;
  const section = hue / 60;
  const secondary = chroma * (1 - Math.abs((section % 2) - 1));
  const offset = value - chroma;
  let rgb: [number, number, number];

  if (section < 1) rgb = [chroma, secondary, 0];
  else if (section < 2) rgb = [secondary, chroma, 0];
  else if (section < 3) rgb = [0, chroma, secondary];
  else if (section < 4) rgb = [0, secondary, chroma];
  else if (section < 5) rgb = [secondary, 0, chroma];
  else rgb = [chroma, 0, secondary];

  return `#${rgb
    .map((channel) =>
      Math.round((channel + offset) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
