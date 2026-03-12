// KV-based sliding window rate limiter

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number; // seconds
}

/**
 * Normalise an IP for use as a rate-limit key.
 * IPv4 addresses are returned unchanged.
 * IPv6 addresses are truncated to the given prefix length (default /64)
 * so that all addresses in the same subnet share a single bucket.
 */
export function normalizeIp(ip: string, ipv6PrefixLength = 64): string {
  if (!ip.includes(":")) return ip; // IPv4

  // Expand any "::" shorthand so we have a full 8-group address
  const expand = (addr: string): number[] => {
    const halves = addr.split("::");
    const left = halves[0] ? halves[0].split(":") : [];
    const right = halves[1] ? halves[1].split(":") : [];
    const missing = 8 - left.length - right.length;
    const groups = [...left, ...Array(missing).fill("0"), ...right];
    return groups.map((g) => parseInt(g || "0", 16));
  };

  const groups = expand(ip);
  const bits = ipv6PrefixLength;

  // Zero out bits beyond the prefix
  for (let i = 0; i < 8; i++) {
    const groupStart = i * 16;
    const groupEnd = groupStart + 16;
    if (groupEnd <= bits) {
      // group fully inside prefix — keep as-is
    } else if (groupStart >= bits) {
      groups[i] = 0; // group fully outside prefix
    } else {
      // partial group
      const keep = bits - groupStart;
      const mask = (0xffff << (16 - keep)) & 0xffff;
      groups[i] = groups[i] & mask;
    }
  }

  return groups.map((g) => g.toString(16)).join(":") + `/${bits}`;
}

export async function rateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const kvKey = `rl:${key}`;

  const stored = await kv.get(kvKey);
  let hits: number[] = stored ? (JSON.parse(stored) as number[]) : [];

  // Remove timestamps outside the window
  hits = hits.filter((t) => t > now - windowSeconds);

  const remaining = Math.max(0, limit - hits.length);
  const oldest = hits[0] ?? now;
  const resetIn = Math.max(0, oldest + windowSeconds - now);

  if (hits.length >= limit) {
    return { allowed: false, remaining: 0, resetIn };
  }

  hits.push(now);
  await kv.put(kvKey, JSON.stringify(hits), { expirationTtl: windowSeconds });

  return { allowed: true, remaining: remaining - 1, resetIn };
}

// Convenience: rate limit by IP address (normalises IPv6 to prefix bucket)
export async function rateLimitIp(
  kv: KVNamespace,
  ip: string,
  route: string,
  limit = 10,
  windowSeconds = 60,
  ipv6PrefixLength = 64,
): Promise<RateLimitResult> {
  const key = normalizeIp(ip, ipv6PrefixLength);
  return rateLimit(kv, `${route}:${key}`, limit, windowSeconds);
}
