-- Prism OAuth Platform - Initial Schema
-- Run: pnpm db:migrate

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  email_verified INTEGER NOT NULL DEFAULT 0,
  email_verify_token TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS totp_secrets (
  user_id TEXT PRIMARY KEY,
  secret TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  backup_codes TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  device_type TEXT NOT NULL DEFAULT 'singleDevice',
  backed_up INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  name TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS oauth_apps (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon_url TEXT,
  website_url TEXT,
  client_id TEXT NOT NULL UNIQUE,
  client_secret TEXT NOT NULL,
  redirect_uris TEXT NOT NULL DEFAULT '[]',
  allowed_scopes TEXT NOT NULL DEFAULT '["openid","profile","email"]',
  is_public INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_verified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS oauth_codes (
  code TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '[]',
  code_challenge TEXT,
  code_challenge_method TEXT,
  nonce TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL UNIQUE,
  refresh_token TEXT UNIQUE,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '[]',
  expires_at INTEGER NOT NULL,
  refresh_expires_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_consents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '[]',
  granted_at INTEGER NOT NULL,
  UNIQUE(user_id, client_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  app_id TEXT,
  domain TEXT NOT NULL,
  verification_token TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  verified_at INTEGER,
  next_reverify_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, domain),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (app_id) REFERENCES oauth_apps(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS social_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at INTEGER,
  profile_data TEXT NOT NULL DEFAULT '{}',
  connected_at INTEGER NOT NULL,
  UNIQUE(user_id, provider),
  UNIQUE(provider, provider_user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  ip_address TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS site_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  ip_address TEXT,
  created_at INTEGER NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires_at ON oauth_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user_id ON oauth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_client_id ON oauth_tokens(client_id);
CREATE INDEX IF NOT EXISTS idx_domains_user_id ON domains(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

-- Default site config
INSERT OR IGNORE INTO site_config (key, value, updated_at) VALUES
  ('site_name', '"Prism"', unixepoch()),
  ('site_description', '"Federated identity platform"', unixepoch()),
  ('site_icon_url', 'null', unixepoch()),
  ('allow_registration', 'true', unixepoch()),
  ('require_email_verification', 'false', unixepoch()),
  ('captcha_provider', '"none"', unixepoch()),
  ('captcha_site_key', '""', unixepoch()),
  ('captcha_secret_key', '""', unixepoch()),
  ('pow_difficulty', '20', unixepoch()),
  ('domain_reverify_days', '30', unixepoch()),
  ('session_ttl_days', '30', unixepoch()),
  ('access_token_ttl_minutes', '60', unixepoch()),
  ('refresh_token_ttl_days', '30', unixepoch()),
  ('github_client_id', '""', unixepoch()),
  ('github_client_secret', '""', unixepoch()),
  ('google_client_id', '""', unixepoch()),
  ('google_client_secret', '""', unixepoch()),
  ('microsoft_client_id', '""', unixepoch()),
  ('microsoft_client_secret', '""', unixepoch()),
  ('discord_client_id', '""', unixepoch()),
  ('discord_client_secret', '""', unixepoch()),
  ('email_provider', '"none"', unixepoch()),
  ('email_from', '"noreply@example.com"', unixepoch()),
  ('custom_css', '""', unixepoch()),
  ('accent_color', '"#0078d4"', unixepoch()),
  ('initialized', 'false', unixepoch());
