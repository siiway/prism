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
  // Vars
  APP_URL: string;
}
