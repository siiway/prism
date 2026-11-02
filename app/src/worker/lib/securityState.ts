import { sha256Hex } from "./crypto";

const SWEEP_BATCH_SIZE = 5_000;

export type ReplayClaimType = "dpop" | "client-assertion" | "cap-token";

/**
 * Claim a replay-sensitive value exactly once for its validity window.
 *
 * The tuple is hashed to keep attacker-controlled identifiers out of D1 and
 * to give the primary key a fixed size. The conditional upsert is the
 * authorization decision: concurrent callers for the same live claim cannot
 * both change the row. Replacing an expired row makes correctness independent
 * of the scheduled cleanup cadence.
 */
export async function claimReplayValue(
  db: D1Database,
  claimType: ReplayClaimType,
  principal: string,
  jti: string,
  expiresAt: number,
  now = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const claimHash = await sha256Hex(
    JSON.stringify([claimType, principal, jti]),
  );
  const result = await db
    .prepare(
      `INSERT INTO security_replay_claims
         (claim_hash, claim_type, expires_at, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(claim_hash) DO UPDATE SET
         claim_type = excluded.claim_type,
         expires_at = excluded.expires_at,
         created_at = excluded.created_at
       WHERE security_replay_claims.expires_at <= ?`,
    )
    .bind(claimHash, claimType, expiresAt, now, now)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

/** Remove a bounded batch of expired rate-limit hits and replay claims. */
export async function sweepExpiredSecurityState(db: D1Database): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `DELETE FROM rate_limit_hits
        WHERE id IN (
          SELECT id FROM rate_limit_hits
           WHERE expires_at <= ?
           LIMIT ?
        )`,
    )
    .bind(now, SWEEP_BATCH_SIZE)
    .run();
  await db
    .prepare(
      `DELETE FROM security_replay_claims
        WHERE claim_hash IN (
          SELECT claim_hash FROM security_replay_claims
           WHERE expires_at <= ?
           LIMIT ?
        )`,
    )
    .bind(now, SWEEP_BATCH_SIZE)
    .run();
}
