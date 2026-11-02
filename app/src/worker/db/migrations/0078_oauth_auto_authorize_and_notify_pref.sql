-- Migration 0078: Add auto_authorize to oauth_consents and notify_on_auto_authorization to users
ALTER TABLE oauth_consents ADD COLUMN auto_authorize INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN notify_on_auto_authorization INTEGER NOT NULL DEFAULT 0;
