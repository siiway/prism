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
  created_at: number;
  updated_at: number;
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
  role: "owner" | "admin" | "member";
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

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  user_agent: string | null;
  ip_address: string | null;
  expires_at: number;
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
  email_api_key: string;
  email_from: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_password: string;
  custom_css: string;
  accent_color: string;
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
