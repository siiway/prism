-- GPG public keys for authentication
CREATE TABLE user_gpg_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,   -- 40-char lowercase hex
  key_id TEXT NOT NULL,        -- last 16 chars of fingerprint
  name TEXT NOT NULL,          -- user-provided label
  public_key TEXT NOT NULL,    -- armored ASCII public key block
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  UNIQUE(user_id, fingerprint)
);
CREATE INDEX idx_gpg_keys_user ON user_gpg_keys(user_id);
