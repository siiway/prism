-- User email notification preferences

CREATE TABLE IF NOT EXISTS user_notification_prefs (
  user_id   TEXT PRIMARY KEY,
  events    TEXT NOT NULL DEFAULT '[]', -- JSON string[] of subscribed event types
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
