// Site configuration loader from D1

import type { SiteConfig, SiteConfigRow } from "../types";
import {
  SENSITIVE_CONFIG_KEYS,
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from "./secretCrypto";

const DEFAULT_CONFIG: SiteConfig = {
  site_name: "Prism",
  site_description: "Federated identity platform",
  site_icon_url: null,
  allow_registration: true,
  invite_only: false,
  require_email_verification: false,
  captcha_provider: "none",
  captcha_providers: [],
  captcha_site_key: "",
  captcha_secret_key: "",
  turnstile_site_key: "",
  turnstile_secret_key: "",
  hcaptcha_site_key: "",
  hcaptcha_secret_key: "",
  recaptcha_site_key: "",
  recaptcha_secret_key: "",
  geetest_captcha_id: "",
  geetest_captcha_key: "",
  geetest_fail_open: false,
  cap_mode: "embedded",
  cap_api_endpoint: "",
  cap_site_key: "",
  cap_secret_key: "",
  cap_challenge_count: 50,
  cap_challenge_difficulty: 4,
  cap_instrumentation: true,
  captcha_switch_timeout_seconds: 15,
  turnstile_endpoint_mode: "global",
  turnstile_china_site_key: "",
  turnstile_china_secret_key: "",
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
  security_contact: "",
  security_policy_url: "",
  login_error_retention_days: 30,
  social_verify_ttl_days: 0,
  allow_alt_email_login: true,
  ipv6_rate_limit_prefix: 64,
  gpg_challenge_prefix: "",
  disable_user_create_team: false,
  disable_user_create_app: false,
  disable_ssr: false,
  tg_notify_source_slug: "",
  discord_notify_source_slug: "",
  discord_bot_token: "",
  sudo_mode_ttl_minutes: 5,
  require_captcha_for_2fa: false,
  enable_public_profiles: true,
  default_profile_show_display_name: true,
  default_profile_show_avatar: true,
  default_profile_show_email: false,
  default_profile_show_joined_at: true,
  default_profile_show_gpg_keys: true,
  // Authorized apps reveal which third-party services the user has connected
  // to — sensitive enough to default off, even if the user opts their profile
  // public.
  default_profile_show_authorized_apps: false,
  default_profile_show_owned_apps: true,
  default_profile_show_domains: true,
  // Joined teams reveal social/employer affiliations — opt-in per user, and
  // doubles as the per-user gate for appearing in team member lists.
  default_profile_show_joined_teams: false,
  default_profile_show_readme: true,
  profile_readme_max_bytes: 64 * 1024,
  github_readme_token: "",
  github_readme_cache_ttl_seconds: 3600,
  github_readme_token_failures: 0,
  default_team_profile_show_description: true,
  default_team_profile_show_avatar: true,
  // Owner has to be opted in explicitly per team — the owner's username
  // would otherwise leak via the team page even if the user has a private
  // profile.
  default_team_profile_show_owner: false,
  default_team_profile_show_member_count: true,
  default_team_profile_show_apps: true,
  default_team_profile_show_domains: true,
  // Member list is sensitive — even teams that publish a count usually
  // don't want to publish every name. Still subject to each member's own
  // profile_show_joined_teams flag.
  default_team_profile_show_members: false,
  // Off by default — turning these on retroactively forces every existing
  // team to require the factor, which can lock out current members who
  // haven't enrolled yet, so operators should opt in deliberately.
  default_team_require_2fa: false,
  default_team_require_verified_email: false,
  // Sub-team feature. Master switch lets operators turn the whole nested-
  // team experience off without dropping data; the parent_team_id column
  // is still preserved but ignored for inheritance and management.
  enable_sub_teams: true,
  max_team_depth: 5,
  inherit_team_membership: true,
  inherit_team_domains: true,
  default_team_profile_show_sub_teams: true,
  // Site-wide fallback for per-team capability grants. Empty by default so
  // every team falls through to the built-in defaults in lib/teamGroups.ts;
  // operators who want a different posture site-wide set it here instead of
  // editing each team.
  default_team_role_permissions: {},
  // Team-invite registration. Off by default because switching it on is what
  // lets team owners mint accounts — a power that otherwise belongs solely to
  // the site admin. Each team additionally needs its own grant.
  enable_team_invite_registration: false,
  team_invite_registration_max_uses_cap: 1000,
  team_invite_registration_rate_per_hour: 200,
  // Empty = restricted accounts fall through to the built-in defaults, which
  // deny every resource-creating feature.
  restricted_user_capabilities: {},
  restricted_pending_ttl_hours: 72,
  restricted_dissolve_grace_hours: 168,
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
  migrateLegacyCaptcha(config);
  return config;
}

/**
 * Bridge the pre-switchable-set captcha config into the new model, in memory,
 * on every read. A site configured before `captcha_providers` existed has only
 * the legacy `captcha_provider` + shared `captcha_site_key`/`captcha_secret_key`
 * stored; derive the ordered set from it and copy the shared credentials into
 * the matching provider's per-provider slot so verification finds them.
 *
 * Runs only when `captcha_providers` was never written (still the empty
 * default) — once an admin saves the new config, the stored list wins and this
 * is a no-op. Secrets are copied as-is (still ciphertext at this stage); the
 * per-provider secret keys are in SENSITIVE_CONFIG_KEYS, so decryptConfigSecrets
 * handles them downstream exactly like the legacy field.
 */
function migrateLegacyCaptcha(config: SiteConfig): void {
  if (config.captcha_providers.length > 0) return;
  const legacy = config.captcha_provider;
  if (!legacy || legacy === "none") return;

  config.captcha_providers = [legacy];

  const bag = configBag(config);
  const siteKeyField = `${legacy}_site_key`;
  const secretKeyField = `${legacy}_secret_key`;
  // Only turnstile/hcaptcha/recaptcha shared the legacy pair. pow has no keys;
  // geetest/cap did not exist before the migration, so nothing to copy.
  if (siteKeyField in config && !bag[siteKeyField]) {
    bag[siteKeyField] = config.captcha_site_key;
  }
  if (secretKeyField in config && !bag[secretKeyField]) {
    bag[secretKeyField] = config.captcha_secret_key;
  }
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
  const entries = Object.entries(updates);
  // D1's batch() rejects an empty statement list with
  // "D1_ERROR: No SQL statements detected." Nothing to write is a no-op.
  if (entries.length === 0) return;
  const now = Math.floor(Date.now() / 1000);
  const stmts = entries.map(([k, v]) =>
    db
      .prepare(
        "INSERT INTO site_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .bind(k, JSON.stringify(v), now),
  );
  await db.batch(stmts);
}

/**
 * View a SiteConfig as a string-keyed bag for access by runtime-computed
 * keys — e.g. iterating SENSITIVE_CONFIG_KEYS or building `${slug}_client_id`.
 * SiteConfig is statically typed, but these call sites index it with keys
 * only known at runtime, so the cast is unavoidable; centralizing it keeps
 * the single `as unknown as` escape hatch in one reviewed place.
 */
export function configBag(config: SiteConfig): Record<string, unknown> {
  return config as unknown as Record<string, unknown>;
}

/**
 * Decrypt the encrypted-at-rest fields of a SiteConfig in place. Callers
 * that need the actual plaintext of e.g. `email_api_key` or
 * `captcha_secret_key` MUST run the result of getConfig() through this
 * before using the value. Cheap when no fields are encrypted (no-ops).
 */
export async function decryptConfigSecrets(
  env: Env,
  config: SiteConfig,
): Promise<SiteConfig> {
  const bag = configBag(config);
  for (const key of SENSITIVE_CONFIG_KEYS) {
    const v = bag[key];
    if (typeof v === "string" && isEncryptedSecret(v)) {
      bag[key] = await decryptSecret(env, v);
    }
  }
  return config;
}

/** Convenience: getConfig + decryptConfigSecrets in one call. */
export async function getDecryptedConfig(env: Env): Promise<SiteConfig> {
  const config = await getConfig(env.DB);
  return decryptConfigSecrets(env, config);
}

/**
 * Pre-encrypt sensitive keys in an admin config-update payload. Returns
 * a new object with sensitive values replaced by their ciphertext; the
 * admin handler should pass the result through to setConfigValues().
 *
 * Empty-string values are passed through unencrypted so admins can still
 * "clear" a credential without writing junk that decryptSecret would
 * later fail on.
 */
export async function encryptConfigUpdates(
  env: Env,
  updates: Partial<Record<string, unknown>>,
): Promise<Partial<Record<string, unknown>>> {
  const out: Partial<Record<string, unknown>> = { ...updates };
  for (const [k, v] of Object.entries(out)) {
    if (!SENSITIVE_CONFIG_KEYS.has(k)) continue;
    if (typeof v !== "string" || v === "") continue;
    out[k] = await encryptSecret(env, v);
  }
  return out;
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
