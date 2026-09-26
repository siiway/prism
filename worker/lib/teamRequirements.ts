// Team join requirement checks — used by the team-join paths to gate
// membership creation, and by the user-side 2FA / email / age mutation paths
// to stop a member from silently dropping below their team's bar.
//
// Effective requirement = team flag OR site floor for the boolean factors.
// Minimum age is the greater of the team value and the site floor (0 = off).
// The site-level `default_team_require_*` settings act as a minimum no team
// can drop below; team owners can still opt their team in further.

import { readMinAge, meetsMinAge } from "../../shared/age";
import { getAgeVerification } from "./agekey";
import { getConfigValue } from "./config";

export interface TeamRequirementsRow {
  require_2fa: number;
  require_verified_email: number;
  require_min_age: number;
}

export interface RequirementFloor {
  require_2fa: boolean;
  require_verified_email: boolean;
  /** 0 = no site-wide age floor. Otherwise 13, 16, 18, or 21. */
  require_min_age: number;
}

export interface EffectiveTeamRequirements {
  require_2fa: boolean;
  require_verified_email: boolean;
  require_min_age: number;
  /** Which of the active requirements are forced by the site floor (team
   *  owners can't disable these via the team settings UI). `require_min_age`
   *  here is the floor itself, not a boolean. */
  forced_by_site: RequirementFloor;
}

export interface UserSecurityState {
  email_verified: boolean;
  has_2fa: boolean;
  age_thresholds: Record<string, boolean>;
}

export type RequirementKey = "verified_email" | "2fa" | "age";

/** Look up the requirement flags on a team. Missing teams return null so
 *  callers can short-circuit (the surrounding handler will already 404). */
export async function getTeamRequirements(
  db: D1Database,
  teamId: string,
): Promise<TeamRequirementsRow | null> {
  return db
    .prepare(
      "SELECT require_2fa, require_verified_email, require_min_age FROM teams WHERE id = ?",
    )
    .bind(teamId)
    .first<TeamRequirementsRow>();
}

/** Site-wide floor — what every team is forced to require regardless of
 *  the team-level flag. Read once per request and pass through to
 *  `mergeWithSiteFloor` to avoid hitting `site_config` repeatedly. */
export async function getSiteRequirementFloor(
  db: D1Database,
): Promise<RequirementFloor> {
  const [r2fa, rEmail, rAge] = await Promise.all([
    getConfigValue(db, "default_team_require_2fa"),
    getConfigValue(db, "default_team_require_verified_email"),
    getConfigValue(db, "default_team_require_min_age"),
  ]);
  return {
    require_2fa: r2fa,
    require_verified_email: rEmail,
    require_min_age: readMinAge(rAge),
  };
}

/** Combine a team row with the site floor. Boolean factors are OR-merged.
 *  Minimum age is the greater of the two. Anything only forced by the floor
 *  is flagged so the UI can render it as locked. */
export function mergeWithSiteFloor(
  team: TeamRequirementsRow,
  floor: RequirementFloor,
): EffectiveTeamRequirements {
  const teamReq2fa = team.require_2fa === 1;
  const teamReqEmail = team.require_verified_email === 1;
  const teamAge = readMinAge(team.require_min_age);
  const floorAge = readMinAge(floor.require_min_age);
  return {
    require_2fa: teamReq2fa || floor.require_2fa,
    require_verified_email: teamReqEmail || floor.require_verified_email,
    require_min_age: Math.max(teamAge, floorAge),
    forced_by_site: {
      require_2fa: floor.require_2fa,
      require_verified_email: floor.require_verified_email,
      require_min_age: floorAge,
    },
  };
}

/** Convenience: getTeamRequirements + getSiteRequirementFloor + merge. */
export async function getEffectiveTeamRequirements(
  db: D1Database,
  teamId: string,
): Promise<EffectiveTeamRequirements | null> {
  const [team, floor] = await Promise.all([
    getTeamRequirements(db, teamId),
    getSiteRequirementFloor(db),
  ]);
  if (!team) return null;
  return mergeWithSiteFloor(team, floor);
}

/** True if the user has at least one enabled TOTP authenticator or any
 *  passkey on file. Backup codes alone don't count — they're a recovery
 *  path, not a primary factor. */
export async function userHas2FA(
  db: D1Database,
  userId: string,
): Promise<boolean> {
  const totp = await db
    .prepare(
      "SELECT 1 AS x FROM totp_authenticators WHERE user_id = ? AND enabled = 1 LIMIT 1",
    )
    .bind(userId)
    .first<{ x: number }>();
  if (totp) return true;
  const passkey = await db
    .prepare("SELECT 1 AS x FROM passkeys WHERE user_id = ? LIMIT 1")
    .bind(userId)
    .first<{ x: number }>();
  return !!passkey;
}

export async function getUserSecurityState(
  db: D1Database,
  userId: string,
): Promise<UserSecurityState> {
  const row = await db
    .prepare("SELECT email_verified FROM users WHERE id = ?")
    .bind(userId)
    .first<{ email_verified: number }>();
  const [has2fa, age] = await Promise.all([
    userHas2FA(db, userId),
    getAgeVerification(db, userId),
  ]);
  return {
    email_verified: !!row?.email_verified,
    has_2fa: has2fa,
    age_thresholds: age?.thresholds ?? {},
  };
}

/** Return the set of requirements the (effective) team config enforces
 *  that `state` does not satisfy. Accepts either the raw team row (which
 *  is merged with the site floor on the fly) or a pre-merged effective
 *  object — handy for callers that already loaded both. */
export function unmetRequirements(
  team: TeamRequirementsRow | EffectiveTeamRequirements,
  state: UserSecurityState,
  floor?: RequirementFloor,
): RequirementKey[] {
  const effective = isEffective(team)
    ? team
    : mergeWithSiteFloor(
        team,
        floor ?? {
          require_2fa: false,
          require_verified_email: false,
          require_min_age: 0,
        },
      );
  const missing: RequirementKey[] = [];
  if (effective.require_verified_email && !state.email_verified)
    missing.push("verified_email");
  if (effective.require_2fa && !state.has_2fa) missing.push("2fa");
  if (
    effective.require_min_age > 0 &&
    !meetsMinAge(state.age_thresholds, effective.require_min_age)
  )
    missing.push("age");
  return missing;
}

function isEffective(
  v: TeamRequirementsRow | EffectiveTeamRequirements,
): v is EffectiveTeamRequirements {
  return typeof (v as EffectiveTeamRequirements).require_2fa === "boolean";
}

/** Teams the user belongs to whose effective requirements would be violated
 *  if `nextState` (the user's hypothetical post-mutation security state)
 *  were applied. Used by the 2FA / email / age mutation handlers to refuse
 *  changes that would silently break a team membership. The site floor is
 *  folded in here, so a team with neither flag set can still appear if
 *  the site enforces the requirement globally. */
export async function teamsBlockingDowngrade(
  db: D1Database,
  userId: string,
  nextState: UserSecurityState,
): Promise<Array<{ id: string; name: string; missing: RequirementKey[] }>> {
  const floor = await getSiteRequirementFloor(db);
  // When the site floor is on, every team membership is potentially in
  // play; otherwise we only need teams with at least one team-level flag.
  const broad =
    floor.require_2fa ||
    floor.require_verified_email ||
    floor.require_min_age > 0;
  const sql = broad
    ? `SELECT t.id, t.name, t.require_2fa, t.require_verified_email, t.require_min_age
         FROM teams t
         JOIN team_members tm ON tm.team_id = t.id
         WHERE tm.user_id = ?`
    : `SELECT t.id, t.name, t.require_2fa, t.require_verified_email, t.require_min_age
         FROM teams t
         JOIN team_members tm ON tm.team_id = t.id
         WHERE tm.user_id = ?
           AND (t.require_2fa = 1 OR t.require_verified_email = 1 OR t.require_min_age > 0)`;
  const { results } = await db.prepare(sql).bind(userId).all<{
    id: string;
    name: string;
    require_2fa: number;
    require_verified_email: number;
    require_min_age: number;
  }>();
  const offenders: Array<{
    id: string;
    name: string;
    missing: RequirementKey[];
  }> = [];
  for (const t of results) {
    const missing = unmetRequirements(t, nextState, floor);
    if (missing.length) offenders.push({ id: t.id, name: t.name, missing });
  }
  return offenders;
}
