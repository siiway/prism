-- Opt-in flag: allow an app to manage its own *exported* permission scopes
-- (app_scope_definitions) using its own client credentials (HTTP Basic),
-- without requiring a user token. Scoped to the app's own namespace only.
-- Default 0 preserves existing behavior (a user with write access must manage
-- the app's exported scope definitions).
ALTER TABLE oauth_apps ADD COLUMN allow_self_manage_exported_permissions INTEGER NOT NULL DEFAULT 0;
