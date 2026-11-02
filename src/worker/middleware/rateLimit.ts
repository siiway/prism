// D1-backed atomic sliding-window rate limiter

import { randomId, sha256Hex } from "../lib/crypto";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number; // seconds
}

export interface RateLimitClaim {
  key: string;
  limit: number;
  windowSeconds: number;
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
  db: D1Database,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - windowSeconds;
  const bucketHash = await sha256Hex(key);

  // Enforcement depends only on this conditional write. D1 serializes write
  // statements on its primary, so concurrent requests cannot all observe the
  // same count and race past the limit. Each admitted request gets its own row
  // to preserve exact sliding-window semantics.
  const claim = await db
    .prepare(
      `INSERT INTO rate_limit_hits (id, bucket_hash, created_at, expires_at)
       SELECT ?, ?, ?, ?
        WHERE ? > 0
          AND ? > 0
          AND (
            SELECT COUNT(*) FROM rate_limit_hits
             WHERE bucket_hash = ? AND created_at > ?
           ) < ?
       RETURNING id`,
    )
    .bind(
      randomId(),
      bucketHash,
      now,
      now + windowSeconds,
      limit,
      windowSeconds,
      bucketHash,
      windowStart,
      limit,
    )
    .run();
  // D1 meta.changes includes every row changed by the statement, including
  // rows deleted by cleanup triggers. Use the returned insert row instead so
  // trigger cleanup cannot turn a successful admission into a false rejection.
  const allowed = (claim.results?.length ?? 0) === 1;

  // These values are advisory response metadata. A concurrent request may
  // make `remaining` more conservative after our atomic admission decision,
  // which is safe; it cannot change whether this request was admitted.
  const stats = await db
    .prepare(
      `SELECT COUNT(*) AS hit_count, MIN(created_at) AS oldest
         FROM rate_limit_hits
        WHERE bucket_hash = ? AND created_at > ?`,
    )
    .bind(bucketHash, windowStart)
    .first<{ hit_count: number; oldest: number | null }>();
  const hitCount = Number(stats?.hit_count ?? 0);
  const oldest =
    stats?.oldest === null || stats?.oldest === undefined
      ? now
      : Number(stats.oldest);

  return {
    allowed,
    remaining: Math.max(0, limit - hitCount),
    resetIn: hitCount === 0 ? 0 : Math.max(0, oldest + windowSeconds - now),
  };
}

/**
 * Atomically claim one hit in every supplied bucket. Either all buckets are
 * below their limits and receive a hit, or none do. This prevents a request
 * rejected by one dimension from consuming another dimension's allowance.
 */
export async function rateLimitAll(
  db: D1Database,
  claims: RateLimitClaim[],
): Promise<boolean> {
  if (claims.length === 0) return true;

  const now = Math.floor(Date.now() / 1000);
  const rows = await Promise.all(
    claims.map(async (claim) => ({
      id: randomId(),
      bucketHash: await sha256Hex(claim.key),
      windowStart: now - claim.windowSeconds,
      limit: claim.limit,
      expiresAt: now + claim.windowSeconds,
    })),
  );
  const values = rows.map(() => "(?, ?, ?, ?, ?)").join(", ");

  const result = await db
    .prepare(
      `WITH requested(id, bucket_hash, window_start, bucket_limit, expires_at) AS (
         VALUES ${values}
       ),
       admissible AS (
         SELECT COUNT(*) AS n
           FROM requested r
          WHERE r.bucket_limit > 0
            AND r.expires_at > ?
            AND (
              SELECT COUNT(*) FROM rate_limit_hits h
               WHERE h.bucket_hash = r.bucket_hash
                 AND h.created_at > r.window_start
            ) < r.bucket_limit
       )
       INSERT INTO rate_limit_hits (id, bucket_hash, created_at, expires_at)
       SELECT r.id, r.bucket_hash, ?, r.expires_at
         FROM requested r
        WHERE (SELECT n FROM admissible) = ?
       RETURNING id`,
    )
    .bind(
      ...rows.flatMap((row) => [
        row.id,
        row.bucketHash,
        row.windowStart,
        row.limit,
        row.expiresAt,
      ]),
      now,
      now,
      rows.length,
    )
    .run();

  return (result.results?.length ?? 0) === rows.length;
}

// Convenience: rate limit by IP address (normalises IPv6 to prefix bucket)
export async function rateLimitIp(
  db: D1Database,
  ip: string,
  route: string,
  limit = 10,
  windowSeconds = 60,
  ipv6PrefixLength = 64,
): Promise<RateLimitResult> {
  const key = normalizeIp(ip, ipv6PrefixLength);
  return rateLimit(db, `${route}:${key}`, limit, windowSeconds);
}
