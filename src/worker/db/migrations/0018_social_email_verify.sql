-- Track how and when email was verified (for social-provider auto-verification with TTL)
ALTER TABLE users ADD COLUMN email_verified_via TEXT;
ALTER TABLE users ADD COLUMN email_verified_at INTEGER;
