-- Individual invite lifecycle controls. Existing invites remain enabled.
ALTER TABLE team_invites ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE site_invites ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
