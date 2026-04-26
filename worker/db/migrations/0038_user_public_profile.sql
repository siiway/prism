-- User public profile visibility.
--
-- profile_is_public is the explicit master opt-in: 0 = private (the safe
-- default for existing users), 1 = public. There is no NULL state; admins
-- changing site defaults must never silently flip an existing user's
-- profile from private to public.
--
-- The per-field show_* columns are nullable: NULL means "follow the site
-- default" (config.default_profile_show_*), 0/1 means the user has set
-- an explicit preference. This lets admins update site-wide defaults and
-- have them apply to users who haven't customized.
ALTER TABLE users ADD COLUMN profile_is_public INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN profile_show_display_name INTEGER;
ALTER TABLE users ADD COLUMN profile_show_avatar INTEGER;
ALTER TABLE users ADD COLUMN profile_show_email INTEGER;
ALTER TABLE users ADD COLUMN profile_show_joined_at INTEGER;
ALTER TABLE users ADD COLUMN profile_show_gpg_keys INTEGER;
ALTER TABLE users ADD COLUMN profile_show_authorized_apps INTEGER;
ALTER TABLE users ADD COLUMN profile_show_owned_apps INTEGER;
ALTER TABLE users ADD COLUMN profile_show_domains INTEGER;
-- profile_show_joined_teams ALSO controls whether this user surfaces in
-- the member list on team public profiles ("the visibility setting follows
-- the user"). A user who hides their own joined-teams section is omitted
-- from every team's member list, even when those teams have show-members on.
ALTER TABLE users ADD COLUMN profile_show_joined_teams INTEGER;

-- Per-team override of profile_show_joined_teams. NULL = follow the user's
-- master toggle, 0 = explicitly hidden ("hide this team only"), 1 =
-- explicitly shown (lets the user pick specific teams to surface even when
-- the master toggle is off). Same flag applies in both directions: hiding
-- a team here also removes the user from THAT team's public member list.
ALTER TABLE team_members ADD COLUMN show_on_profile INTEGER;
