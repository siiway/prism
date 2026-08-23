-- Notice board: operator announcements shown inside the product.
--
-- The gap this fills is a message from whoever runs the instance to the people
-- using it — planned downtime, a policy change, a security advisory. Until now
-- there was nowhere to put one. The obvious alternative, emailing everyone, is
-- a worse instrument: it cannot respect the per-event notification preferences
-- (an announcement is not an event anyone subscribed to), it is unbounded
-- outbound volume on a shared sending domain, and it arrives whether or not
-- the recipient is affected. A notice sits where the affected people already
-- are and costs nothing to publish.
--
-- Audience is a coarse enum rather than a rules engine on purpose. Every
-- audience a notice board actually needs is answerable from the request alone
-- — everyone, signed-in users, admins, one team's members, or the signed-out
-- pages — and none of them require a query the viewer's session cannot
-- already answer.
CREATE TABLE notices (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  -- Markdown, rendered through the same sanitizer as profile READMEs.
  body TEXT NOT NULL,
  -- Drives the colour and the icon: 'info' | 'warning' | 'critical'.
  level TEXT NOT NULL DEFAULT 'info',
  -- 'public'  — also shown on the signed-out pages (login, register)
  -- 'users'   — every signed-in account
  -- 'admins'  — site administrators only
  -- 'team'    — members of `team_id`, direct or inherited
  audience TEXT NOT NULL DEFAULT 'users',
  team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
  -- Draft until published. A notice board with no draft state means composing
  -- in production, which is how half-written announcements get seen.
  is_published INTEGER NOT NULL DEFAULT 0,
  -- Window. NULL start = as soon as published; NULL end = until unpublished.
  -- Scheduling is stored rather than enforced by a job: the read query already
  -- filters on time, so a notice appears and disappears on its own without a
  -- cron tick deciding when.
  starts_at INTEGER,
  ends_at INTEGER,
  -- 0 for something that must stay on screen (an active incident).
  is_dismissible INTEGER NOT NULL DEFAULT 1,
  -- Sorts above the rest regardless of age.
  pinned INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- The read path is always "published, in window, for this audience", so the
-- index leads with the two columns that filter hardest.
CREATE INDEX idx_notices_active ON notices (is_published, audience, starts_at, ends_at);
CREATE INDEX idx_notices_team ON notices (team_id);

-- Per-viewer dismissal. Kept in its own table rather than a flag on the
-- notice because dismissal is per person and a notice outlives any one of
-- them; ON DELETE CASCADE means retracting a notice takes its dismissals with
-- it rather than leaving rows keyed on nothing.
CREATE TABLE notice_dismissals (
  notice_id TEXT NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dismissed_at INTEGER NOT NULL,
  PRIMARY KEY (notice_id, user_id)
);

CREATE INDEX idx_notice_dismissals_user ON notice_dismissals (user_id);
