-- Per-user override for OAuth access/refresh token TTLs.
-- NULL = use site default (config.access_token_ttl_minutes / refresh_token_ttl_days).
-- Users may pick any value; no upper cap is enforced.
ALTER TABLE users ADD COLUMN access_token_ttl_minutes INTEGER;
ALTER TABLE users ADD COLUMN refresh_token_ttl_days INTEGER;
