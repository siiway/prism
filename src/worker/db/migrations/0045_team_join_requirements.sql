-- Team join requirements — security gates the joining user must satisfy
-- before they can become a member, and that they must keep satisfied while
-- they remain a member.
--
-- Defaults are 0 so existing teams keep accepting members exactly as before;
-- a team owner has to opt in. Enforcement happens server-side in the join
-- and admin-add paths, and again in the 2FA / email mutation paths so a
-- member can't unilaterally drop below the bar after joining.
ALTER TABLE teams ADD COLUMN require_2fa INTEGER NOT NULL DEFAULT 0;
ALTER TABLE teams ADD COLUMN require_verified_email INTEGER NOT NULL DEFAULT 0;
