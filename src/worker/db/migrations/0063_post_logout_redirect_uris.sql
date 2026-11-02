-- OpenID Connect RP-Initiated Logout: per-app allow-list of post-logout
-- redirect URIs.
--
-- end_session_endpoint sends the user back to post_logout_redirect_uri only
-- when that exact value is registered here, so the logout endpoint cannot be
-- turned into an open redirect. Stored as a JSON string[] of exact-match URIs;
-- empty by default (logout then lands on the built-in signed-out page).
ALTER TABLE oauth_apps
  ADD COLUMN post_logout_redirect_uris TEXT NOT NULL DEFAULT '[]';
