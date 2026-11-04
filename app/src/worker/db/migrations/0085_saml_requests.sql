-- SAML AuthnRequests waiting for the user on the sign-in page.
--
-- D1, not KV: answering a request must be a single atomic claim (KV has no
-- compare-and-swap, so two submits could both issue an assertion), and the
-- sign-in page must see a request the moment it was stored.
--
-- token_hash: SHA-256 (hex) of the bearer token in the sign-in page URL.
-- request_id: the AuthnRequest ID, echoed as InResponseTo. One row per SP
--   and ID, kept until it expires even once answered, so a replayed request
--   is refused instead of starting a second sign-in.
-- consumed_at: set by the one answer the request gets.
CREATE TABLE IF NOT EXISTS saml_requests (
  token_hash TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES oauth_apps(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  acs_url TEXT NOT NULL,
  relay_state TEXT,
  name_id_format TEXT,
  force_authn INTEGER NOT NULL DEFAULT 0,
  is_passive INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  UNIQUE (app_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_saml_requests_expires
  ON saml_requests(expires_at);
