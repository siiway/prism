// ─── Database row types ───────────────────────────────────────────────────────

export interface UserRow {
  id: string;
  email: string;
  username: string;
  password_hash: string | null;
  display_name: string;
  avatar_url: string | null;
  role: "admin" | "user";
  /** 'user' (default) for real humans. 'team' for synthetic rows whose id
   *  matches teams.id — these unify oauth_apps.owner_id so team-owned apps
   *  resolve via the same join as personal apps. Team-kind rows have no
   *  password_hash, no sessions, no social connections, and cannot log in. */
  kind: "user" | "team";
  email_verified: number;
  email_verify_token: string | null;
  is_active: number;
  alt_email_login: number | null;
  access_token_ttl_minutes: number | null;
  refresh_token_ttl_days: number | null;
  /** 0 = private (default), 1 = public — explicit opt-in only. */
  profile_is_public: number;
  /** NULL = follow site default; 0/1 = user-set preference. */
  profile_show_display_name: number | null;
  profile_show_avatar: number | null;
  profile_show_email: number | null;
  profile_show_joined_at: number | null;
  profile_show_gpg_keys: number | null;
  profile_show_authorized_apps: number | null;
  profile_show_owned_apps: number | null;
  profile_show_domains: number | null;
  /** Also gates whether this user is included in any team's public member
   *  list (the setting follows the user across team profiles). */
  profile_show_joined_teams: number | null;
  /** User-supplied markdown shown on the public profile. NULL/empty = no
   *  README. Capped at PROFILE_README_MAX_BYTES on write. Ignored when
   *  profile_readme_source != 'manual'. */
  profile_readme: string | null;
  profile_readme_updated_at: number | null;
  profile_show_readme: number | null;
  /** 'manual' (default) or 'github'. */
  profile_readme_source: string;
  /** JSON. Shape depends on source — for 'github':
   *    { connection_id?: string, github_login: string } */
  profile_readme_source_meta: string | null;
  profile_readme_synced_at: number | null;
  /** User-provided GitHub PAT used as the preferred token when fetching
   *  this user's GitHub README. Plaintext storage matches social_connections. */
  github_readme_token: string | null;
  /** Consecutive 401 ("Bad credentials") count for the per-user PAT.
   *  Auto-cleared at 3; reset on success or rotation. */
  github_readme_token_failures: number;
  created_at: number;
  updated_at: number;
}

export interface GpgKeyRow {
  id: string;
  user_id: string;
  fingerprint: string;
  key_id: string;
  name: string;
  public_key: string;
  created_at: number;
  last_used_at: number | null;
}

export interface TotpAuthenticatorRow {
  id: string;
  user_id: string;
  name: string;
  secret: string;
  enabled: number;
  created_at: number;
}

export interface TotpRecoveryRow {
  user_id: string;
  backup_codes: string; // JSON string[]
  updated_at: number;
}

export interface PasskeyRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string; // base64url
  counter: number;
  device_type: string;
  backed_up: number;
  transports: string; // JSON string[]
  name: string | null;
  created_at: number;
  last_used_at: number | null;
}

export interface OAuthAppRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  icon_url: string | null;
  website_url: string | null;
  client_id: string;
  client_secret: string;
  redirect_uris: string; // JSON string[]
  allowed_scopes: string; // JSON string[]
  optional_scopes: string; // JSON string[]
  is_public: number;
  is_active: number;
  is_verified: number;
  is_official: number;
  is_first_party: number;
  team_id: string | null;
  oidc_fields: string; // JSON string[]
  use_jwt_tokens: number;
  allow_self_manage_exported_permissions: number;
  created_at: number;
  updated_at: number;
}

export interface TeamRow {
  id: string;
  name: string;
  description: string;
  avatar_url: string | null;
  /** 0 = private (default), 1 = public — explicit owner opt-in only. */
  profile_is_public: number;
  /** NULL = follow site default; 0/1 = team-set preference. */
  profile_show_description: number | null;
  profile_show_avatar: number | null;
  profile_show_owner: number | null;
  profile_show_member_count: number | null;
  profile_show_apps: number | null;
  profile_show_domains: number | null;
  profile_show_members: number | null;
  created_at: number;
  updated_at: number;
}

export interface TeamMemberRow {
  team_id: string;
  user_id: string;
  role: "owner" | "co-owner" | "admin" | "member";
  /** NULL = follow user's profile_show_joined_teams; 0/1 = per-team override.
   *  Applies to both directions (hide on user profile + hide from team's
   *  member list). */
  show_on_profile: number | null;
  joined_at: number;
}

export interface OAuthCodeRow {
  code: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  scopes: string; // JSON string[]
  code_challenge: string | null;
  code_challenge_method: string | null;
  nonce: string | null;
  expires_at: number;
  created_at: number;
}

export interface OAuth2FAChallengeRow {
  id: string;
  client_id: string;
  redirect_uri: string;
  action: string | null;
  nonce: string | null;
  code_challenge: string | null;
  code_challenge_method: string | null;
  consumed_at: number | null;
  expires_at: number;
  created_at: number;
  /** App-set: 1 means this specific challenge demands a captcha at /authorize
   *  even if the site default doesn't. */
  require_captcha: number;
}

export interface OAuth2FACodeRow {
  code: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  action: string | null;
  nonce: string | null;
  method: "totp" | "passkey" | "backup" | "sudo";
  code_challenge: string | null;
  code_challenge_method: string | null;
  used_at: number | null;
  expires_at: number;
  verified_at: number;
  created_at: number;
}

export interface OAuthTokenRow {
  id: string;
  access_token: string;
  refresh_token: string | null;
  client_id: string;
  user_id: string;
  scopes: string; // JSON string[]
  expires_at: number;
  refresh_expires_at: number | null;
  created_at: number;
}

export interface DomainRow {
  id: string;
  user_id: string;
  created_by: string | null;
  app_id: string | null;
  team_id: string | null;
  domain: string;
  verification_token: string;
  verified: number;
  verified_at: number | null;
  next_reverify_at: number | null;
  verification_method: string | null;
  created_at: number;
}

export interface SocialConnectionRow {
  id: string;
  user_id: string;
  provider: string;
  provider_user_id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: number | null;
  profile_data: string; // JSON
  connected_at: number;
}

export interface UserEmailRow {
  id: string;
  user_id: string;
  email: string;
  verified: number;
  verify_token: string | null;
  verify_code: string | null;
  verified_via: string | null;
  verified_at: number | null;
  created_at: number;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  user_agent: string | null;
  ip_address: string | null;
  expires_at: number;
  created_at: number;
}

export interface OAuthSourceRow {
  id: string;
  slug: string;
  provider: string;
  name: string;
  client_id: string;
  client_secret: string;
  enabled: number;
  created_at: number;
  // Nullable columns added in 0012 — only set for provider="oidc"|"oauth2"
  auth_url: string | null;
  token_url: string | null;
  userinfo_url: string | null;
  scopes: string | null;
  // Added in 0013 — OIDC issuer URL for discovery reference
  issuer_url: string | null;
}

export interface SiteInviteRow {
  id: string;
  token: string;
  email: string | null;
  note: string | null;
  max_uses: number | null;
  use_count: number;
  created_by: string;
  expires_at: number | null;
  created_at: number;
}

export interface SiteConfigRow {
  key: string;
  value: string; // JSON-encoded
  updated_at: number;
}

export interface AuditLogRow {
  id: string;
  user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  metadata: string; // JSON
  ip_address: string | null;
  created_at: number;
}

export interface WebhookRow {
  id: string;
  name: string;
  url: string;
  secret: string;
  events: string; // JSON string[]
  is_active: number;
  user_id: string | null; // null = admin-scope, non-null = user-scope
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface UserNotificationPrefsRow {
  user_id: string;
  events: string; // JSON Record<string, "brief"|"full"> — legacy: string[]
  tg_events: string; // JSON string[] — legacy Telegram event keys
  notification_rules: string; // JSON NotificationRules — current canonical format
}

export interface NotificationEmailRule {
  email_id: string; // "primary" or UUID from user_emails
  level: "brief" | "full";
}

export interface NotificationTgRule {
  connection_id: string; // UUID from social_connections
  level: "brief" | "full";
}

export interface NotificationRule {
  email?: NotificationEmailRule[];
  tg?: NotificationTgRule[];
}

export type NotificationRules = Record<string, NotificationRule>;

export interface WebhookDeliveryRow {
  id: string;
  webhook_id: string;
  event_type: string;
  payload: string; // JSON
  response_status: number | null;
  response_body: string | null;
  success: number;
  delivered_at: number;
}

export interface AppScopeDefinitionRow {
  id: string;
  app_id: string;
  scope: string;
  title: string;
  description: string;
  created_at: number;
  updated_at: number;
}

export interface AppScopeAccessRuleRow {
  id: string;
  app_id: string;
  rule_type: "owner_allow" | "owner_deny" | "app_allow" | "app_deny";
  target_id: string;
  created_at: number;
}

export interface LoginErrorRow {
  id: string;
  error_code: string;
  identifier: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: string; // JSON
  created_at: number;
}

// ─── Application types ────────────────────────────────────────────────────────

export type SocialProvider = "github" | "google" | "microsoft" | "discord";

export type CaptchaProvider =
  | "none"
  | "turnstile"
  | "hcaptcha"
  | "recaptcha"
  | "pow";

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
  tg_notify_source_slug: string;
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
  initialized: boolean;
}

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  role: "admin" | "user";
  email_verified: boolean;
}

// Hono context variables
export type Variables = {
  user: AuthUser;
  sessionId: string;
  /** Set when a request is authenticated as an OAuth app using client credentials
   *  (HTTP Basic) rather than a user session. Only populated for endpoints that
   *  opt into app-self authentication. */
  appSelfAuth?: { appId: string; clientId: string };
};
