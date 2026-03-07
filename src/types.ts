// Shared frontend types

export interface SiteConfig {
  site_name: string;
  site_description: string;
  site_icon_url: string | null;
  allow_registration: boolean;
  require_email_verification: boolean;
  captcha_provider: "none" | "turnstile" | "hcaptcha" | "recaptcha" | "pow";
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
