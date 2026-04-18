-- Audit log for team:* scope grants.
-- Every time a team owner/admin authorizes an app with team-scoped permissions,
-- a row is written here.
CREATE TABLE IF NOT EXISTS team_scope_grants (
  id TEXT PRIMARY KEY,
  grantor_user_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  permissions TEXT NOT NULL, -- JSON array of permission suffixes granted, e.g. ["read","member:read"]
  granted_at INTEGER NOT NULL,
  FOREIGN KEY (grantor_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_team_scope_grants_grantor ON team_scope_grants(grantor_user_id);
CREATE INDEX IF NOT EXISTS idx_team_scope_grants_team ON team_scope_grants(team_id);
