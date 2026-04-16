-- Telegram notification preferences per user

ALTER TABLE user_notification_prefs ADD COLUMN tg_events TEXT NOT NULL DEFAULT '[]';
