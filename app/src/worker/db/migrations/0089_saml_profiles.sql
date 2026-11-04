-- SAML profiles: the identity a user presents to SAML apps, sent as the
-- persistent NameID and the uid attribute.
--
-- SAML Core §8.3.7 has persistent NameIDs be pseudo-random, with no
-- discernible link to the user's real identifier. By default each app gets
-- its own profile, made at the first sign-in, so apps can't match people
-- across each other. A user may instead choose a shared profile, which
-- presents the same ID to every app they pick it for.
--
-- saml_profiles:
--   name_id: the ID apps receive: random, and never changes.
--   app_id: the app a per-app profile was made for; NULL for a shared one.
--     Converting a per-app profile to a shared one clears it and keeps the
--     ID, so the app goes on seeing the same user.
--   name: a shared profile's name, chosen by the user; NULL for per-app.
CREATE TABLE IF NOT EXISTS saml_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name_id TEXT NOT NULL UNIQUE,
  app_id TEXT REFERENCES oauth_apps(id) ON DELETE CASCADE,
  name TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saml_profiles_user ON saml_profiles(user_id);
-- For the cascade when an app is deleted.
CREATE INDEX IF NOT EXISTS idx_saml_profiles_app ON saml_profiles(app_id);

-- The profile each app gets for a user: one per app and user, chosen at the
-- first sign-in and kept (revoking the app included).
CREATE TABLE IF NOT EXISTS saml_profile_apps (
  app_id TEXT NOT NULL REFERENCES oauth_apps(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES saml_profiles(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (app_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_saml_profile_apps_profile
  ON saml_profile_apps(profile_id);
-- A user's profiles with their apps, and the cascade when a user is deleted.
CREATE INDEX IF NOT EXISTS idx_saml_profile_apps_user
  ON saml_profile_apps(user_id);
