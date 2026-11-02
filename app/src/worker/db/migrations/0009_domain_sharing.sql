-- Allow a domain to be verified on multiple accounts/teams simultaneously.
-- Replaces the table-level UNIQUE(user_id, domain) with two partial unique indexes:
--   • personal: UNIQUE(user_id, domain) WHERE team_id IS NULL
--   • team:     UNIQUE(team_id, domain) WHERE team_id IS NOT NULL  (already from 0008)
-- Also adds created_by to track who added a team domain.

ALTER TABLE domains ADD COLUMN created_by TEXT REFERENCES users(id) ON DELETE SET NULL;

-- Back-fill created_by = user_id for existing team domains
UPDATE domains SET created_by = user_id WHERE team_id IS NOT NULL;

-- Recreate table without the UNIQUE(user_id, domain) table constraint
CREATE TABLE domains_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_by TEXT,
  app_id TEXT,
  team_id TEXT,
  domain TEXT NOT NULL,
  verification_token TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  verified_at INTEGER,
  next_reverify_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (app_id) REFERENCES oauth_apps(id) ON DELETE SET NULL
);

INSERT INTO domains_new
  SELECT id, user_id, created_by, app_id, team_id, domain,
         verification_token, verified, verified_at, next_reverify_at, created_at
  FROM domains;

DROP TABLE domains;
ALTER TABLE domains_new RENAME TO domains;

-- Partial unique indexes
CREATE UNIQUE INDEX idx_domains_personal_unique ON domains(user_id, domain) WHERE team_id IS NULL;
CREATE UNIQUE INDEX idx_domains_team_unique     ON domains(team_id, domain) WHERE team_id IS NOT NULL;
CREATE INDEX idx_domains_user_id ON domains(user_id);
CREATE INDEX idx_domains_team_id ON domains(team_id) WHERE team_id IS NOT NULL;
