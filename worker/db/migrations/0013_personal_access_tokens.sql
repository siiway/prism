-- Personal access tokens (PATs) — user-generated long-lived API keys

CREATE TABLE IF NOT EXISTS personal_access_tokens (
  id          TEXT    PRIMARY KEY,
  user_id     TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  token       TEXT    NOT NULL UNIQUE,
  scopes      TEXT    NOT NULL DEFAULT '[]',
  expires_at  INTEGER,
  last_used_at INTEGER,
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pat_token  ON personal_access_tokens(token);
CREATE INDEX IF NOT EXISTS idx_pat_user   ON personal_access_tokens(user_id);
