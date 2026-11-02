-- Team public profile. Mirrors the user version: an explicit master opt-in
-- (no NULL state, so admins can never flip a private team to public via a
-- default change) and per-section nullable flags that fall back to site
-- defaults.
ALTER TABLE teams ADD COLUMN profile_is_public INTEGER NOT NULL DEFAULT 0;
ALTER TABLE teams ADD COLUMN profile_show_description INTEGER;
ALTER TABLE teams ADD COLUMN profile_show_avatar INTEGER;
ALTER TABLE teams ADD COLUMN profile_show_owner INTEGER;
ALTER TABLE teams ADD COLUMN profile_show_member_count INTEGER;
ALTER TABLE teams ADD COLUMN profile_show_apps INTEGER;
ALTER TABLE teams ADD COLUMN profile_show_domains INTEGER;
ALTER TABLE teams ADD COLUMN profile_show_members INTEGER;
