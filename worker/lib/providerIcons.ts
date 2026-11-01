// Server-side mirror of src/lib/providerIcons.ts. Duplicated (not shared)
// because worker/ and src/ have separate tsconfig include trees.
//
// Kept here so /api/site can pre-register each enabled source's icon
// mapping for anonymous viewers (the public /proxy/image/register endpoint
// requires auth, which the Login page doesn't have yet).

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

/** Same fallback chain as the client helper:
 *  show_icon=0 → null; per-source override → that; global default → that;
 *  otherwise null. */
export function resolveProviderIconUrl(p: {
  provider: string;
  icon_url: string | null;
  show_icon: number;
}): string | null {
  if (p.show_icon === 0) return null;
  return p.icon_url ?? PROVIDER_ICON_URLS[p.provider] ?? null;
}
