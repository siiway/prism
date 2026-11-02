-- Add oidc_fields to oauth_apps
-- JSON string[] of extra claim names to include in ID tokens (e.g. ["teams","domains"])
ALTER TABLE oauth_apps ADD COLUMN oidc_fields TEXT NOT NULL DEFAULT '[]';
