-- OpenID Connect authentication-method tracking.
--
-- Record how a session authenticated (RFC 8176 auth-method references) so the
-- ID token can emit `amr` and a derived `acr`, and so `prompt`/`max_age` can
-- reason about the authentication. JSON string[] (e.g. ["pwd"], ["pwd","otp"],
-- ["webauthn"]); NULL for sessions created before this column existed. The
-- session's created_at doubles as the `auth_time`.
ALTER TABLE sessions ADD COLUMN amr TEXT;
