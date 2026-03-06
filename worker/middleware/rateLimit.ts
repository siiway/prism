// KV-based sliding window rate limiter

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number; // seconds
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

// Convenience: rate limit by IP address
export async function rateLimitIp(
  kv: KVNamespace,
  ip: string,
  route: string,
  limit = 10,
  windowSeconds = 60,
): Promise<RateLimitResult> {
  return rateLimit(kv, `${route}:${ip}`, limit, windowSeconds);
}
