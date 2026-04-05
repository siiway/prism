// ─── Database row types ───────────────────────────────────────────────────────

export interface UserRow {
  id: string;
  email: string;
  username: string;
  password_hash: string | null;
  display_name: string;
  avatar_url: string | null;
  role: "admin" | "user";
  email_verified: number;
  email_verify_token: string | null;
  is_active: number;
  alt_email_login: number | null;
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
  is_public: number;
  is_active: number;
  is_verified: number;
  is_official: number;
  is_first_party: number;
  team_id: string | null;
  oidc_fields: string; // JSON string[]
  created_at: number;
  updated_at: number;
}

export interface TeamRow {
  id: string;
  name: string;
  description: string;
  avatar_url: string | null;
  created_at: number;
  updated_at: number;
}

export interface TeamMemberRow {
  team_id: string;
  user_id: string;
  role: "owner" | "co-owner" | "admin" | "member";
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
  events: string; // JSON string[]
}

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
  github_client_id: string;
  github_client_secret: string;
  google_client_id: string;
  google_client_secret: string;
  microsoft_client_id: string;
  microsoft_client_secret: string;
  discord_client_id: string;
  discord_client_secret: string;
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
};
