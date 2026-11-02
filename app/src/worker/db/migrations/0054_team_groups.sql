-- Team groups: owner-defined member labels.
--
-- Semantics — see worker/lib/teamGroups.ts and docs/teams.md:
--  * Groups are *pure labels*. They never enter ROLE_RANK / hasRole, so
--    Prism's own authorization is unchanged. Their only purpose is to ride
--    along with member info so downstream apps can authorize on them.
--  * Off by default. `teams.enable_groups` is an explicit per-team opt-in
--    that only the team owner can flip. While off, every read surface omits
--    groups entirely — the data is preserved, not wiped, so re-enabling
--    restores the previous state (same convention as `enable_sub_teams`
--    keeping `parent_team_id` around while disabled).
--  * Groups are *inherited* down the sub-team tree, mirroring
--    `inherit_team_membership`: a member of ancestor A carries A's labels on
--    every descendant, flagged with `inherited_from`. Ancestors whose own
--    `enable_groups` is off contribute nothing — "disabled means not
--    emitted" has to hold across the inheritance chain too, otherwise a
--    disabled team's labels would leak out through its children.

ALTER TABLE teams ADD COLUMN enable_groups INTEGER NOT NULL DEFAULT 0;

-- Owner-configured capability set for non-owner roles, JSON-encoded and
-- keyed by role: {"admin": {"groups:assign": false}}. Only keys the owner
-- explicitly changed are stored; anything absent falls through to the site
-- default (`default_team_role_permissions`) and then to the built-in
-- defaults in worker/lib/teamGroups.ts. NULL = nothing overridden.
--
-- Keyed by role rather than flat so future capabilities can be granted to
-- other roles without another migration.
ALTER TABLE teams ADD COLUMN role_permissions TEXT;

CREATE TABLE IF NOT EXISTS team_groups (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  -- Stable identifier handed to downstream apps. Immutable after creation:
  -- authorization rules out there bind to it, and renaming would silently
  -- break them. `name` is the mutable display label.
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT,
  -- Per-group override of the team's `groups:assign` capability for admins.
  -- NULL = follow the team/site/built-in chain; 0/1 = this group is an
  -- explicit exception (e.g. a sensitive group only owners may hand out).
  -- Owner-only to change, like the permission set it overrides.
  admin_assignable INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (team_id, slug),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_team_groups_team ON team_groups(team_id);

-- Membership in a group. The composite FK onto team_members means losing
-- team membership drops the labels with it, and deleting a group unassigns
-- it everywhere — no orphan rows to sweep.
CREATE TABLE IF NOT EXISTS team_member_groups (
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  assigned_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id, group_id),
  FOREIGN KEY (group_id) REFERENCES team_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id, user_id)
    REFERENCES team_members(team_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_team_member_groups_user ON team_member_groups(user_id);
CREATE INDEX IF NOT EXISTS idx_team_member_groups_team_user ON team_member_groups(team_id, user_id);
