-- RFC 9470 step-up: carry the authentication context on the token so a
-- resource server can read acr / auth_time / amr and, when it needs a stronger
-- authentication, challenge for it. JWT access tokens also carry these as
-- claims; the columns let opaque-token introspection and resource checks read
-- them too. Copied from the authorization code at issuance; NULL when unknown.
ALTER TABLE oauth_tokens ADD COLUMN auth_time INTEGER;
ALTER TABLE oauth_tokens ADD COLUMN amr TEXT;
