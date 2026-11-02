-- Audit log for site:* scope grants.
-- Every time a site admin authorizes an app with site-level scopes, a row is written here.
CREATE TABLE IF NOT EXISTS site_scope_grants (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL,
  grantee_user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  scopes TEXT NOT NULL, -- JSON array of granted site:* scopes
  granted_at INTEGER NOT NULL,
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (grantee_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_site_scope_grants_admin ON site_scope_grants(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_site_scope_grants_grantee ON site_scope_grants(grantee_user_id);
