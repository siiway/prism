// Shared host-blocklist for any code that fetches a user-supplied URL.
// Used by routes/proxy.ts (image reverse proxy) and lib/imageValidation.ts
// (icon URL validation). Cloudflare Workers' edge fetch already cannot
// reach private IPs in practice, but blocking up front avoids using server
// behavior (status codes, content-type, latency) as an oracle for users
// who control the URL.

const BLOCKED_HOST_RE =
  /^(localhost|.*\.local|.*\.internal|metadata\.google\.internal|169\.254\.|127\.|10\.|192\.168\.|0\.|0\.0\.0\.0)$/i;

function parseIPv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const n = parseInt(p, 10);
    if (n < 0 || n > 255) return null;
    out.push(n);
  }
  return out;
}

function isBlockedIPv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isBlockedIPv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "::" || h === "::1") return true;
  if (
    h.startsWith("fe8") ||
    h.startsWith("fe9") ||
    h.startsWith("fea") ||
    h.startsWith("feb")
  )
    return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true;
  if (h.startsWith("ff")) return true;
  const mapped = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) {
    const v4 = parseIPv4(mapped[1]);
    if (v4 && isBlockedIPv4(v4)) return true;
  }
  return false;
}

/** True if `host` (URL.hostname — no port, no brackets) targets an internal,
 *  loopback, link-local, RFC1918, CGNAT, multicast, or otherwise-unsafe
 *  address. Trailing dot and case are normalized. */
export function isBlockedHost(host: string): boolean {
  const h = host.replace(/\.$/, "").toLowerCase();
  if (!h) return true;
  if (BLOCKED_HOST_RE.test(h)) return true;
  const v4 = parseIPv4(h);
  if (v4) return isBlockedIPv4(v4);
  if (h.includes(":")) return isBlockedIPv6(h);
  return false;
}
