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

// Shipped with the app (public/provider-icons, from Simple Icons, CC0) so
// the sign-in page never waits on, or breaks with, a third-party CDN.
export const PROVIDER_ICON_URLS: Record<string, string> = {
  github: "/provider-icons/github.svg",
  google: "/provider-icons/google.svg",
  microsoft: "/provider-icons/microsoft.svg",
  discord: "/provider-icons/discord.svg",
  telegram: "/provider-icons/telegram.svg",
  x: "/provider-icons/x.svg",
  cloudflare: "/provider-icons/cloudflare.svg",
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
