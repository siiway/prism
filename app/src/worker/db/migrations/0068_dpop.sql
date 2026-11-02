-- DPoP (RFC 9449): sender-constrained tokens.
--
-- oauth_tokens.dpop_jkt is the JWK SHA-256 thumbprint (RFC 7638) an access /
-- refresh token is bound to. NULL for ordinary Bearer tokens. A DPoP-bound
-- token is only accepted alongside a DPoP proof signed by the matching key.
ALTER TABLE oauth_tokens ADD COLUMN dpop_jkt TEXT;
