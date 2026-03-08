// Periodic domain re-verification cron task.
// Finds domains whose next_reverify_at has passed, re-checks DNS,
// and marks them unverified if the TXT record is gone.

import { getConfigValue } from "../lib/config";
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
    const stillVerified = await checkStillVerified(db, row, now);

    if (stillVerified) {
      // Extend the window
      const nextReverify = now + reverifyDays * 24 * 60 * 60;
      await db
        .prepare("UPDATE domains SET next_reverify_at = ? WHERE id = ?")
        .bind(nextReverify, row.id)
        .run();
    } else {
      // Revoke verification
      await db
        .prepare(
          "UPDATE domains SET verified = 0, verified_at = NULL, next_reverify_at = NULL WHERE id = ?",
        )
        .bind(row.id)
        .run();
    }
  }
}

/** Returns true if the domain still passes verification (parent or DNS). */
async function checkStillVerified(
  db: D1Database,
  row: DomainRow,
  now: number,
): Promise<boolean> {
  // Check parent-domain inheritance first (fast, no DNS round-trip)
  if (row.team_id) {
    const parent = await verifiedTeamParent(
      db,
      row.team_id,
      row.domain,
      row.id,
    );
    if (parent) return true;
  } else {
    const parent = await verifiedPersonalParent(
      db,
      row.user_id,
      row.domain,
      row.id,
    );
    if (parent) return true;
  }

  // Fall back to DNS TXT check
  return checkDnsTxtRecord(row.domain, row.verification_token);
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

// ─── DNS verification ─────────────────────────────────────────────────────────

async function checkDnsTxtRecord(
  domain: string,
  expectedToken: string,
): Promise<boolean> {
  try {
    const hostname = `_prism-verify.${domain}`;
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=TXT`,
      { headers: { Accept: "application/dns-json" } },
    );
    if (!res.ok) return false;
    const data = (await res.json()) as {
      Answer?: Array<{ type: number; data: string }>;
    };
    const expected = `"prism-verify=${expectedToken}"`;
    return (data.Answer ?? []).some(
      (r) => r.type === 16 && r.data === expected,
    );
  } catch {
    return false;
  }
}
