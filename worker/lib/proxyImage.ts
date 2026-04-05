/**
 * Rewrite an image URL to route through the sanitizing reverse proxy.
 * Local assets (starting with "/") are returned as-is.
 * Returns null when the input is null/undefined/empty.
 */
export function proxyImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("/")) return url;
  return `/api/proxy/image?url=${btoa(url)}`;
}
