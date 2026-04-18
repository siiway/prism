ALTER TABLE oauth_apps ADD COLUMN optional_scopes TEXT NOT NULL DEFAULT '[]';
