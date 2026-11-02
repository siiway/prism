// Periodic domain re-verification cron task.
// Finds domains whose next_reverify_at has passed, re-checks ownership,
// and marks them unverified if no method still passes.

import {
  checkMethod,
  isVerificationMethod,
  tryAnyMethod,
  VERIFICATION_METHODS,
  type VerificationMethod,
} from "../lib/domainOwnership";
import {
  domainOwner,
  nextReverifyAt,
  verifiedParentDomain,
} from "../lib/domains";
import type { DomainRow } from "../types";

const BATCH_SIZE = 100;

export async function runReverification(db: D1Database): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const nextReverify = await nextReverifyAt(db, now);

  // Fetch overdue verified domains
  const { results: due } = await db
    .prepare(
      `SELECT * FROM domains
       WHERE verified = 1 AND next_reverify_at IS NOT NULL AND next_reverify_at <= ?
       ORDER BY next_reverify_at ASC
       LIMIT ?`,
    )
    .bind(now, BATCH_SIZE)
    .all<DomainRow>();

  for (const row of due) {
    const stillMethod = await checkStillVerified(db, row);

    if (stillMethod) {
      // Extend the window. A parent domain vouching for it is recorded as no
      // method, as when it was first verified that way.
      await db
        .prepare(
          "UPDATE domains SET next_reverify_at = ?, verification_method = ? WHERE id = ?",
        )
        .bind(
          nextReverify,
          stillMethod === "parent" ? null : stillMethod,
          row.id,
        )
        .run();
    } else {
      // Revoke verification
      await db
        .prepare(
          "UPDATE domains SET verified = 0, verified_at = NULL, next_reverify_at = NULL, verification_method = NULL WHERE id = ?",
        )
        .bind(row.id)
        .run();
    }
  }
}

/**
 * Returns the method that still passes ("parent" or a VerificationMethod),
 * or null if nothing passes. Tries the stored method first to avoid wasted I/O.
 */
async function checkStillVerified(
  db: D1Database,
  row: DomainRow,
): Promise<VerificationMethod | "parent" | null> {
  // A verified parent domain is a database lookup, the cheapest check. It
  // follows the same rules as verifying by hand, ancestor teams included.
  if (await verifiedParentDomain(db, domainOwner(row), row.domain))
    return "parent";

  // Try the previously-successful method first, then the others.
  const stored = isVerificationMethod(row.verification_method)
    ? row.verification_method
    : null;
  if (stored && (await checkMethod(stored, row.domain, row.verification_token)))
    return stored;
  return tryAnyMethod(
    row.domain,
    row.verification_token,
    VERIFICATION_METHODS.filter((m) => m !== stored),
  );
}
