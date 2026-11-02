-- Team invite tokens (share link + email invites)
CREATE TABLE IF NOT EXISTS team_invites (
  token TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_by TEXT NOT NULL,
  email TEXT,            -- null = shareable link, set = email-specific
  max_uses INTEGER NOT NULL DEFAULT 0,  -- 0 = unlimited
  uses INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_team_invites_team ON team_invites(team_id);
