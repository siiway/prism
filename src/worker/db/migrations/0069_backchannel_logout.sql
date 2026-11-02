-- OpenID Connect Back-Channel Logout.
--
-- oauth_apps.backchannel_logout_uri: where to POST a signed logout_token when
--   the user signs out. NULL disables back-channel logout for the client.
-- oauth_codes.session_id: the authenticating session, so the ID token can carry
--   the `sid` claim and a logout_token can name the session that ended.
ALTER TABLE oauth_apps ADD COLUMN backchannel_logout_uri TEXT;
ALTER TABLE oauth_codes ADD COLUMN session_id TEXT;
