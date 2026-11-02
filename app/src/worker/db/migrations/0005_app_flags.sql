-- Add is_official and is_first_party flags to oauth_apps
ALTER TABLE oauth_apps ADD COLUMN is_official INTEGER NOT NULL DEFAULT 0;
ALTER TABLE oauth_apps ADD COLUMN is_first_party INTEGER NOT NULL DEFAULT 0;
