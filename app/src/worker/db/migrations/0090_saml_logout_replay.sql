-- Signed LogoutRequests an SP sent, by ID, so each one is used once.
--
-- A LogoutRequest signed with the SP's certificate on file signs the user
-- out without asking (see 0088). It counts while fresh (issued within the
-- last few minutes), and with the HTTP-Redirect binding it sits in a URL,
-- in browser history and logs. Remembering its ID until it is no longer
-- fresh keeps anyone who finds that URL from signing the user out again.
CREATE TABLE IF NOT EXISTS saml_logout_requests (
  app_id TEXT NOT NULL REFERENCES oauth_apps(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (app_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_saml_logout_requests_expires
  ON saml_logout_requests(expires_at);
