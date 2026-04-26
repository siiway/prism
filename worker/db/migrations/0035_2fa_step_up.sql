-- Step-up 2FA challenges. Apps redirect users to /oauth/2fa to confirm a
-- sensitive action with TOTP/passkey; on success a single-use code is
-- delivered back to the app's redirect URI and exchanged via /api/oauth/2fa/verify.
CREATE TABLE IF NOT EXISTS oauth_2fa_codes (
  code TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  action TEXT,
  nonce TEXT,
  method TEXT NOT NULL, -- 'totp' | 'passkey' | 'backup'
  code_challenge TEXT,
  code_challenge_method TEXT,
  used_at INTEGER,
  expires_at INTEGER NOT NULL,
  verified_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_oauth_2fa_codes_expires_at ON oauth_2fa_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_2fa_codes_user ON oauth_2fa_codes(user_id);
