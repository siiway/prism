-- Add team_id to domains so teams can own verified domains
ALTER TABLE domains ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE CASCADE;

-- Unique index for team-scoped domains (team_id, domain)
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_domains_unique ON domains(team_id, domain) WHERE team_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_domains_team_id ON domains(team_id) WHERE team_id IS NOT NULL;
