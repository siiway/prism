-- SAML Single Logout.
--
-- saml_service_providers.slo_url: the SP's SingleLogoutService URL, where
--   Prism sends LogoutRequests and LogoutResponses; null when the SP has no
--   single logout. slo_binding: 'redirect' or 'post'.
ALTER TABLE saml_service_providers ADD COLUMN slo_url TEXT;
ALTER TABLE saml_service_providers ADD COLUMN slo_binding TEXT NOT NULL DEFAULT 'redirect';

-- The SPs a Prism session signed in to, so signing out can reach them. One
-- row per session and app, holding the NameID and SessionIndex of the latest
-- assertion. Rows go with the session.
CREATE TABLE IF NOT EXISTS saml_sessions (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL REFERENCES oauth_apps(id) ON DELETE CASCADE,
  name_id TEXT NOT NULL,
  name_id_format TEXT NOT NULL,
  session_index TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, app_id)
);

CREATE INDEX IF NOT EXISTS idx_saml_sessions_app ON saml_sessions(app_id);

-- A browser sign-out in progress: the browser visits each SP in turn, and
-- the one that started it (if an SP did) gets the LogoutResponse at the end.
--
-- token_hash: SHA-256 (hex) of the token in the /logout page URL, also sent
--   to SPs as RelayState so their LogoutResponses find the row.
-- origin_app_id: the app that asked for the sign-out (an SP, or an OIDC
--   client through end_session); null when the user signed out of Prism.
-- origin_request_id, origin_relay_state, origin_name_id: an SP's
--   LogoutRequest, to answer; origin_name_id is who it asked to sign out,
--   checked against the browser's session once the page reaches it.
-- started: 0 while waiting for the /logout page, a same-site request, to
--   check the session and have the user confirm; then 1.
-- pending: JSON list of SPs still to visit.
-- current_*: the SP visited now, and the ID of the LogoutRequest it got.
-- status: 'Success', 'PartialLogout' (an SP didn't confirm),
--   'UnknownPrincipal' (the request named someone else) or 'RequestDenied'
--   (the user chose to stay signed in).
-- finish_url: where the browser ends up when no SP started the logout.
--   A relative path is on Prism; an absolute URL is a registered
--   post_logout_redirect_uri.
CREATE TABLE IF NOT EXISTS saml_logouts (
  token_hash TEXT PRIMARY KEY,
  origin_app_id TEXT REFERENCES oauth_apps(id) ON DELETE CASCADE,
  origin_request_id TEXT,
  origin_relay_state TEXT,
  origin_name_id TEXT,
  started INTEGER NOT NULL DEFAULT 0,
  pending TEXT NOT NULL DEFAULT '[]',
  current_app_id TEXT,
  current_request_id TEXT,
  status TEXT NOT NULL DEFAULT 'Success',
  finish_url TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saml_logouts_expires
  ON saml_logouts(expires_at);
