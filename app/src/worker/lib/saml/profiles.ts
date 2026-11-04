// SAML profiles (see migration 0089): the identity a user presents to SAML
// apps, as the persistent NameID and the uid attribute.
//
// Each app gets one profile per user, chosen at the first sign-in to it and
// kept after: a new per-app profile (the default, so apps can't match people
// across each other), or one of the user's shared profiles, which presents
// the same ID to every app it's chosen for. A per-app profile can later be
// turned into a shared one; it keeps its ID, so its app sees no change.

import { SAML_PROFILE_NAME_MAX_LENGTH } from "../../../shared/limits";
import { randomId } from "../crypto";

/** How many shared profiles one user may have. */
export const MAX_SHARED_PROFILES = 50;
export const MAX_PROFILE_NAME = SAML_PROFILE_NAME_MAX_LENGTH;

/** A saml_profiles row. */
export interface SamlProfileRow {
  id: string;
  user_id: string;
  name_id: string;
  /** The app a per-app profile was made for; null when shared. */
  app_id: string | null;
  /** A shared profile's name; null for per-app. */
  name: string | null;
  created_at: number;
  updated_at: number;
}

/** "app": made for one app at the first sign-in to it; "shared": made by
 *  the user, for any number of apps. */
export const profileKind = (p: SamlProfileRow) =>
  p.app_id ? ("app" as const) : ("shared" as const);

/** A profile as the API shows it. */
export const profileSummary = (p: SamlProfileRow) => ({
  id: p.id,
  kind: profileKind(p),
  name: p.name,
  name_id: p.name_id,
});

/** How many shared profiles the user has. */
export async function countSharedProfiles(
  db: D1Database,
  userId: string,
): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM saml_profiles WHERE user_id = ? AND app_id IS NULL",
    )
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** The profile an app gets for a user, once one was chosen. */
export async function boundProfile(
  db: D1Database,
  appId: string,
  userId: string,
): Promise<SamlProfileRow | null> {
  return db
    .prepare(
      `SELECT p.* FROM saml_profile_apps b
       JOIN saml_profiles p ON p.id = b.profile_id
       WHERE b.app_id = ? AND b.user_id = ?`,
    )
    .bind(appId, userId)
    .first<SamlProfileRow>();
}

/** The user's shared profiles, by name. */
export async function sharedProfiles(
  db: D1Database,
  userId: string,
): Promise<SamlProfileRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM saml_profiles WHERE user_id = ? AND app_id IS NULL
       ORDER BY name COLLATE NOCASE, created_at`,
    )
    .bind(userId)
    .all<SamlProfileRow>();
  return results;
}

/**
 * Bind the profile an app gets for a user, who has none yet: `choice`, a
 * new per-app profile ("new") or the id of one of the user's shared
 * profiles. Returns the bound profile, which is the one another sign-in
 * chose if it got there first; null when `choice` is neither.
 */
export async function bindProfile(
  db: D1Database,
  appId: string,
  userId: string,
  choice: string,
): Promise<SamlProfileRow | null> {
  const now = Math.floor(Date.now() / 1000);
  let made: string | null = null;
  if (choice === "new") {
    made = randomId();
    await db.batch([
      db
        .prepare(
          `INSERT INTO saml_profiles (id, user_id, name_id, app_id, name, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?)`,
        )
        .bind(made, userId, randomId(16), appId, now, now),
      db
        .prepare(
          `INSERT INTO saml_profile_apps (app_id, user_id, profile_id, created_at)
           VALUES (?, ?, ?, ?) ON CONFLICT(app_id, user_id) DO NOTHING`,
        )
        .bind(appId, userId, made, now),
    ]);
  } else {
    // One statement that binds the shared profile only if it's still there:
    // a delete running alongside (which spares profiles in use) either
    // comes first, and this binds nothing, or finds it bound and keeps it.
    await db
      .prepare(
        `INSERT INTO saml_profile_apps (app_id, user_id, profile_id, created_at)
         SELECT ?, ?, id, ? FROM saml_profiles
         WHERE id = ? AND user_id = ? AND app_id IS NULL
         ON CONFLICT(app_id, user_id) DO NOTHING`,
      )
      .bind(appId, userId, now, choice, userId)
      .run();
  }

  // Null when the choice was no shared profile of the user's (and nothing
  // was bound before).
  const bound = await boundProfile(db, appId, userId);
  // Another sign-in chose first: drop the profile made for this one.
  if (made && bound?.id !== made)
    await db.prepare("DELETE FROM saml_profiles WHERE id = ?").bind(made).run();
  return bound;
}

export interface ProfileApp {
  id: string;
  name: string;
  icon_url: string | null;
}

/** One of a user's profiles, with the apps it's used for; null if none. */
export async function getProfile(
  db: D1Database,
  userId: string,
  id: string,
): Promise<(SamlProfileRow & { apps: ProfileApp[] }) | null> {
  const [profile, uses] = await Promise.all([
    db
      .prepare("SELECT * FROM saml_profiles WHERE id = ? AND user_id = ?")
      .bind(id, userId)
      .first<SamlProfileRow>(),
    db
      .prepare(
        `SELECT a.id, a.name, a.icon_url FROM saml_profile_apps b
         JOIN oauth_apps a ON a.id = b.app_id
         WHERE b.profile_id = ? AND b.user_id = ? ORDER BY a.name COLLATE NOCASE`,
      )
      .bind(id, userId)
      .all<ProfileApp>(),
  ]);
  return profile ? { ...profile, apps: uses.results } : null;
}

/** All of a user's profiles, each with the apps it's used for. */
export async function listProfiles(
  db: D1Database,
  userId: string,
): Promise<Array<SamlProfileRow & { apps: ProfileApp[] }>> {
  const [profiles, uses] = await Promise.all([
    db
      .prepare(
        "SELECT * FROM saml_profiles WHERE user_id = ? ORDER BY created_at DESC",
      )
      .bind(userId)
      .all<SamlProfileRow>(),
    db
      .prepare(
        `SELECT b.profile_id, a.id, a.name, a.icon_url FROM saml_profile_apps b
         JOIN oauth_apps a ON a.id = b.app_id
         WHERE b.user_id = ? ORDER BY a.name COLLATE NOCASE`,
      )
      .bind(userId)
      .all<ProfileApp & { profile_id: string }>(),
  ]);
  const byProfile = new Map<string, ProfileApp[]>();
  for (const { profile_id, ...app } of uses.results) {
    const list = byProfile.get(profile_id) ?? [];
    list.push(app);
    byProfile.set(profile_id, list);
  }
  return profiles.results.map((p) => ({
    ...p,
    apps: byProfile.get(p.id) ?? [],
  }));
}
