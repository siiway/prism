// Global defaults for built-in OAuth providers. Per-source `icon_url` /
// (future) per-source color in `oauth_sources` overrides these when set.

export const PROVIDER_COLORS: Record<string, string> = {
  github: "#24292e",
  google: "#4285f4",
  microsoft: "#0078d4",
  discord: "#5865f2",
  telegram: "#2AABEE",
  x: "#000000",
  cloudflare: "#F38020",
};

export const PROVIDER_ICON_URLS: Record<string, string> = {
  github: "https://cdn.simpleicons.org/github/000000",
  google: "https://cdn.simpleicons.org/google",
  microsoft: "https://cdn.simpleicons.org/microsoft",
  discord: "https://cdn.simpleicons.org/discord",
  telegram: "https://cdn.simpleicons.org/telegram",
  x: "https://cdn.simpleicons.org/x/000000",
  cloudflare: "https://cdn.simpleicons.org/cloudflare",
};

/** Pick the icon URL for a provider entry on the login / connections page.
 *  Honours the per-source override first, then falls back to the bundled
 *  global default keyed by the provider TYPE (not slug). Returns null when
 *  the source has show_icon turned off — the admin opted into a text-only
 *  button. */
export function resolveProviderIconUrl(p: {
  provider: string;
  icon_url?: string | null;
  show_icon?: number | null;
}): string | null {
  if (p.show_icon === 0) return null;
  return p.icon_url ?? PROVIDER_ICON_URLS[p.provider] ?? null;
}
