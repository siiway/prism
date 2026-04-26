/// <reference types="@cloudflare/workers-types" />

// This file is auto-updated by `wrangler types` after running:
//   pnpm install && wrangler types
// The Env interface below mirrors wrangler.jsonc bindings.

interface Env {
  // D1 Database
  DB: D1Database;
  // KV Namespaces
  KV_SESSIONS: KVNamespace;
  KV_CACHE: KVNamespace;
  // R2 Bucket (optional — omit binding to disable file uploads)
  R2_ASSETS?: R2Bucket;
  // Static assets (auto-provided by CF when `assets` dir is configured)
  ASSETS?: Fetcher;
  // Vars
  APP_URL: string;
  // Cloudflare Secrets Store binding for the master encryption key used to
  // wrap OAuth client secrets, OAuth source credentials, and other
  // sensitive site_config fields at rest in D1. Optional — when unset the
  // worker stores those fields in plaintext (legacy behaviour). The
  // stored secret value must be a 32-byte AES-GCM key encoded as
  // base64url. See Admin Panel → Settings → Danger Zone → "Migrate
  // secrets to Secret Store" for the migration flow.
  SECRETS_KEY?: SecretsStoreSecret;
}
