-- Sub-teams: nested team hierarchy
--
-- A team may have one parent_team_id. The hierarchy is a forest (cycles are
-- prevented at the API layer, depth-capped to MAX_TEAM_DEPTH).
--
-- Semantics — see worker/routes/teams.ts and docs/teams.md:
--  * Membership is *inherited*: a member of an ancestor team has at least
--    the same role on every descendant team. Direct membership stacks
--    (effective role = max(direct, inherited)).
--  * Domains are *inherited*: descendants see ancestor domains as read-only
--    entries flagged with `inherited_from`.
--  * Apps and other resources stay independent — share-to-team still works.
--  * Deleting a team cascades to all descendants via ON DELETE CASCADE on
--    parent_team_id.

ALTER TABLE teams ADD COLUMN parent_team_id TEXT REFERENCES teams(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_teams_parent ON teams(parent_team_id);
