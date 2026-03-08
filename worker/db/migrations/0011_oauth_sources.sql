-- Named OAuth sources: multiple configured sources of the same provider kind
-- (e.g. "GitHub (Work)" and "GitHub (Personal)" both backed by the "github" provider)

CREATE TABLE oauth_sources (
  id            TEXT    PRIMARY KEY,
  slug          TEXT    NOT NULL UNIQUE,  -- used in URL: /api/connections/:slug/begin
  provider      TEXT    NOT NULL,         -- base type: "github"|"google"|"microsoft"|"discord"
  name          TEXT    NOT NULL,         -- display name shown in UI
  client_id     TEXT    NOT NULL,
  client_secret TEXT    NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL
);
