-- Replace single totp_secrets with multi-authenticator support

CREATE TABLE totp_authenticators (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Authenticator',
  secret TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE user_totp_recovery (
  user_id TEXT PRIMARY KEY,
  backup_codes TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Migrate existing data
INSERT INTO totp_authenticators (id, user_id, name, secret, enabled, created_at)
SELECT lower(hex(randomblob(16))), user_id, 'Authenticator', secret, enabled, created_at
FROM totp_secrets;

INSERT INTO user_totp_recovery (user_id, backup_codes, updated_at)
SELECT user_id, backup_codes, created_at
FROM totp_secrets
WHERE enabled = 1 AND backup_codes != '[]';

DROP TABLE totp_secrets;
