// Default icons for the built-in OAuth providers, keyed by provider TYPE (not
// slug). A source's own `icon_url` overrides these when set.

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

// Providers whose built-in default icon is a near-pure-black silhouette
// and so disappears against the dark-mode background. /api/site flags
// these so the frontend can invert them via CSS in dark mode. Only
// applies when we're serving the built-in default — per-source override
// icons are left untouched (we don't know their palette).
const MONOCHROME_DARK_PROVIDERS = new Set(["x", "github"]);

export function isMonochromeDarkProvider(provider: string): boolean {
  return MONOCHROME_DARK_PROVIDERS.has(provider);
}

/** Pick the icon URL for a provider entry on the login / connections page:
 *  null when the admin turned the icon off (`show_icon = 0`), else the
 *  per-source override, else the bundled default, else null. */
export function resolveProviderIconUrl(p: {
  provider: string;
  icon_url?: string | null;
  show_icon?: number | null;
}): string | null {
  if (p.show_icon === 0) return null;
  return p.icon_url ?? PROVIDER_ICON_URLS[p.provider] ?? null;
}
