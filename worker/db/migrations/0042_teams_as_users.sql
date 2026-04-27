-- Teams as a special kind of user.
--
-- Goal: unify ownership. oauth_apps.owner_id can now point at either a
-- regular user (kind='user') or a team-shaped user row (kind='team')
-- whose id matches teams.id. The admin panel and any other code that
-- joins users on owner_id will then naturally surface team ownership
-- without branching on team_id.
--
-- Backfill is done from the admin panel (POST /admin/migrate-teams-as-users)
-- so that existing deployments can opt in deliberately. This migration
-- only adds the kind column; it does not synthesize user rows for teams.

ALTER TABLE users ADD COLUMN kind TEXT NOT NULL DEFAULT 'user';
CREATE INDEX IF NOT EXISTS idx_users_kind ON users(kind);
