-- Add email_verify_code for inbound email verification
-- Users send an email TO verify-<code>@<domain> to prove ownership
ALTER TABLE users ADD COLUMN email_verify_code TEXT;
