// Shared SSRF guard for code that fetches a user-supplied URL. Literal IPs
// are parsed into binary addresses instead of being checked with string
// prefixes. Hostnames are also resolved immediately before every request so a
// public-looking name cannot silently point at an internal address.

import ipaddr from "ipaddr.js";

const BLOCKED_NAME_RE =
  /^(?:localhost|.*\.localhost|local|.*\.local|internal|.*\.internal|metadata\.google\.internal)$/i;
const DNS_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const DNS_RECORD_TYPES = ["A", "AAAA"] as const;
const DNS_TYPE_A = 1;
const DNS_TYPE_CNAME = 5;
const DNS_TYPE_AAAA = 28;
const GLOBAL_IPV6_UNICAST = ipaddr.IPv6.parseCIDR("2000::/3");

type DnsRecordType = (typeof DNS_RECORD_TYPES)[number];
type DnsJsonResponse = {
  Status?: number;
  Answer?: Array<{ type?: number; data?: string }>;
};

/** Remove URL.hostname's IPv6 brackets and a DNS name's final root label. */
function normalizeHost(host: string): string | null {
  let normalized = host.trim().toLowerCase().replace(/\.+$/, "");
  if (!normalized) return null;

  const hasOpeningBracket = normalized.startsWith("[");
  const hasClosingBracket = normalized.endsWith("]");
  if (hasOpeningBracket || hasClosingBracket) {
    if (!hasOpeningBracket || !hasClosingBracket) return null;
    normalized = normalized.slice(1, -1);
    if (!normalized || normalized.includes("[") || normalized.includes("]"))
      return null;
  }

  // Zone identifiers are meaningful only on the machine that interprets
  // them. They are never safe in a server-selected outbound destination.
  if (normalized.includes("%")) return null;
  return normalized;
}

/** Only ordinary globally routable unicast addresses may be fetched. */
function isBlockedIpLiteral(host: string): boolean {
  if (!ipaddr.isValid(host)) return true;

  // process() converts both dotted and hexadecimal IPv4-mapped IPv6 forms to
  // IPv4 before range classification (for example ::ffff:7f00:1).
  const address = ipaddr.process(host);
  if (address.range() !== "unicast") return true;

  // ipaddr's default "unicast" classification also covers currently reserved
  // IPv6 space. Global unicast allocations are confined to 2000::/3.
  return address.kind() === "ipv6" && !address.match(GLOBAL_IPV6_UNICAST);
}

async function queryDns(
  hostname: string,
  type: DnsRecordType,
  signal?: AbortSignal | null,
): Promise<DnsJsonResponse> {
  const query = new URL(DNS_ENDPOINT);
  query.searchParams.set("name", hostname);
  query.searchParams.set("type", type);

  const response = await fetch(query, {
    headers: {
      Accept: "application/dns-json",
      "Cache-Control": "no-cache",
    },
    redirect: "manual",
    signal,
  });
  if (!response.ok) throw new Error("DNS lookup failed");

  const data = (await response.json()) as DnsJsonResponse;
  if (
    data.Status !== 0 ||
    (data.Answer !== undefined && !Array.isArray(data.Answer))
  ) {
    throw new Error("DNS lookup failed");
  }
  return data;
}

/**
 * Resolve a non-literal hostname and reject every returned address unless it
 * is globally routable unicast. Resolution fails closed: fetching after an
 * incomplete/failed check would make the fetch runtime's answer the policy.
 *
 * Cloudflare Workers does not expose a way to pin an arbitrary HTTPS request
 * to the address returned by DNS while retaining certificate/SNI checks. The
 * checks are therefore made immediately before fetch. Workers' global fetch
 * atomically filters DNS answers to public destinations, and the deployment
 * enables `global_fetch_strictly_public` to prevent same-zone routing bypasses.
 */
async function validateResolvedHost(
  host: string,
  signal?: AbortSignal | null,
): Promise<void> {
  const hostname = normalizeHost(host);
  if (!hostname) throw new Error("Blocked URL: invalid host");
  if (ipaddr.isValid(hostname)) return;

  const answers = await Promise.all(
    DNS_RECORD_TYPES.map((type) => queryDns(hostname, type, signal)),
  );
  let addressCount = 0;

  for (const response of answers) {
    for (const record of response.Answer ?? []) {
      if (
        record.type === DNS_TYPE_CNAME &&
        (typeof record.data !== "string" || isBlockedHost(record.data))
      ) {
        throw new Error("Blocked URL: DNS alias is not allowed");
      }
      if (record.type !== DNS_TYPE_A && record.type !== DNS_TYPE_AAAA) continue;
      if (
        typeof record.data !== "string" ||
        !ipaddr.isValid(record.data) ||
        isBlockedIpLiteral(record.data)
      ) {
        throw new Error("Blocked URL: DNS resolved to a non-public address");
      }
      addressCount++;
    }
  }

  if (addressCount === 0) throw new Error("DNS lookup returned no addresses");
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

/** True if `host` targets a local name or a non-public IP address.
 *  URL.hostname retains brackets around IPv6 literals, so callers may pass
 *  either bracketed URL hostnames or bare DNS/IP values. */
export function isBlockedHost(host: string): boolean {
  const normalized = normalizeHost(host);
  if (!normalized) return true;
  if (BLOCKED_NAME_RE.test(normalized)) return true;
  if (ipaddr.isValid(normalized)) return isBlockedIpLiteral(normalized);

  // A colon or bracket can only be part of an IP literal here. If parsing it
  // failed, reject it rather than accidentally treating it as a DNS name.
  if (
    normalized.includes(":") ||
    normalized.includes("[") ||
    normalized.includes("]")
  )
    return true;
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

    const parsedCurrent = new URL(current);
    await validateResolvedHost(parsedCurrent.hostname, init.signal);

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

    // We will not consume a followed redirect's body. Cancel it before opening
    // DNS and target subrequests for the next hop so it cannot occupy one of a
    // Worker's limited simultaneous outbound connections.
    await res.body?.cancel().catch(() => undefined);

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
      (res.status === 303 && method !== "HEAD") ||
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
