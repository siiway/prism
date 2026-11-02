-- Opt-in flag for ML-DSA-65 JWT access tokens.
-- Default 0 keeps existing apps on opaque tokens (backward compatible).
ALTER TABLE oauth_apps ADD COLUMN use_jwt_tokens INTEGER NOT NULL DEFAULT 0;
