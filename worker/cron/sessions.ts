// Expired-session sweep.
//
// A session row lingers in the database after its expires_at passes: the JWT
// stops verifying and the auth middleware now also refuses expired rows, but
// nothing was deleting them, so the "active sessions" view kept listing months
// of dead logins. This cron removes them (session_ips rows cascade away with
// them via the foreign key), keeping the table and that view honest.

const BATCH_SIZE = 500;

export async function sweepExpiredSessions(db: D1Database): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  // Bounded per tick so a huge backlog is cleared over several runs rather
  // than one statement that could time out.
  await db
    .prepare(
      `DELETE FROM sessions
        WHERE id IN (
          SELECT id FROM sessions WHERE expires_at <= ? LIMIT ?
        )`,
    )
    .bind(now, BATCH_SIZE)
    .run();
}

/**
 * Sweep expired short-lived OAuth grant artifacts: authorization codes (single
 * use, but an unredeemed one lingers past its 10-minute window) and RFC 8628
 * device codes (a device that never finishes leaves its pending row behind).
 * Both are already refused once expired; this just keeps the tables from
 * accumulating dead rows.
 */
export async function sweepExpiredOAuthCodes(db: D1Database): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `DELETE FROM oauth_codes
        WHERE code IN (
          SELECT code FROM oauth_codes WHERE expires_at <= ? LIMIT ?
        )`,
    )
    .bind(now, BATCH_SIZE)
    .run();
  await db
    .prepare(
      `DELETE FROM oauth_device_codes
        WHERE device_code IN (
          SELECT device_code FROM oauth_device_codes WHERE expires_at <= ? LIMIT ?
        )`,
    )
    .bind(now, BATCH_SIZE)
    .run();
}
