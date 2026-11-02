-- Alternate emails for users
-- users.email remains the primary; this table stores additional addresses.
CREATE TABLE IF NOT EXISTS user_emails (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  verified INTEGER NOT NULL DEFAULT 0,
  verify_token TEXT,
  verify_code TEXT,
  verified_via TEXT,
  verified_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_emails_user_id ON user_emails(user_id);
CREATE INDEX IF NOT EXISTS idx_user_emails_email ON user_emails(email);

ALTER TABLE users ADD COLUMN alt_email_login INTEGER;
