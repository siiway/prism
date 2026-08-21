// Shared frontend types

export interface SiteConfig {
  site_name: string;
  site_description: string;
  site_icon_url: string | null;
  allow_registration: boolean;
  invite_only: boolean;
  require_email_verification: boolean;
  captcha_provider: "none" | "turnstile" | "hcaptcha" | "recaptcha" | "pow";
  captcha_site_key: string;
  captcha_secret_key: string;
  /** Turnstile challenge-script host selection strategy (only used when
   *  captcha_provider is "turnstile"). */
  turnstile_endpoint_mode:
    | "global"
    | "china"
    | "client_language"
    | "server_region"
    | "client_region";
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
  ipv6_rate_limit_prefix: number;
  gpg_challenge_prefix: string;
  disable_user_create_team: boolean;
  disable_user_create_app: boolean;
  disable_ssr: boolean;
  tg_notify_source_slug: string;
  discord_notify_source_slug: string;
  discord_bot_token: string;
  sudo_mode_ttl_minutes: number;
  require_captcha_for_2fa: boolean;
  enable_public_profiles: boolean;
  default_profile_show_display_name: boolean;
  default_profile_show_avatar: boolean;
  default_profile_show_email: boolean;
  default_profile_show_joined_at: boolean;
  default_profile_show_gpg_keys: boolean;
  default_profile_show_authorized_apps: boolean;
  default_profile_show_owned_apps: boolean;
  default_profile_show_domains: boolean;
  default_profile_show_joined_teams: boolean;
  default_profile_show_readme: boolean;
  profile_readme_max_bytes: number;
  github_readme_token: string;
  github_readme_cache_ttl_seconds: number;
  default_team_profile_show_description: boolean;
  default_team_profile_show_avatar: boolean;
  default_team_profile_show_owner: boolean;
  default_team_profile_show_member_count: boolean;
  default_team_profile_show_apps: boolean;
  default_team_profile_show_domains: boolean;
  default_team_profile_show_members: boolean;
  /** Site default for whether public team profiles list their sub-teams. */
  default_team_profile_show_sub_teams: boolean;
  default_team_require_2fa: boolean;
  default_team_require_verified_email: boolean;
  /** Master switch for team-invite registration. Off by default: turning it
   *  on is what lets a team owner mint accounts at all, and even then each
   *  team needs its own site-admin grant. */
  enable_team_invite_registration: boolean;
  /** Ceiling on the usage limit a team may set on a registration-capable
   *  invite — the only hard bound on registration volume. */
  team_invite_registration_max_uses_cap: number;
  /** Registrations per hour per invite. Per-IP limiting cannot bound a link
   *  shared to thousands of people. */
  team_invite_registration_rate_per_hour: number;
  /** Features granted to invite-registered accounts. Absent keys fall back
   *  to the built-in defaults, which deny everything. */
  restricted_user_capabilities: Partial<Record<string, boolean>>;
  /** How long an unfinished registration survives before it is reaped. */
  restricted_pending_ttl_hours: number;
  /** Grace period between a dissolution deactivating accounts and the
   *  reaper deleting them. */
  restricted_dissolve_grace_hours: number;
  /** Master switch for the sub-team feature. When false the server rejects
   *  every sub-team endpoint and the UI hides sub-team affordances. */
  enable_sub_teams: boolean;
  /** Operator-configured cap on team nesting depth (root = 0). */
  max_team_depth: number;
  /** When false, ancestor membership stops cascading to descendants. */
  inherit_team_membership: boolean;
  /** When false, ancestor-owned domains stop appearing on descendant
   *  team domain listings. */
  inherit_team_domains: boolean;
  initialized: boolean;
}
