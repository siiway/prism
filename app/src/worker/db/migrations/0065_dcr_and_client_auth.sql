-- Dynamic Client Registration (RFC 7591/7592) and JWT client authentication
-- (RFC 7523 private_key_jwt).
--
-- registration_access_token: HMAC-keyed hash of the token that authenticates
--   RFC 7592 management (GET/PUT/DELETE) of a dynamically-registered client.
--   NULL for clients created through the dashboard.
-- token_endpoint_auth_method: the RFC 7591 metadata value the client registered
--   with (client_secret_basic | client_secret_post | private_key_jwt | none).
--   NULL means "infer from is_public / client_secret" (dashboard-created apps).
-- jwks / jwks_uri: the client's public keys for verifying a private_key_jwt
--   client_assertion. `jwks` is an inline JWK Set (JSON); `jwks_uri` is fetched.
ALTER TABLE oauth_apps ADD COLUMN registration_access_token TEXT;
ALTER TABLE oauth_apps ADD COLUMN token_endpoint_auth_method TEXT;
ALTER TABLE oauth_apps ADD COLUMN jwks TEXT;
ALTER TABLE oauth_apps ADD COLUMN jwks_uri TEXT;
