-- Other apps' permissions for apps that sign people in with SAML.
--
-- SAML carries no access token, so an app that holds other apps'
-- permissions (app:<client_id>:<scope>) trades the assertion it just
-- received for one at the token endpoint (RFC 7522). Each such assertion is
-- recorded as it's issued, with what the user approved; it can be traded
-- once, by the app it was issued to, until it expires.
--
--   subject: the user's ID at the app (their SAML profile's ID, the uid
--     attribute), which the access token shows the app instead of the
--     Prism user ID.
--   scopes: JSON string[], the other apps' permissions the user approved.
CREATE TABLE IF NOT EXISTS saml_assertion_grants (
  app_id TEXT NOT NULL REFERENCES oauth_apps(id) ON DELETE CASCADE,
  assertion_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  scopes TEXT NOT NULL,
  auth_time INTEGER,
  amr TEXT,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  PRIMARY KEY (app_id, assertion_id)
);

CREATE INDEX IF NOT EXISTS idx_saml_assertion_grants_expires
  ON saml_assertion_grants(expires_at);

-- The ID the token's own client knows the user by, when that isn't the
-- Prism user ID: a SAML app's ID for them. NULL for every other token.
ALTER TABLE oauth_tokens ADD COLUMN subject TEXT;
