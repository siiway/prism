-- Per-source trust flag. When 0, a social login through this source is
-- treated as "identity asserted but not fully trusted": if the target
-- Prism account has TOTP enrolled, the user must pass a TOTP challenge
-- before a session is issued. Trusted sources keep the fast path.
-- Existing rows default to 1 (trusted) so behaviour is unchanged
-- after migrate.
ALTER TABLE oauth_sources ADD COLUMN trusted INTEGER NOT NULL DEFAULT 1;
