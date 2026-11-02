-- RFC 8628 Device Authorization Grant.
--
-- A device with no browser (CLI, TV, IoT) starts a grant at the
-- device_authorization endpoint and receives a device_code plus a short,
-- human-typable user_code. The user opens the verification URI on a second
-- device, enters the user_code, and approves; meanwhile the device polls the
-- token endpoint with its device_code until the grant is approved, denied, or
-- expires.
--
-- device_code is stored as an HMAC-keyed hash (same treatment as authorization
-- codes and tokens) so a D1 leak surrenders no redeemable device codes. The
-- user_code is stored normalized (uppercase, hyphen stripped) and is what the
-- verification page looks the request up by.
CREATE TABLE oauth_device_codes (
  device_code TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '[]',
  -- RFC 8707 resource indicators requested for the issued access token, as a
  -- JSON string[]; NULL when the device requested none.
  resource TEXT,
  -- PKCE is optional for the device flow (public clients may still bind the
  -- exchange). NULL when not supplied.
  code_challenge TEXT,
  code_challenge_method TEXT,
  nonce TEXT,
  -- pending -> approved | denied. Approval also stamps user_id.
  status TEXT NOT NULL DEFAULT 'pending',
  user_id TEXT,
  -- Minimum seconds the device must wait between polls (RFC 8628 §3.5). Raised
  -- when a device polls too fast and is told to slow_down.
  interval INTEGER NOT NULL DEFAULT 5,
  last_polled_at INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_oauth_device_codes_user_code ON oauth_device_codes(user_code);
CREATE INDEX idx_oauth_device_codes_expires_at ON oauth_device_codes(expires_at);
