-- Generic OAuth 2 and OpenID Connect provider support
-- Adds per-source URL columns (used when provider = "oidc" or "oauth2")

ALTER TABLE oauth_sources ADD COLUMN auth_url     TEXT;
ALTER TABLE oauth_sources ADD COLUMN token_url    TEXT;
ALTER TABLE oauth_sources ADD COLUMN userinfo_url TEXT;
ALTER TABLE oauth_sources ADD COLUMN scopes       TEXT;
ALTER TABLE oauth_sources ADD COLUMN issuer_url   TEXT;
