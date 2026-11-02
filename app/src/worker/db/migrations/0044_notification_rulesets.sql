-- Notification rulesets — user-defined rule engine for routing events.
--
-- The legacy `user_notification_prefs.notification_rules` model maps each
-- event type to a flat list of (channel, level) tuples. That's fine for
-- "send security.totp_enabled to my work email" but can't express:
--   • "send anything matching security.* to two channels"
--   • "drop app.updated unless it's during business hours"
--   • "fan-out one event to email AND telegram with different levels"
--
-- A ruleset is an ORDERED list of rules. Each rule has:
--   • a match (currently just an event glob: "*", "security.*", "app.created")
--   • an action: send to N channels at given levels, OR drop the event
--   • an optional `stop: true` that halts evaluation after this rule fires
--
-- Channels accumulate across all matching rules; duplicate (kind,id)
-- pairs collapse to the highest level (full > brief). A drop empties any
-- channels matched by an earlier rule for that event.
--
-- One ruleset per user can be `is_active = 1` at a time. When an active
-- ruleset exists it REPLACES the legacy notification_rules path for
-- dispatch. A user with no active ruleset keeps the existing per-event
-- behaviour intact.
--
-- (user_id, name) is unique so a user can't accidentally end up with two
-- "Default" entries from a double-click. Names are case-sensitive — the
-- user typed them, we store them verbatim.
CREATE TABLE IF NOT EXISTS notification_rulesets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  -- JSON array of NotificationRule objects (see lib/notificationRules.ts).
  rules TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_notification_rulesets_user
  ON notification_rulesets(user_id);
-- Partial index keyed only on the active ruleset row (at most one per
-- user) so dispatch can short-circuit with `WHERE user_id = ? AND is_active = 1`.
CREATE INDEX IF NOT EXISTS idx_notification_rulesets_active
  ON notification_rulesets(user_id) WHERE is_active = 1;
