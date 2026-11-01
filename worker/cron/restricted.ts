// Background upkeep for invite-registered accounts.
//
// Two jobs, both deliberately incremental:
//
//   • reapPendingRegistrations — deletes accounts that started the invite
//     flow and never finished it, freeing the username they hold.
//   • reapDissolvedTeams — finishes the staged dissolution a site admin
//     began, deleting the accounts a team minted and then the team row.
//
// Neither can run as a single statement. A team at the scale this feature
// exists for may anchor thousands of accounts, and every `DELETE FROM users`
// fans out across ~25 cascading tables; doing that in one request would
// exceed both the Worker CPU budget and D1's per-request statement ceiling.
// So each tick does a bounded slice and leaves the rest for the next one.

import { getConfigValue } from "../lib/config";
import { recordAccountDeletion } from "../lib/audit";
import { dissolveTeam } from "../lib/teams";

/** Accounts deleted per tick, per job. Small enough that a tick stays well
 *  inside the Worker limits even when every row cascades widely. */
const BATCH_SIZE = 50;

interface DoomedAccount {
  id: string;
  username: string;
}

/**
 * Delete one batch, announcing each account so downstream apps can drop the
 * subject id instead of leaving it dangling.
 *
 * The DELETE re-asserts the condition that made the row a candidate. Between
 * the SELECT that picked it and this statement — a window of up to a batch's
 * worth of audit writes — the holder may have finished joining, or converted
 * to an unrestricted account. Deleting on id alone would destroy both, and
 * the second case would quietly undo the one guarantee conversion makes.
 *
 * Memberships are therefore read *before* the delete but the audit event is
 * emitted *after*, and only if a row actually went: announcing a deletion
 * that then did not happen would have downstream apps drop a live user.
 */
async function deleteAccounts(
  env: Env,
  ctx: { waitUntil: (p: Promise<unknown>) => void },
  accounts: DoomedAccount[],
  cause: "self" | "admin" | "team_dissolved",
  /** Extra predicate the row must still satisfy, ANDed onto the delete. */
  stillEligible: string,
): Promise<number> {
  let deleted = 0;
  for (const account of accounts) {
    const { results } = await env.DB.prepare(
      "SELECT team_id FROM team_members WHERE user_id = ?",
    )
      .bind(account.id)
      .all<{ team_id: string }>()
      .catch(() => ({ results: [] as { team_id: string }[] }));

    const res = await env.DB.prepare(
      `DELETE FROM users WHERE id = ? AND ${stillEligible}`,
    )
      .bind(account.id)
      .run();
    if (!res.meta.changes) continue;

    deleted++;
    await recordAccountDeletion(env, ctx, account, {
      cause,
      teamIds: results.map((r) => r.team_id),
    });
  }
  return deleted;
}

/**
 * Remove accounts that registered through an invite but never satisfied
 * their team's join requirements.
 *
 * Only ever touches rows that are still pending *and* still restricted, so a
 * user who completed the flow — or converted — is never at risk here.
 */
export async function reapPendingRegistrations(
  env: Env,
  ctx: { waitUntil: (p: Promise<unknown>) => void },
): Promise<number> {
  const ttlHours = await getConfigValue(env.DB, "restricted_pending_ttl_hours");
  if (ttlHours <= 0) return 0;
  const cutoff = Math.floor(Date.now() / 1000) - ttlHours * 3600;

  const { results } = await env.DB.prepare(
    `SELECT id, username FROM users
      WHERE origin_team_id IS NOT NULL
        AND converted_at IS NULL
        AND origin_join_completed = 0
        AND created_at < ?
      LIMIT ?`,
  )
    .bind(cutoff, BATCH_SIZE)
    .all<DoomedAccount>();

  return deleteAccounts(
    env,
    ctx,
    results,
    "admin",
    // Still restricted, still unfinished — someone who completed the join
    // while this batch was in flight is no longer a candidate.
    "origin_team_id IS NOT NULL AND converted_at IS NULL AND origin_join_completed = 0",
  );
}

/**
 * Finish dissolving teams whose grace period has elapsed.
 *
 * Stage one (the admin endpoint) set `dissolving_at` and deactivated the
 * accounts, which is instant regardless of how many there are. This is stage
 * two: delete them in slices, and only once the last one is gone remove the
 * team itself.
 *
 * The team row has to outlive its accounts. Deleting it first would leave
 * `origin_team_id` pointing at nothing, and the query below — the only thing
 * that knows which accounts belong to this dissolution — would find none of
 * them.
 */
export async function reapDissolvedTeams(
  env: Env,
  ctx: { waitUntil: (p: Promise<unknown>) => void },
): Promise<number> {
  const graceHours = await getConfigValue(
    env.DB,
    "restricted_dissolve_grace_hours",
  );
  const cutoff = Math.floor(Date.now() / 1000) - graceHours * 3600;

  const { results: teams } = await env.DB.prepare(
    "SELECT id FROM teams WHERE dissolving_at IS NOT NULL AND dissolving_at < ? LIMIT 5",
  )
    .bind(cutoff)
    .all<{ id: string }>();

  let deleted = 0;
  for (const team of teams) {
    // Converted accounts are excluded: their holders opted into being
    // ordinary users and may by now own teams and apps of their own. The
    // team they came from ceasing to exist is no reason to delete them.
    const { results: accounts } = await env.DB.prepare(
      `SELECT id, username FROM users
        WHERE origin_team_id = ? AND converted_at IS NULL
        LIMIT ?`,
    )
      .bind(team.id, BATCH_SIZE)
      .all<DoomedAccount>();

    if (accounts.length > 0) {
      // Converting mid-batch takes the account out of the doomed set — that
      // is the whole promise conversion makes.
      deleted += await deleteAccounts(
        env,
        ctx,
        accounts,
        "team_dissolved",
        "converted_at IS NULL",
      );
      // Leave the team row alone — more accounts remain for the next tick.
      continue;
    }

    // Nothing left anchored to it. Hand over to the ordinary dissolution
    // path, which reassigns team-owned apps level by level before deleting.
    const owner = await env.DB.prepare(
      "SELECT user_id FROM team_members WHERE team_id = ? AND role = 'owner' LIMIT 1",
    )
      .bind(team.id)
      .first<{ user_id: string }>();
    await dissolveTeam(env.DB, team.id, owner?.user_id ?? "");
  }

  return deleted;
}
