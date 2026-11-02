-- Single-use tracking for proof-of-work challenges. Without this, a solved
-- (challenge, nonce) pair could be replayed indefinitely against any
-- captcha-gated endpoint, defeating the rate-limit purpose entirely.
--
-- challenge_id is the random 16-byte payload nonce of an HMAC-signed
-- challenge (see worker/lib/pow.ts). Storing only the nonce keeps the row
-- small; the rest of the challenge is reconstructable / unnecessary for
-- replay detection.
--
-- expires_at is the original challenge expiry (Unix seconds). The cron
-- sweep prunes rows past their expiry — older ones can't be replayed
-- anyway since the HMAC verifier rejects expired challenges.
CREATE TABLE IF NOT EXISTS pow_used (
  challenge_id BLOB PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pow_used_expires_at ON pow_used(expires_at);
