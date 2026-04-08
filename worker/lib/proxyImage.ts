/**
 * Rewrite an image URL to route through the sanitizing reverse proxy.
 * Local assets (starting with "/") are made absolute using the base URL.
 * Returns null when the input is null/undefined/empty.
 */
export function proxyImageUrl(
  baseUrl: string,
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  if (url.startsWith("/")) return `${baseUrl}${url}`;
  return `${baseUrl}/api/proxy/image?url=${btoa(url)}`;
}
