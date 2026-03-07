-- Allow multiple Prism accounts to link the same social account
-- Removes UNIQUE(provider, provider_user_id); adds UNIQUE(user_id, provider, provider_user_id)
-- so the same Prism user cannot link the same social account twice, but
-- different Prism users may share a social account.

CREATE TABLE social_connections_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at INTEGER,
  profile_data TEXT NOT NULL DEFAULT '{}',
  connected_at INTEGER NOT NULL,
  UNIQUE(user_id, provider, provider_user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO social_connections_new SELECT * FROM social_connections;
DROP TABLE social_connections;
ALTER TABLE social_connections_new RENAME TO social_connections;
