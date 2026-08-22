// Types shared by the Worker and the frontend.
//
// These are pure data shapes — the site configuration record, the capability
// vocabularies, the notification-rule format — with no dependency on the
// Cloudflare runtime or the DOM. Both tsconfig projects include this
// directory and both tiers re-export from here (worker/types.ts,
// src/types.ts, src/lib/api.ts), so a field added on one side cannot go
// missing on the other the way it did while each tier kept its own copy.

export type CaptchaProvider =
  | "none"
  | "turnstile"
  | "hcaptcha"
  | "recaptcha"
  | "pow";

/** How the Turnstile challenge script host is chosen. Cloudflare serves the
 *  widget JS from a Mainland-China-accelerated mirror
 *  (challenges.cloudflare-cn.com) alongside the global host
 *  (challenges.cloudflare.com). Only the client-side script host is affected —
 *  server-side siteverify always hits the global host. Only applies when
 *  captcha_provider is "turnstile". */
export type TurnstileEndpointMode =
  | "global" // always the global host
  | "china" // always the China mirror
  | "client_language" // client picks the mirror when the browser language is Chinese
  | "server_region" // server picks the mirror when the request geo is CN
  | "client_region"; // client picks the mirror from its own timezone

export interface SiteConfig {
  site_name: string;
  site_description: string;
  site_icon_url: string | null;
  allow_registration: boolean;
  invite_only: boolean;
  require_email_verification: boolean;
  captcha_provider: CaptchaProvider;
  captcha_site_key: string;
  captcha_secret_key: string;
  /** Turnstile challenge-script host selection strategy. Only meaningful when
   *  captcha_provider is "turnstile". */
  turnstile_endpoint_mode: TurnstileEndpointMode;
  pow_difficulty: number;
  domain_reverify_days: number;
  session_ttl_days: number;
  access_token_ttl_minutes: number;
  refresh_token_ttl_days: number;
  email_provider: "none" | "resend" | "mailchannels" | "smtp";
  email_verify_methods: "link" | "send" | "both";
  email_receive_host: string;
  email_receive_provider: "cloudflare" | "imap" | "none";
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  imap_user: string;
  imap_password: string;
  email_api_key: string;
  email_from: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_password: string;
  custom_css: string;
  accent_color: string;
  login_error_retention_days: number;
  social_verify_ttl_days: number;
  allow_alt_email_login: boolean;
  ipv6_rate_limit_prefix: number; // prefix length for IPv6 rate-limit bucketing (e.g. 64)
  gpg_challenge_prefix: string; // extra lines inserted after the site header in the GPG challenge text
  disable_user_create_team: boolean;
  disable_user_create_app: boolean;
  /** When true, the worker skips server-side rendering and returns the
   *  bare index.html template for every non-API page, letting the client
   *  bundle hydrate on its own. Useful for debugging SSR-only bugs or
   *  cutting D1 read load during incidents. */
  disable_ssr: boolean;
  tg_notify_source_slug: string;
  /** Slug of the enabled Discord oauth_source used to identify linked Discord
   *  recipients. Empty disables Discord DM notifications. */
  discord_notify_source_slug: string;
  /** Discord bot token used for notification DMs. This is separate from the
   *  Discord OAuth source client secret. Empty disables Discord DM delivery. */
  discord_bot_token: string;
  /** How long, in minutes, a successful 2FA step-up grants a sudo grace period
   *  during which subsequent challenges from the same app on the same session
   *  bypass TOTP/passkey re-prompting. 0 disables sudo mode entirely. */
  sudo_mode_ttl_minutes: number;
  /** Site-wide default: require a captcha solve at the user-facing 2FA
   *  step-up screen. Apps can also opt-in per challenge. The site's
   *  configured `captcha_provider` is used; if that's "none", this is a no-op. */
  require_captcha_for_2fa: boolean;
  /** Master kill switch for public user profiles. When false, the
   *  /api/users/:username endpoint returns 404 regardless of any user's
   *  individual opt-in. */
  enable_public_profiles: boolean;
  /** Defaults for users who have not explicitly set a per-field preference.
   *  Changing these propagates to every user with a NULL preference. */
  default_profile_show_display_name: boolean;
  default_profile_show_avatar: boolean;
  default_profile_show_email: boolean;
  default_profile_show_joined_at: boolean;
  default_profile_show_gpg_keys: boolean;
  default_profile_show_authorized_apps: boolean;
  default_profile_show_owned_apps: boolean;
  default_profile_show_domains: boolean;
  /** Defaults to off — team membership is socially sensitive (employer,
   *  client list, group memberships) and should be opt-in even when other
   *  profile sections default on. Also gates whether the user appears in
   *  any team's public member list. */
  default_profile_show_joined_teams: boolean;
  /** Whether the README section is visible by default. README itself is
   *  always opt-in (empty == hidden), so this only matters for users who
   *  have written one but haven't customized this flag. */
  default_profile_show_readme: boolean;
  /** Hard cap on README markdown source, in bytes. Enforced on PATCH /me
   *  and POST /me/readme. Bumping this is fine; lowering it leaves existing
   *  oversized READMEs intact (they just can't be re-saved without trimming). */
  profile_readme_max_bytes: number;
  /** Site-global GitHub PAT used as the last-resort token when fetching a
   *  user's GitHub profile README. Stored in plaintext like other provider
   *  secrets. Empty string = unauthenticated (60 req/hr per IP). */
  github_readme_token: string;
  /** TTL on the github_readme_cache table. We serve cached content for this
   *  long before issuing a conditional GET. Stale-while-error: if a refresh
   *  fails, we keep returning the stale entry. */
  github_readme_cache_ttl_seconds: number;
  /** Consecutive 401 count for the site-global PAT. Auto-clears the site
   *  token at 3; reset on success or admin rotation. Mirrors the per-user
   *  counter. */
  github_readme_token_failures: number;
  /** Defaults for the team public-profile feature. The team is always
   *  the source of truth for `profile_is_public` (no site default for
   *  the master switch — privacy-first). */
  default_team_profile_show_description: boolean;
  default_team_profile_show_avatar: boolean;
  default_team_profile_show_owner: boolean;
  default_team_profile_show_member_count: boolean;
  default_team_profile_show_apps: boolean;
  default_team_profile_show_domains: boolean;
  /** The full member list (separate from member_count). Defaults to off:
   *  even teams that show their member count usually don't want to expose
   *  every individual member by default. */
  default_team_profile_show_members: boolean;
  /** Site-wide floor for team join requirements. When true, EVERY team
   *  effectively requires the corresponding factor regardless of the
   *  team-level flag — owners can opt teams in further but cannot opt out
   *  below the site floor. Defaults off, so existing deployments behave
   *  the same until an admin enables them. */
  default_team_require_2fa: boolean;
  default_team_require_verified_email: boolean;
  /** Master switch for sub-team support. When false the server rejects
   *  every sub-team create/list/move endpoint with 403 and the existing
   *  parent_team_id column is ignored for inheritance purposes. */
  enable_sub_teams: boolean;
  /** Hard cap on nesting depth (root = 0, so depth N means N parents). */
  max_team_depth: number;
  /** When false, sub-team membership stops cascading from ancestors —
   *  effective role degenerates to the user's direct row only. Domain
   *  inheritance and the hierarchy itself are unaffected. */
  inherit_team_membership: boolean;
  /** When false, ancestor-owned domains stop appearing on descendant
   *  team domain lists and don't auto-verify sub-domains. */
  inherit_team_domains: boolean;
  /** Public team profile default — show the list of immediate sub-teams.
   *  Per-team override lives in {@link TeamRow.profile_show_sub_teams}. */
  default_team_profile_show_sub_teams: boolean;
  /** Site-wide fallback for the per-team capability set, same shape as
   *  {@link TeamRow.role_permissions}. Sits between a team's own overrides
   *  and the built-in defaults in worker/lib/teamGroups.ts — operators can
   *  shift the default posture for every team that hasn't customised it.
   *  Keys absent here fall through to the built-ins. */
  default_team_role_permissions: TeamRolePermissions;
  /** Master switch for the team-invite registration channel. Off by default:
   *  turning it on is what makes team owners able to mint accounts at all,
   *  and even then each team still needs its own site-admin grant. */
  enable_team_invite_registration: boolean;
  /** Ceiling on the `max_uses` a team may set on a registration-capable
   *  invite. Without it a team owner could type a million and walk straight
   *  past the only hard bound on registration volume. */
  team_invite_registration_max_uses_cap: number;
  /** Per-invite registration ceiling per hour. IP rate limiting does not
   *  bound a link shared to thousands of people; this does. */
  team_invite_registration_rate_per_hour: number;
  /** Capabilities granted to restricted accounts, over the built-in
   *  defaults in worker/lib/userCapabilities.ts (which deny everything but
   *  account security). Keys absent here fall through to those defaults. */
  restricted_user_capabilities: RestrictedCapabilities;
  /** How long a pending registration may sit unfinished before the reaper
   *  deletes it, freeing the username and any bound email. */
  restricted_pending_ttl_hours: number;
  /** Grace period between a team dissolution deactivating its restricted
   *  accounts and the reaper hard-deleting them. */
  restricted_dissolve_grace_hours: number;
  initialized: boolean;
}

/** Capability overrides for restricted accounts. Only explicitly-set keys
 *  are present; anything missing falls through to the built-in defaults. */
export type RestrictedCapabilities = Partial<
  Record<RestrictedCapability, boolean>
>;

/** What a restricted account may do beyond the always-on baseline (account
 *  security and the team it belongs to). Extend the union to add more; the
 *  storage is a JSON blob, so no migration is needed. */
export type RestrictedCapability =
  | "team:create"
  | "app:create"
  | "domain:create"
  | "pat:create"
  | "profile:public"
  | "gpg:manage"
  | "self:convert";

/** Capability overrides for non-owner roles within a team, keyed by role.
 *  Only explicitly-set keys are present; anything missing falls through to
 *  the next level of the chain. Owners and co-owners are never gated by
 *  this — they always hold every capability. */
export type TeamRolePermissions = Partial<
  Record<"admin", Partial<Record<TeamCapability, boolean>>>
>;

/** Capabilities that a team owner can grant to (or withhold from) admins.
 *  Extend this union to add more; no migration needed since the storage is
 *  a JSON blob. */
export type TeamCapability = "groups:manage" | "groups:assign";

export interface NotificationEmailRule {
  email_id: string; // "primary" or UUID from user_emails
  level: "brief" | "full";
}

export interface NotificationTgRule {
  connection_id: string; // UUID from social_connections
  level: "brief" | "full";
}

export interface NotificationDiscordRule {
  connection_id: string; // UUID from social_connections
  level: "brief" | "full";
}

export interface NotificationRule {
  email?: NotificationEmailRule[];
  tg?: NotificationTgRule[];
  discord?: NotificationDiscordRule[];
}

export type NotificationRules = Record<string, NotificationRule>;
