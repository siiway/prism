-- Request log storage for the admin log viewer
-- Only written when logging is enabled via KV system:request_logging_enabled
CREATE TABLE IF NOT EXISTS request_logs (
  id          TEXT    PRIMARY KEY,
  method      TEXT    NOT NULL,
  path        TEXT    NOT NULL,
  status      INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  ip_address  TEXT,
  user_agent  TEXT,
  user_id     TEXT,   -- set when request is authenticated
  details     TEXT,   -- JSON blob written only in spectate mode
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON request_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_logs_status     ON request_logs (status);
CREATE INDEX IF NOT EXISTS idx_request_logs_user_id    ON request_logs (user_id);
