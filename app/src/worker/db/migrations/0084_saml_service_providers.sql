-- SAML 2.0: an app can also be a SAML service provider. Prism is the
-- identity provider; this row is the SP side of one app.
--
-- entity_id: the SP's entity ID, which arrives as the AuthnRequest Issuer.
-- acs_urls: JSON string[] of Assertion Consumer Service URLs (HTTP-POST);
--   a request may only name one of these, and the first is the default.
-- name_id_format: 'persistent' (the Prism user ID) or 'email'.
-- sign: what gets signed — 'assertion', 'response' or 'both'.
CREATE TABLE IF NOT EXISTS saml_service_providers (
  app_id TEXT PRIMARY KEY REFERENCES oauth_apps(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL UNIQUE,
  acs_urls TEXT NOT NULL,
  name_id_format TEXT NOT NULL DEFAULT 'persistent',
  sign TEXT NOT NULL DEFAULT 'assertion',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
