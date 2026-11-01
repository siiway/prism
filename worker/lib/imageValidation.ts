// Validates that a URL points to an accessible, reasonably-sized image.
// SVG is allowed — it will be sanitized at serve time via the /api/proxy/image route.
// Returns an error code (see ./apiError) on failure, null on success.
// An empty string is treated as "no image" and is always valid.

import type { CodedError } from "./apiError";
import { isBlockedHost, safeFetch } from "./safeFetch";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export async function validateImageUrl(
  url: string,
): Promise<CodedError | null> {
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "image_url_invalid" };
  }

  if (parsed.protocol !== "https:") {
    return { error: "image_https_required" };
  }

  // Refuse to issue a HEAD against internal / loopback / link-local hosts so
  // an attacker who can set this URL (e.g. an app icon_url) cannot use the
  // server's response (status / content-type / latency) to probe internal
  // services.
  if (isBlockedHost(parsed.hostname)) {
    return { error: "host_not_allowed" };
  }

  let res: Response;
  try {
    // safeFetch, not fetch: a host that passes the check above can still
    // redirect the worker onto a blocked one.
    res = await safeFetch(url, { method: "HEAD" });
  } catch {
    return { error: "image_unreachable" };
  }

  if (!res.ok) {
    return { error: "image_http_error", params: { status: res.status } };
  }

  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!ct.startsWith("image/")) {
    return { error: "image_not_image" };
  }

  const cl = res.headers.get("content-length");
  if (cl && parseInt(cl, 10) > MAX_BYTES) {
    return {
      error: "image_too_large",
      params: { max: MAX_BYTES / 1024 / 1024 },
    };
  }

  return null;
}
