-- Invalidate all browser sessions whose JWT may have been exposed in an API
-- response body or social callback URL before sessions became cookie-only.
DELETE FROM sessions;
