-- App access whitelist: restrict OAuth authorization to specified teams/users.
--
-- When an app has access_whitelist_enabled = 1, the OAuth authorize flow
-- checks app_access_rules and rejects anyone who doesn't match at least
-- one rule. Team rules can optionally require a minimum role. User rules
-- accept the specific user unconditionally.

ALTER TABLE oauth_apps ADD COLUMN access_whitelist_enabled INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS app_access_rules (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK(rule_type IN ('team', 'user')),
  target_id TEXT NOT NULL,
  min_role TEXT CHECK(min_role IN ('owner', 'co-owner', 'admin', 'member')),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (app_id) REFERENCES oauth_apps(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_app_access_rules_app ON app_access_rules(app_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_access_rules_unique ON app_access_rules(app_id, rule_type, target_id);
