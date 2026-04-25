// Periodic domain re-verification cron task.
// Finds domains whose next_reverify_at has passed, re-checks ownership,
// and marks them unverified if no method still passes.

import { getConfigValue } from "../lib/config";
import {
  checkMethod,
  isVerificationMethod,
  tryAnyMethod,
  type VerificationMethod,
} from "../lib/domainOwnership";
import type { DomainRow } from "../types";

const BATCH_SIZE = 100;

export async function runReverification(db: D1Database): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const reverifyDays = await getConfigValue(db, "domain_reverify_days");

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

  if (!due.length) return;

  for (const row of due) {
    const stillMethod = await checkStillVerified(db, row);

    if (stillMethod) {
      // Extend the window. Update verification_method only when we have an
      // explicit-method result (not parent inheritance, which is "implicit").
      const nextReverify = now + reverifyDays * 24 * 60 * 60;
      if (stillMethod === "parent") {
        await db
          .prepare(
            "UPDATE domains SET next_reverify_at = ?, verification_method = NULL WHERE id = ?",
          )
          .bind(nextReverify, row.id)
          .run();
      } else {
        await db
          .prepare(
            "UPDATE domains SET next_reverify_at = ?, verification_method = ? WHERE id = ?",
          )
          .bind(nextReverify, stillMethod, row.id)
          .run();
      }
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
  // Parent inheritance is fast and often the cheapest path.
  if (row.team_id) {
    const parent = await verifiedTeamParent(
      db,
      row.team_id,
      row.domain,
      row.id,
    );
    if (parent) return "parent";
  } else {
    const parent = await verifiedPersonalParent(
      db,
      row.user_id,
      row.domain,
      row.id,
    );
    if (parent) return "parent";
  }

  // Try the previously-successful method first
  if (isVerificationMethod(row.verification_method)) {
    const ok = await checkMethod(
      row.verification_method,
      row.domain,
      row.verification_token,
    );
    if (ok) return row.verification_method;
  }

  // Fall back to all methods (skipping the one we just tried)
  return tryAnyMethod(row.domain, row.verification_token);
}

// ─── Parent-domain helpers ────────────────────────────────────────────────────

async function verifiedPersonalParent(
  db: D1Database,
  userId: string,
  domain: string,
  excludeId: string,
): Promise<string | null> {
  const parts = domain.split(".");
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join(".");
    const row = await db
      .prepare(
        `SELECT domain FROM domains
         WHERE user_id = ? AND team_id IS NULL AND domain = ? AND verified = 1 AND id != ?`,
      )
      .bind(userId, parent, excludeId)
      .first<{ domain: string }>();
    if (row) return row.domain;
  }
  return null;
}

async function verifiedTeamParent(
  db: D1Database,
  teamId: string,
  domain: string,
  excludeId: string,
): Promise<string | null> {
  const parts = domain.split(".");
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join(".");
    const row = await db
      .prepare(
        `SELECT domain FROM domains
         WHERE team_id = ? AND domain = ? AND verified = 1 AND id != ?`,
      )
      .bind(teamId, parent, excludeId)
      .first<{ domain: string }>();
    if (row) return row.domain;
  }
  return null;
}
