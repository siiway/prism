-- Webhooks — admin and user-configurable event delivery endpoints

CREATE TABLE IF NOT EXISTS webhooks (
  id          TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL,
  url         TEXT    NOT NULL,
  secret      TEXT    NOT NULL,
  events      TEXT    NOT NULL DEFAULT '[]', -- JSON string[]
  is_active   INTEGER NOT NULL DEFAULT 1,
  -- NULL = admin-scope webhook (fires on admin audit events)
  -- non-NULL = user-scope webhook (fires on events triggered by that user)
  user_id     TEXT,
  created_by  TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              TEXT    PRIMARY KEY,
  webhook_id      TEXT    NOT NULL,
  event_type      TEXT    NOT NULL,
  payload         TEXT    NOT NULL, -- JSON
  response_status INTEGER,
  response_body   TEXT,
  success         INTEGER NOT NULL DEFAULT 0,
  delivered_at    INTEGER NOT NULL,
  FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_webhook_user       ON webhooks(user_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries ON webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_delivered  ON webhook_deliveries(delivered_at);
