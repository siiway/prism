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

/**
 * Validate a user-supplied URL we're about to issue an outbound HTTP
 * request to (webhook delivery, image proxy, image-icon HEAD, etc.).
 * Returns null if the URL is acceptable, otherwise a short rejection
 * reason. HTTPS-only and the SSRF blocklist are both required — a worker
 * fetch to an internal IP is just as dangerous from a webhook as it is
 * from the image proxy.
 */
export function validateOutboundUrl(raw: string): string | null {
  if (typeof raw !== "string" || !raw) return "url is required";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "Invalid URL";
  }
  if (parsed.protocol !== "https:") return "URL must use https://";
  if (isBlockedHost(parsed.hostname))
    return "URL host is not allowed (loopback / private / link-local)";
  return null;
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

/**
 * Fetch a user-supplied URL with the blocklist applied to *every* hop.
 *
 * `fetch` follows redirects itself, which quietly defeats the check above:
 * a host that passes validation can answer 302 and send the worker anywhere
 * it likes, including the addresses the blocklist exists to keep it away
 * from. So redirects are handled here instead — each Location is resolved
 * against the URL it came from and re-validated before the next request.
 *
 * Throws when a hop is rejected or the chain runs too long; callers already
 * treat a thrown fetch as "could not reach the URL".
 */
/** Credentials that must not travel to a host other than the one they were
 *  minted for. Authorization and Cookie are what fetch itself drops across an
 *  origin change; X-Prism-Signature is ours — the HMAC over a webhook body,
 *  which is addressed to that endpoint and nobody else. */
const CROSS_ORIGIN_STRIP = [
  "authorization",
  "cookie",
  "proxy-authorization",
  "x-prism-signature",
];

export async function safeFetch(
  url: string,
  init: RequestInit = {},
  maxRedirects = 5,
): Promise<Response> {
  let current = url;
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;
  const headers = new Headers(init.headers as HeadersInit | undefined);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const err = validateOutboundUrl(current);
    if (err) throw new Error(`Blocked URL: ${err}`);

    const res = await fetch(current, {
      ...init,
      method,
      body,
      headers,
      redirect: "manual",
    });
    if (res.status < 300 || res.status > 399) return res;

    const location = res.headers.get("location");
    if (!location) return res;

    // Taking redirects over from fetch means taking on its rules too.
    // Following one by replaying the original request would re-POST a webhook
    // payload — and the signature addressed to the first endpoint — at
    // whatever host the redirect names.
    const next = new URL(location, current);
    const crossOrigin = next.origin !== new URL(current).origin;

    if (crossOrigin) {
      for (const name of CROSS_ORIGIN_STRIP) headers.delete(name);
    }

    if (
      res.status === 303 ||
      (method !== "GET" &&
        method !== "HEAD" &&
        (res.status === 301 || res.status === 302))
    ) {
      // RFC 9110 §15.4: these turn into a GET, and the body does not travel.
      method = "GET";
      body = undefined;
      headers.delete("content-type");
      headers.delete("content-length");
    } else if (body !== undefined && body !== null && crossOrigin) {
      // 307/308 keep the method and body by definition. Across origins that
      // is precisely the leak, so refuse rather than deliver it elsewhere.
      throw new Error(
        "Refusing to replay a request body across an origin change",
      );
    }

    current = next.toString();
  }
  throw new Error("Too many redirects");
}
