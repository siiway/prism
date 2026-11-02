-- Transparent Control audit logs and scoped audit webhooks.
--
-- Three scopes share one table, distinguished by (scope, scope_id):
--   user     — scope_id = the user's id     (visible to that user)
--   team     — scope_id = the team's id      (visible to owner / co-owner)
--   platform — scope_id = NULL               (visible to platform admins)
--
-- The legacy instance/user webhook tables (webhooks, webhook_deliveries) are
-- intentionally left in place so the admin danger-zone migration can read
-- them; their routes and UI have been removed.

CREATE TABLE IF NOT EXISTS audit_events (
  id            TEXT    PRIMARY KEY,
  scope         TEXT    NOT NULL,           -- 'user' | 'team' | 'platform'
  scope_id      TEXT,                       -- user_id / team_id / NULL
  action        TEXT    NOT NULL,           -- e.g. 'user.login', 'team.member.add'
  actor_id      TEXT,                       -- user id that performed the action
  actor_name    TEXT,                       -- resolved display snapshot
  resource_type TEXT,                       -- e.g. 'user','team','app','domain'
  resource_id   TEXT,
  resource_name TEXT,                       -- resolved display snapshot
  ip            TEXT,                       -- full request IP
  user_agent    TEXT,                       -- full request User-Agent
  metadata      TEXT    NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_scope
  ON audit_events(scope, scope_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(action);
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events(actor_id);

CREATE TABLE IF NOT EXISTS audit_webhooks (
  id          TEXT    PRIMARY KEY,
  scope       TEXT    NOT NULL,             -- 'user' | 'team' | 'platform'
  scope_id    TEXT,                         -- user_id / team_id / NULL
  name        TEXT    NOT NULL,
  kind        TEXT    NOT NULL,             -- 'discord' | 'telegram' | 'general'
  config      TEXT    NOT NULL DEFAULT '{}',-- encrypted JSON blob
  events      TEXT    NOT NULL DEFAULT '["*"]', -- JSON string[] of action filters
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_by  TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_webhooks_scope
  ON audit_webhooks(scope, scope_id);
