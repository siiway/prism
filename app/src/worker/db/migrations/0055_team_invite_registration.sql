-- Team-invite registration and restricted accounts.
--
-- A second registration channel: a team the site admin has authorised may
-- hand out invite links that *create* accounts, not just admit existing
-- ones. Accounts minted this way are "restricted" — every resource-creating
-- feature is off by default so a large influx of single-purpose users costs
-- the instance rows and nothing more.
--
-- Semantics — see worker/lib/userCapabilities.ts and docs/teams.md:
--  * Off twice over. A site-level master switch AND a per-team grant that
--    only a site admin can give. One switch alone would open the channel to
--    every team owner on the instance, which effectively makes each of them
--    a registrar.
--  * `users.origin_team_id` is the anchor for everything: which apps the
--    account may authorise, which teams it may join, and which accounts a
--    dissolution deletes.
--  * Restriction is permanent *unless* the account is converted (see
--    `converted_at`). It never lapses on its own — leaving the team must not
--    become a way to shed the restriction.

-- ─── Restricted account marker ───────────────────────────────────────────────

-- The team whose invite minted this account. Non-null = restricted account.
--
-- Deliberately no ON DELETE CASCADE: dissolving a team deletes these accounts
-- through the staged flow in worker/cron/restricted.ts, which needs a
-- deactivation grace period and has to batch the work. Letting the database
-- do it would skip both and fan out across ~25 cascading tables in one go.
ALTER TABLE users ADD COLUMN origin_team_id TEXT;

-- Hashed reference to the invite used, matching how team_invites stores its
-- own token. A leaked link needs a "which accounts came from this code?"
-- query before it can be cleaned up.
ALTER TABLE users ADD COLUMN origin_invite_token TEXT;

-- 0 while the account exists but has not yet satisfied the team's join
-- requirements and become a member. Pending accounts are blocked from
-- /authorize entirely — see the note in worker/lib/userCapabilities.ts — and
-- are reaped if abandoned.
ALTER TABLE users ADD COLUMN origin_join_completed INTEGER NOT NULL DEFAULT 1;

-- When the holder converted to an unrestricted account. NULL = still
-- restricted. A timestamp rather than a boolean so the audit trail lives in
-- the same column as the state.
--
-- Converted accounts keep origin_team_id for traceability but are excluded
-- from every live restriction — including, critically, the set a team
-- dissolution deletes.
ALTER TABLE users ADD COLUMN converted_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_users_origin_team ON users(origin_team_id);

-- ─── Team-side gating ────────────────────────────────────────────────────────

-- Granted by a site admin. A team owner cannot set this — it is the second
-- of the two doors.
ALTER TABLE teams ADD COLUMN invite_registration_granted INTEGER NOT NULL DEFAULT 0;

-- The team owner's own switch. Only meaningful while granted = 1.
ALTER TABLE teams ADD COLUMN invite_registration_enabled INTEGER NOT NULL DEFAULT 0;

-- Site-level registration requirements this team's invite path may skip,
-- JSON: {"email_verification": true}. Site-admin controlled — a team cannot
-- exempt itself. Captcha, proof-of-work and every rate limit are NOT
-- exemptible and are not represented here.
ALTER TABLE teams ADD COLUMN invite_registration_exemptions TEXT;

-- Whether a normal (unrestricted) account may join via invite link. Direct
-- adds by an admin are never subject to this, so hiring staff still works.
-- Defaults to 1, preserving today's behaviour for every existing team.
ALTER TABLE teams ADD COLUMN allow_normal_user_join INTEGER NOT NULL DEFAULT 1;

-- Set when a site admin starts the staged dissolution. The team row must
-- survive until the reaper has finished clearing accounts, otherwise
-- origin_team_id dangles and the reaper can no longer find its work.
ALTER TABLE teams ADD COLUMN dissolving_at INTEGER;

-- ─── Invite-side ─────────────────────────────────────────────────────────────

-- Whether this invite may create accounts, as opposed to only admitting
-- existing ones.
--
-- Note the pre-existing default on max_uses is 0 = unlimited, which is
-- harmless for admission but would mean unbounded registration here. The API
-- layer requires a positive, site-capped max_uses whenever this is 1.
ALTER TABLE team_invites ADD COLUMN allows_registration INTEGER NOT NULL DEFAULT 0;
