-- App-level notification channels: webhooks, SSE/WebSocket event queue

CREATE TABLE app_webhooks (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES oauth_apps(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '["*"]',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_app_webhooks_app ON app_webhooks(app_id);

CREATE TABLE app_webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL REFERENCES app_webhooks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  response_status INTEGER,
  response_body TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  delivered_at INTEGER NOT NULL
);

CREATE INDEX idx_app_webhook_deliveries ON app_webhook_deliveries(webhook_id);

-- Durable SSE/WebSocket event queue.
-- INTEGER PRIMARY KEY = SQLite rowid alias (auto-increment, used as cursor).
CREATE TABLE app_event_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_app_event_queue ON app_event_queue(app_id, id);
