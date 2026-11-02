-- App-defined permission scope metadata and access control rules

-- Metadata (title, description) for each inner scope an app exposes.
-- Shown on the OAuth consent screen in place of bare scope strings.
CREATE TABLE app_scope_definitions (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES oauth_apps(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,           -- inner scope name, e.g. "read_posts"
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(app_id, scope)
);

CREATE INDEX idx_app_scope_defs ON app_scope_definitions(app_id);

-- Access control: which apps or owners may use this app's cross-app scopes.
--
-- rule_type values:
--   owner_allow  — user may register app:<this>:<scope> in their app's allowed_scopes
--   owner_deny   — user may NOT register app:<this>:<scope>
--   app_allow    — client app may request app:<this>:<scope> during OAuth
--   app_deny     — client app may NOT request app:<this>:<scope>
--
-- If any owner_allow rule exists → allowlist mode (unlisted owners denied).
-- If any app_allow rule exists → allowlist mode (unlisted apps denied).
-- Deny rules are always enforced regardless of allow lists.
CREATE TABLE app_scope_access_rules (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES oauth_apps(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL CHECK(rule_type IN ('owner_allow','owner_deny','app_allow','app_deny')),
  target_id TEXT NOT NULL,    -- user_id for owner_*, client_id for app_*
  created_at INTEGER NOT NULL,
  UNIQUE(app_id, rule_type, target_id)
);

CREATE INDEX idx_app_scope_rules ON app_scope_access_rules(app_id);
