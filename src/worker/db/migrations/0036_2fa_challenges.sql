-- Server-initiated 2FA step-up challenges. Apps create these by calling
-- POST /api/oauth/2fa/challenges (authenticated with client credentials, or
-- with a PKCE code_challenge for public clients) and redirect the user with
-- only the opaque challenge_id. A phisher who only controls a URL cannot
-- inject arbitrary action text or pick an arbitrary redirect URI: those are
-- fixed at the server-to-server step and the phisher cannot reach that step
-- without the app's credentials.
CREATE TABLE IF NOT EXISTS oauth_2fa_challenges (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  action TEXT,
  nonce TEXT,
  code_challenge TEXT,
  code_challenge_method TEXT,
  consumed_at INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_2fa_challenges_expires_at ON oauth_2fa_challenges(expires_at);
