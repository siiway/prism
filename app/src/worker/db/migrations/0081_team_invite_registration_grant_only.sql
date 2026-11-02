-- Team-invite registration: one switch instead of three.
--
-- It used to need a site-wide switch (enable_team_invite_registration), a
-- per-team grant from a site admin, and the team owner's own switch
-- (teams.invite_registration_enabled). Now the per-team grant is the only
-- switch, and the site's sign-up mode covers the rest: when sign-up is
-- closed, no invite creates accounts.
--
-- A team keeps its grant only if all three were on, so nothing that was
-- off starts creating accounts.
UPDATE teams SET invite_registration_granted = 0
 WHERE invite_registration_enabled = 0
    OR NOT EXISTS (
      SELECT 1 FROM site_config
       WHERE key = 'enable_team_invite_registration' AND value = 'true'
    );

DELETE FROM site_config WHERE key = 'enable_team_invite_registration';

-- teams.invite_registration_enabled is no longer read. It stays rather than
-- being dropped so a Worker still running the previous release keeps working
-- until the new one is deployed.
