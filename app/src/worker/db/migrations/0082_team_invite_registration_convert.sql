-- Whether accounts a team's invites created may convert themselves to full
-- accounts. NULL = follow the site default (restricted_user_capabilities
-- "self:convert"); 0 or 1 = a site admin's override for this team.
ALTER TABLE teams ADD COLUMN invite_registration_allow_convert INTEGER;
