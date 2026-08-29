-- Carry the authenticating session's context on the authorization code so the
-- ID token minted at the token endpoint can emit OIDC `auth_time` / `amr` /
-- (derived) `acr`. Captured at consent time from the user's session; NULL when
-- unknown.
ALTER TABLE oauth_codes ADD COLUMN auth_time INTEGER;
ALTER TABLE oauth_codes ADD COLUMN amr TEXT;
