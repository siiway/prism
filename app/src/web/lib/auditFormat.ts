// Display helpers for audit-log rows: IP masking and User-Agent parsing.
//
// The full IP / UA is stored server-side and shown on hover, but the table
// only renders a privacy-preserving summary: a truncated IP prefix and a
// coarse client label.

/** Mask an IP for display: IPv4 keeps the first two octets, IPv6 the first
 *  two groups (eight hex digits). Returns "—" for empty input. */
export function maskIp(ip: string | null | undefined): string {
  if (!ip) return "—";
  const trimmed = ip.trim();
  if (trimmed.includes(":") && !trimmed.includes(".")) {
    // IPv6 — first two groups
    const groups = trimmed.split(":");
    const head = groups.slice(0, 2).join(":");
    return `${head}:*`;
  }
  if (trimmed.includes(".")) {
    const octets = trimmed.split(".");
    if (octets.length === 4) return `${octets[0]}.${octets[1]}.*`;
  }
  return trimmed;
}

/** Parse a coarse client label out of a User-Agent string. */
export function parseClient(ua: string | null | undefined): string {
  if (!ua) return "—";
  const s = ua.toLowerCase();
  if (s.includes("prism")) return "Prism";
  if (s.startsWith("curl/")) return "curl";
  if (s.startsWith("wget/")) return "wget";
  if (s.includes("python-requests")) return "python-requests";
  if (s.includes("okhttp")) return "OkHttp";
  if (s.includes("postman")) return "Postman";
  if (s.includes("edg/") || s.includes("edge")) return "Edge";
  if (s.includes("opr/") || s.includes("opera")) return "Opera";
  if (s.includes("firefox")) return "Firefox";
  if (s.includes("chrome") && !s.includes("chromium")) return "Chrome";
  if (s.includes("chromium")) return "Chromium";
  if (s.includes("safari")) return "Safari";
  if (s.includes("bot") || s.includes("crawler") || s.includes("spider"))
    return "Bot";
  return "Other";
}
