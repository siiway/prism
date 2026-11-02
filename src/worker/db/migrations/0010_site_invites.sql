-- Site-level invites for invite-only registration mode

CREATE TABLE site_invites (
  id          TEXT    PRIMARY KEY,
  token       TEXT    NOT NULL UNIQUE,
  email       TEXT,                    -- if set, only this email may use the invite
  note        TEXT,                    -- optional admin note (e.g. "for Alice")
  max_uses    INTEGER,                 -- NULL = unlimited
  use_count   INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER,                 -- NULL = never expires
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_site_invites_token ON site_invites(token);
