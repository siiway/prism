-- Strongly consistent state for security decisions that must be atomic.
--
-- Cloudflare KV is eventually consistent and has no compare-and-swap. It is
-- therefore unsuitable for admitting rate-limited requests or consuming a
-- one-time JWT identifier: concurrent requests can all read the same old
-- value before any write becomes visible. These D1 tables make admission and
-- consumption single SQL write decisions on D1's primary.

-- DPoP and private_key_jwt replay claims. The primary key is a SHA-256 digest
-- of the claim type, principal, and jti, so attacker-controlled identifiers
-- are not stored verbatim and index entries remain bounded.
CREATE TABLE security_replay_claims (
  claim_hash TEXT PRIMARY KEY,
  claim_type TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_security_replay_claims_expires
  ON security_replay_claims(expires_at);

-- Keep active deployments self-cleaning even where cron is disabled. Each
-- new claim removes a bounded batch, so cleanup work is predictable and can
-- keep pace with insertion without being correctness-critical.
CREATE TRIGGER cleanup_security_replay_claims
AFTER INSERT ON security_replay_claims
BEGIN
  DELETE FROM security_replay_claims
   WHERE claim_hash IN (
     SELECT claim_hash FROM security_replay_claims
      WHERE expires_at <= NEW.created_at
      ORDER BY expires_at
      LIMIT 100
   );
END;

-- Exact sliding-window rate-limit hits. Admission is an INSERT ... SELECT
-- whose SELECT counts the active rows for the bucket; concurrent writes are
-- serialized, so at most the configured limit can be inserted.
CREATE TABLE rate_limit_hits (
  id TEXT PRIMARY KEY,
  bucket_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_rate_limit_hits_bucket_created
  ON rate_limit_hits(bucket_hash, created_at);

CREATE INDEX idx_rate_limit_hits_expires
  ON rate_limit_hits(expires_at);

CREATE TRIGGER cleanup_rate_limit_hits
AFTER INSERT ON rate_limit_hits
BEGIN
  DELETE FROM rate_limit_hits
   WHERE id IN (
     SELECT id FROM rate_limit_hits
      WHERE expires_at <= NEW.created_at
      ORDER BY expires_at
      LIMIT 100
   );
END;
