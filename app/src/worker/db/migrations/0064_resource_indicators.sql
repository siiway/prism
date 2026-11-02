-- RFC 8707 Resource Indicators: remember the resource(s) a grant was issued
-- for so the access token's audience can be restricted to them.
--
-- Stored as a JSON string[] of absolute-URI resource identifiers (NULL when
-- the client asked for none). Kept on the authorization code so the value
-- survives to token-mint time, and on the token row so a refresh preserves the
-- same audience without the client having to re-send it.
ALTER TABLE oauth_codes ADD COLUMN resource TEXT;
ALTER TABLE oauth_tokens ADD COLUMN resource TEXT;
