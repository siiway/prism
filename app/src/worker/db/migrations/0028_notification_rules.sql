-- Per-event routing rules replacing the flat events/tg_events columns.
-- notification_rules is a JSON Record<event, { email?: { email_id, level } | null, tg?: { connection_id } | null }>
-- email_id is "primary" or a UUID from user_emails.
-- connection_id is a UUID from social_connections.

ALTER TABLE user_notification_prefs ADD COLUMN notification_rules TEXT NOT NULL DEFAULT '{}';
