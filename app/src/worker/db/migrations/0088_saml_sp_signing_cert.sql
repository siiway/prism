-- Signed SAML logout messages.
--
-- saml_service_providers.signing_cert: base64 DER of the X.509 certificate
--   the SP signs with (from its metadata); null when none is on file. With
--   one, the SP's LogoutRequests must carry a valid signature, and so must
--   its LogoutResponses for the logout to count as confirmed.
ALTER TABLE saml_service_providers ADD COLUMN signing_cert TEXT;

-- saml_logouts.verified: 1 when the SP's LogoutRequest that started it was
--   signed with that certificate; the user then isn't asked to confirm.
ALTER TABLE saml_logouts ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
