// Site configuration loader from D1

import type { SiteConfig, SiteConfigRow } from "../types";

const DEFAULT_CONFIG: SiteConfig = {
  site_name: "Prism",
  site_description: "Federated identity platform",
  site_icon_url: null,
  allow_registration: true,
  invite_only: false,
  require_email_verification: false,
  captcha_provider: "none",
  captcha_site_key: "",
  captcha_secret_key: "",
  pow_difficulty: 20,
  domain_reverify_days: 30,
  session_ttl_days: 30,
  access_token_ttl_minutes: 60,
  refresh_token_ttl_days: 30,
  github_client_id: "",
  github_client_secret: "",
  google_client_id: "",
  google_client_secret: "",
  microsoft_client_id: "",
  microsoft_client_secret: "",
  discord_client_id: "",
  discord_client_secret: "",
  email_provider: "none",
  email_api_key: "",
  email_from: "noreply@example.com",
  smtp_host: "",
  smtp_port: 587,
  smtp_secure: false,
  smtp_user: "",
  smtp_password: "",
  custom_css: "",
  accent_color: "#0078d4",
  initialized: false,
};

export async function getConfig(db: D1Database): Promise<SiteConfig> {
  const rows = await db
    .prepare("SELECT key, value FROM site_config")
    .all<SiteConfigRow>();
  const config = { ...DEFAULT_CONFIG };
  for (const row of rows.results) {
    try {
      (config as Record<string, unknown>)[row.key] = JSON.parse(row.value);
    } catch {
      // ignore malformed entries
    }
  }
  return config;
}

export async function getConfigValue<K extends keyof SiteConfig>(
  db: D1Database,
  key: K,
): Promise<SiteConfig[K]> {
  const row = await db
    .prepare("SELECT value FROM site_config WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  if (!row) return DEFAULT_CONFIG[key];
  try {
    return JSON.parse(row.value) as SiteConfig[K];
  } catch {
    return DEFAULT_CONFIG[key];
  }
}

export async function setConfigValue(
  db: D1Database,
  key: string,
  value: unknown,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      "INSERT INTO site_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key, JSON.stringify(value), now)
    .run();
}

export async function setConfigValues(
  db: D1Database,
  updates: Partial<Record<string, unknown>>,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const stmts = Object.entries(updates).map(([k, v]) =>
    db
      .prepare(
        "INSERT INTO site_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .bind(k, JSON.stringify(v), now),
  );
  await db.batch(stmts);
}

export async function isInitialized(db: D1Database): Promise<boolean> {
  return getConfigValue(db, "initialized");
}

// ─── JWT secret (auto-generated, stored in KV, never exposed via config API) ──

const JWT_SECRET_KEY = "system:jwt_secret";

export async function getJwtSecret(kv: KVNamespace): Promise<string> {
  const existing = await kv.get(JWT_SECRET_KEY);
  if (existing) return existing;

  // First call: generate a cryptographically random 256-bit secret
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  await kv.put(JWT_SECRET_KEY, secret);
  return secret;
}
