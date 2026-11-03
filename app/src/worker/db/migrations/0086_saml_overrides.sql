-- Site-admin overrides of the saml_enabled site setting. NULL follows the
-- level above, 1 allows SAML, 0 stops it. An app's override beats its
-- owner's, which beats the site setting. users covers teams too: a team
-- owns its apps through its kind='team' user row.
ALTER TABLE users ADD COLUMN saml_override INTEGER;
ALTER TABLE oauth_apps ADD COLUMN saml_override INTEGER;
