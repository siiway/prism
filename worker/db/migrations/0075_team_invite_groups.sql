-- Member groups assigned when a team invite is accepted.
--
-- The team_id column lets SQLite enforce that an invite can only reference a
-- group from the same team. It is repeated deliberately for that constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_invites_token_team
  ON team_invites(token, team_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_groups_id_team
  ON team_groups(id, team_id);

CREATE TABLE IF NOT EXISTS team_invite_groups (
  invite_token TEXT NOT NULL,
  team_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  PRIMARY KEY (invite_token, group_id),
  FOREIGN KEY (invite_token, team_id)
    REFERENCES team_invites(token, team_id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (group_id, team_id)
    REFERENCES team_groups(id, team_id) ON DELETE CASCADE
);

ALTER TABLE team_invites
  ADD COLUMN allow_existing_members INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_team_invite_groups_team
  ON team_invite_groups(team_id);

-- Snapshot the selected groups for a pending invite-link registration. The
-- invite may be revoked before the registrant finishes their security setup;
-- revocation must block new claims without changing what an already-created
-- pending account will receive.
CREATE TABLE IF NOT EXISTS pending_invite_member_groups (
  user_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  PRIMARY KEY (user_id, group_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id, team_id)
    REFERENCES team_groups(id, team_id) ON DELETE CASCADE
);
