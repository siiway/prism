CREATE TABLE IF NOT EXISTS login_errors (
  id          TEXT    PRIMARY KEY,
  error_code  TEXT    NOT NULL,
  identifier  TEXT,
  ip_address  TEXT,
  user_agent  TEXT,
  metadata    TEXT    NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_errors_created_at ON login_errors (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_errors_ip         ON login_errors (ip_address);
