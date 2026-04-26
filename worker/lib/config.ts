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
  email_provider: "none",
  email_verify_methods: "both",
  email_receive_host: "",
  email_receive_provider: "cloudflare",
  imap_host: "",
  imap_port: 993,
  imap_secure: true,
  imap_user: "",
  imap_password: "",
  email_api_key: "",
  email_from: "noreply@example.com",
  smtp_host: "",
  smtp_port: 587,
  smtp_secure: false,
  smtp_user: "",
  smtp_password: "",
  custom_css: "",
  accent_color: "#0078d4",
  login_error_retention_days: 30,
  social_verify_ttl_days: 0,
  allow_alt_email_login: true,
  ipv6_rate_limit_prefix: 64,
  gpg_challenge_prefix: "",
  disable_user_create_team: false,
  disable_user_create_app: false,
  tg_notify_source_slug: "",
  sudo_mode_ttl_minutes: 5,
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

// ─── RSA keypair for ID token signing (RS256 / JWKS) ─────────────────────────

const RSA_KEYPAIR_KEY = "system:rsa_keypair";

interface StoredKeyPair {
  kid: string;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
}

export interface RsaKeyPair {
  kid: string;
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
}

export async function getRsaKeyPair(kv: KVNamespace): Promise<RsaKeyPair> {
  const stored = await kv.get(RSA_KEYPAIR_KEY);
  if (stored) {
    const { kid, publicKeyJwk, privateKeyJwk } = JSON.parse(
      stored,
    ) as StoredKeyPair;
    const [publicKey, privateKey] = await Promise.all([
      crypto.subtle.importKey(
        "jwk",
        publicKeyJwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        true,
        ["verify"],
      ),
      crypto.subtle.importKey(
        "jwk",
        privateKeyJwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        true,
        ["sign"],
      ),
    ]);
    return { kid, publicKey, privateKey, publicKeyJwk };
  }

  const keyPair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;

  const [publicKeyJwk, privateKeyJwk] = (await Promise.all([
    crypto.subtle.exportKey("jwk", keyPair.publicKey),
    crypto.subtle.exportKey("jwk", keyPair.privateKey),
  ])) as [JsonWebKey, JsonWebKey];

  const kid = crypto.randomUUID();
  await kv.put(
    RSA_KEYPAIR_KEY,
    JSON.stringify({ kid, publicKeyJwk, privateKeyJwk }),
  );

  return {
    kid,
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    publicKeyJwk,
  };
}
