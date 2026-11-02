-- Browser-bound, single-use state for social OAuth and Telegram login flows.
-- D1 provides strongly consistent, atomic DELETE ... RETURNING consumption;
-- only a SHA-256 hash of the browser correlation cookie is stored. Invite
-- bearer handoffs are AES-GCM ciphertext under that browser-only secret.
CREATE TABLE social_oauth_states (
  state                   TEXT    PRIMARY KEY,
  slug                    TEXT    NOT NULL,
  provider                TEXT    NOT NULL,
  mode                    TEXT    NOT NULL CHECK (mode IN ('login', 'connect')),
  user_id                 TEXT,
  session_id              TEXT,
  correlation_hash        TEXT    NOT NULL,
  code_verifier           TEXT,
  invite_token_ciphertext TEXT,
  expires_at              INTEGER NOT NULL,
  created_at              INTEGER NOT NULL,
  CHECK (
    (mode = 'login' AND user_id IS NULL AND session_id IS NULL) OR
    (mode = 'connect' AND user_id IS NOT NULL AND session_id IS NOT NULL)
  )
);

CREATE INDEX idx_social_oauth_states_expires
  ON social_oauth_states(expires_at);
