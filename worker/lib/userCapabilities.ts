// Restricted accounts — what a team-invite-registered user may do.
//
// An account minted through a team invite link carries `origin_team_id`.
// That single column drives three separate constraints:
//
//   1. Capabilities — every resource-creating feature is denied unless the
//      site admin has granted it. Default-deny means a feature added next
//      year is automatically off for these accounts without anyone
//      remembering to gate it.
//   2. Scope — app authorization and team membership are confined to the
//      origin team's subtree (see teamScopeGuard below).
//   3. Lifecycle — a dissolution of the origin team deletes these accounts.
//
// Converting (`converted_at`) lifts all three at once while keeping
// `origin_team_id` for traceability. Everything here therefore has to test
// *restricted and not converted*, never `origin_team_id` alone — a converted
// account is an ordinary account that merely remembers where it came from.
//
// Every check funnels through this module on purpose. The two pre-existing
// feature switches (`disable_user_create_team`, `disable_user_create_app`)
// are already spread over three call sites; layering per-account rules on
// top of that pattern would guarantee a missed spot.

import { getConfigValue } from "./config";
import type {
  InviteRegistrationExemptions,
  RestrictedCapabilities,
  RestrictedCapability,
  UserRow,
} from "../types";

// ─── Capability resolution ───────────────────────────────────────────────────

/**
 * Built-in defaults — the last link of the chain, and all deny.
 *
 * Account security (password, 2FA, sessions, email binding) is deliberately
 * absent: it is never gated. Gating it would deadlock the registration flow,
 * which requires a pending account to enroll 2FA or verify an address before
 * it can finish joining.
 */
export const RESTRICTED_CAPABILITY_DEFAULTS: Record<
  RestrictedCapability,
  boolean
> = {
  "team:create": false,
  "app:create": false,
  "domain:create": false,
  "pat:create": false,
  "profile:public": false,
  "gpg:manage": false,
  // Converting to an unrestricted account. Off until a site admin decides
  // this instance wants to offer the escape hatch at all.
  "self:convert": false,
};

/** Read the site's capability grants, tolerating a malformed value. */
export async function getRestrictedCapabilities(
  db: D1Database,
): Promise<RestrictedCapabilities> {
  const value = await getConfigValue(db, "restricted_user_capabilities");
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as RestrictedCapabilities;
}

/** Site grant → built-in default. */
export function resolveRestrictedCapability(
  capability: RestrictedCapability,
  siteGrants: RestrictedCapabilities,
): boolean {
  const granted = siteGrants[capability];
  if (typeof granted === "boolean") return granted;
  return RESTRICTED_CAPABILITY_DEFAULTS[capability];
}

/**
 * Whether a restricted account may convert itself to a full account: its
 * origin team's override when a site admin has set one, otherwise the site
 * default. Read as optional so a database that hasn't applied the column's
 * migration yet falls back to the site default.
 */
export async function resolveSelfConvert(
  db: D1Database,
  originTeamId: string | null,
  siteGrants: RestrictedCapabilities,
): Promise<boolean> {
  const site = resolveRestrictedCapability("self:convert", siteGrants);
  if (!originTeamId) return site;
  const team = await db
    .prepare("SELECT * FROM teams WHERE id = ?")
    .bind(originTeamId)
    .first<{ invite_registration_allow_convert?: number | null }>();
  const own = team?.invite_registration_allow_convert;
  return own === 0 || own === 1 ? own === 1 : site;
}

/** Strip an incoming grant payload to keys we recognise, so the config row
 *  cannot accumulate arbitrary JSON from a hand-rolled request. */
export function sanitizeRestrictedCapabilities(
  input: unknown,
): RestrictedCapabilities {
  const out: RestrictedCapabilities = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  const bag = input as Record<string, unknown>;
  for (const capability of Object.keys(
    RESTRICTED_CAPABILITY_DEFAULTS,
  ) as RestrictedCapability[]) {
    const v = bag[capability];
    if (typeof v === "boolean") out[capability] = v;
  }
  return out;
}

// ─── Account classification ──────────────────────────────────────────────────

/** The subset of a user row these checks need. Accepting a narrow shape lets
 *  callers pass a `SELECT`-ed projection instead of loading the whole row. */
export interface RestrictionState {
  origin_team_id: string | null;
  origin_join_completed: number;
  converted_at: number | null;
}

/**
 * True when the account is still operating under restrictions.
 *
 * A converted account returns false even though `origin_team_id` is still
 * set — that column survives conversion purely so a leaked invite can be
 * traced later.
 */
export function isRestricted(user: RestrictionState): boolean {
  return user.origin_team_id !== null && user.converted_at === null;
}

/**
 * True for an account that exists but has not finished joining its team.
 *
 * Pending accounts are blocked from `/authorize` outright, independently of
 * any capability grant. Letting one through would hand the downstream app a
 * token with no `in_team_*` or `groups_in_team_*` claims — the app would read
 * that as "not a member" and likely create a local record it then has to
 * reconcile once the user actually finishes. Blocking is both simpler and
 * more honest than emitting a half-true identity.
 */
export function isPendingJoin(user: RestrictionState): boolean {
  return isRestricted(user) && user.origin_join_completed !== 1;
}

/** Load just the restriction columns for a user id. */
export async function getRestrictionState(
  db: D1Database,
  userId: string,
): Promise<RestrictionState | null> {
  return db
    .prepare(
      "SELECT origin_team_id, origin_join_completed, converted_at FROM users WHERE id = ?",
    )
    .bind(userId)
    .first<RestrictionState>();
}

// ─── The single choke point ──────────────────────────────────────────────────

/** Why a capability was refused, so callers can phrase a useful error. */
export type CapabilityDenial =
  | { reason: "restricted"; capability: RestrictedCapability }
  | { reason: "pending_join" };

/**
 * Returns null when the account may use `capability`, or a denial otherwise.
 *
 * Unrestricted accounts always pass — this function is a no-op for the vast
 * majority of users, so call sites can invoke it unconditionally rather than
 * branching on account type first.
 */
export async function checkUserCapability(
  db: D1Database,
  user: RestrictionState,
  capability: RestrictedCapability,
): Promise<CapabilityDenial | null> {
  if (!isRestricted(user)) return null;
  // A half-registered account holds nothing at all, regardless of grants.
  if (isPendingJoin(user)) return { reason: "pending_join" };
  const grants = await getRestrictedCapabilities(db);
  if (resolveRestrictedCapability(capability, grants)) return null;
  return { reason: "restricted", capability };
}

/**
 * One-liner for route handlers: load the account's restriction state and
 * check a capability in a single call.
 *
 * Returns an error message when refused, or null when allowed. Handlers can
 * write `const err = await guardCapability(db, user.id, "app:create"); if
 * (err) return c.json({ error: err }, 403);` — short enough that adding the
 * check to a new endpoint is never the inconvenient option.
 */
export async function guardCapability(
  db: D1Database,
  userId: string,
  capability: RestrictedCapability,
): Promise<string | null> {
  const state = await getRestrictionState(db, userId);
  if (!state) return null;
  const denial = await checkUserCapability(db, state, capability);
  return denial ? denialMessage(denial) : null;
}

/** Human-facing message for a denial. */
export function denialMessage(denial: CapabilityDenial): string {
  if (denial.reason === "pending_join")
    return "Finish joining your team before using this feature";
  return "This feature is not available to accounts registered through a team invite";
}

// ─── Scope guards ────────────────────────────────────────────────────────────

/**
 * Whether `teamId` lies within the origin team's subtree.
 *
 * The anchor is `origin_team_id`, never the account's current memberships.
 * Anchoring on memberships would make the constraint self-defeating: join a
 * second team and its whole subtree opens up, then a third, and so on.
 *
 * Sub-teams count as inside — a descendant of the origin team is part of the
 * same organisation, and the app-authorization rule uses the same boundary,
 * so membership and authorization stay consistent.
 */
export async function isWithinOriginSubtree(
  db: D1Database,
  originTeamId: string,
  teamId: string,
  maxDepth: number,
): Promise<boolean> {
  if (teamId === originTeamId) return true;
  // Walk up from the candidate; the origin is an ancestor iff we meet it.
  let currentId: string | null = teamId;
  const seen = new Set<string>();
  for (let i = 0; i <= maxDepth && currentId; i++) {
    if (seen.has(currentId)) break;
    seen.add(currentId);
    const row: { parent_team_id: string | null } | null = await db
      .prepare("SELECT parent_team_id FROM teams WHERE id = ?")
      .bind(currentId)
      .first<{ parent_team_id: string | null }>();
    if (!row) return false;
    if (row.parent_team_id === originTeamId) return true;
    currentId = row.parent_team_id;
  }
  return false;
}

/**
 * Gate for "may this account join / be added to this team?".
 * Returns null when allowed, or an error message.
 */
export async function checkTeamJoinAllowed(
  db: D1Database,
  user: RestrictionState,
  teamId: string,
): Promise<string | null> {
  if (!isRestricted(user)) return null;
  const maxDepth = await getConfigValue(db, "max_team_depth");
  const inside = await isWithinOriginSubtree(
    db,
    user.origin_team_id!,
    teamId,
    maxDepth,
  );
  if (inside) return null;
  return "Accounts registered through a team invite can only join their own team";
}

/**
 * Gate for "may this account authorize this app?".
 *
 * Checked at /authorize only, not on refresh: re-evaluating later would make
 * an app being transferred out of the team silently invalidate live tokens,
 * which is a worse failure mode than a slightly stale grant.
 */
export async function checkAppAuthorizationAllowed(
  db: D1Database,
  user: RestrictionState,
  app: { team_id: string | null; owner_id: string },
): Promise<string | null> {
  if (!isRestricted(user)) return null;
  if (isPendingJoin(user))
    return "Finish joining your team before signing in to applications";

  // Team ownership is recorded two ways depending on how the app was made:
  // `team_id`, or an `owner_id` pointing at the team-shaped user row whose id
  // equals the team id (see migration 0042). Accept either.
  const owningTeamId = app.team_id ?? app.owner_id;
  const maxDepth = await getConfigValue(db, "max_team_depth");
  const inside = await isWithinOriginSubtree(
    db,
    user.origin_team_id!,
    owningTeamId,
    maxDepth,
  );
  if (inside) return null;
  return "Accounts registered through a team invite can only sign in to their own team's applications";
}

// ─── Team-side protections ───────────────────────────────────────────────────

/**
 * Whether a team still has live restricted accounts anchored to it.
 *
 * This — not the `invite_registration_granted` switch — is what guards
 * dissolution and re-parenting. Keying those protections on the switch would
 * leave an obvious bypass: mint five thousand accounts, have the grant
 * revoked, and the team is no longer "restricted" so its owner may dissolve it
 * and delete every one of them without a site admin ever being involved.
 *
 * Protection therefore lapses only when the accounts themselves are gone
 * (self-deleted, reaped, or converted), which is exactly when there is
 * nothing left to protect.
 *
 * Counting `users` rather than `team_members` also catches pending accounts:
 * those have `origin_team_id` set but no membership row yet, so a
 * membership-based test would see an "empty" team and happily dissolve it.
 */
export async function hasLiveRestrictedAccounts(
  db: D1Database,
  teamId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT 1 AS x FROM users WHERE origin_team_id = ? AND converted_at IS NULL LIMIT 1",
    )
    .bind(teamId)
    .first<{ x: number }>();
  return !!row;
}

/**
 * Whether any team in this subtree holds a member whose origin lies
 * elsewhere — the condition that makes re-parenting unsafe.
 *
 * The test is deliberately about *members*, not about which team minted
 * them: a restricted user's origin is the top team, so a sub-team they
 * joined would answer "no" to {@link hasLiveRestrictedAccounts} while moving
 * it out of the tree would still strand them outside their own subtree.
 */
export async function subtreeHasRestrictedMembers(
  db: D1Database,
  teamId: string,
  descendantIds: string[],
): Promise<boolean> {
  const ids = [teamId, ...descendantIds];
  const placeholders = ids.map(() => "?").join(", ");
  const row = await db
    .prepare(
      `SELECT 1 AS x
         FROM team_members tm
         JOIN users u ON u.id = tm.user_id
        WHERE tm.team_id IN (${placeholders})
          AND u.origin_team_id IS NOT NULL
          AND u.converted_at IS NULL
        LIMIT 1`,
    )
    .bind(...ids)
    .first<{ x: number }>();
  return !!row;
}

/**
 * Tolerant parse of `teams.invite_registration_exemptions`.
 *
 * Malformed content degrades to "nothing exempted" rather than throwing. The
 * admin team listing reads this column for every row, so one bad blob — a
 * hand-edited row, a legacy write — would otherwise take the whole listing
 * down with it. Falling back also fails *safe*: an unreadable exemption
 * means the check stays enforced.
 */
export function parseInviteRegistrationExemptions(
  raw: string | null,
): InviteRegistrationExemptions {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const bag = parsed as Record<string, unknown>;
    const out: InviteRegistrationExemptions = {};
    if (typeof bag.email_verification === "boolean")
      out.email_verification = bag.email_verification;
    return out;
  } catch {
    return {};
  }
}

// ─── Synthetic addresses ─────────────────────────────────────────────────────

/**
 * Address given to an account registered without one.
 *
 * `users.email` is `UNIQUE NOT NULL`, so something has to go in the column.
 * Storing an unverified real address instead would be worse: the uniqueness
 * constraint turns a typo into a permanent lockout for whoever actually owns
 * that address, and the typing user can never verify it either, so their own
 * account can never be converted.
 *
 * `.invalid` is reserved by RFC 2606 precisely for addresses guaranteed not
 * to resolve, and matches the existing `team-<id>@teams.invalid` convention
 * for team-shaped rows.
 */
export function syntheticEmail(userId: string): string {
  return `restricted-${userId}@users.invalid`;
}

/** True for an address this instance synthesised rather than one a human
 *  supplied — the UI prompts these users to bind a real address, and
 *  conversion requires it. */
export function isSyntheticEmail(email: string): boolean {
  return email.endsWith("@users.invalid");
}

/** Convenience: does this account still lack a real, verified address? */
export function needsRealEmail(
  user: Pick<UserRow, "email" | "email_verified">,
): boolean {
  return isSyntheticEmail(user.email) || user.email_verified !== 1;
}
