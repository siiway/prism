// Validates that a URL points to an accessible, reasonably-sized image.
// SVG is allowed — it will be sanitized at serve time via the /api/proxy/image route.
// Returns an error string on failure, null on success.
// An empty string is treated as "no image" and is always valid.

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export async function validateImageUrl(url: string): Promise<string | null> {
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Invalid URL format";
  }

  if (parsed.protocol !== "https:") {
    return "Image URL must use HTTPS";
  }

  let res: Response;
  try {
    res = await fetch(url, { method: "HEAD" });
  } catch {
    return "Could not reach the image URL";
  }

  if (!res.ok) {
    return `Image URL returned HTTP ${res.status}`;
  }

  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!ct.startsWith("image/")) {
    return "URL does not point to an image";
  }

  const cl = res.headers.get("content-length");
  if (cl && parseInt(cl, 10) > MAX_BYTES) {
    return "Image exceeds the 5 MB size limit";
  }

  return null;
}
