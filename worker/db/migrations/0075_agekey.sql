-- AgeKey age assurance.
--
-- `age_verifications` is the user's current result: which thresholds they
-- meet, plus the AgeKey session id (`sub`) kept for later invalidation
-- auditing. `source` is `agekey` for a signed token or `admin` for an
-- operator override. One row per user; a newer check replaces it. No date
-- of birth.
--
-- `agekey_flows` is the single-use OIDC state/nonce for the redirect.
-- `require_min_age` is 0 (off) or one of 13, 16, 18, 21.

ALTER TABLE teams ADD COLUMN require_min_age INTEGER NOT NULL DEFAULT 0;

CREATE TABLE age_verifications (
  user_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  thresholds TEXT NOT NULL,
  verified_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'agekey',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_age_verifications_session
  ON age_verifications(session_id);

CREATE TABLE agekey_flows (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  claims_json TEXT NOT NULL,
  client_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_agekey_flows_user ON agekey_flows(user_id);
CREATE INDEX idx_agekey_flows_expires ON agekey_flows(expires_at);
