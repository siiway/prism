---
title: Getting Started
description: Set up Prism on Cloudflare Workers from scratch — provisioning resources, secrets, migrations, and your first deploy.
---

# Getting Started

## Prerequisites

- [Node.js](https://nodejs.org) 20+ and [pnpm](https://pnpm.io) 9+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`pnpm add -g wrangler`)
- A Cloudflare account (free tier is sufficient)
- _(Optional)_ Rust + wasm-pack for the PoW WASM accelerator

The build scripts (`scripts/build.sh`, `build.ps1`, `build.py`) install all missing
toolchain components automatically.

## 1. Install dependencies

```bash
pnpm install
```

## 2. Provision Cloudflare resources

### D1 database

```bash
wrangler d1 create prism-db
```

Copy the `database_id` into `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "prism-db",
    "database_id": "<paste here>"
  }
]
```

### KV namespaces

```bash
wrangler kv namespace create KV_SESSIONS
wrangler kv namespace create KV_CACHE
```

Copy the two `id` values into `wrangler.jsonc`. Each namespace also needs a
`preview_id` for local dev — run the same commands with `--preview` appended or
just reuse the same IDs for local testing.

### R2 bucket

```bash
wrangler r2 bucket create prism-assets
```

The bucket name is already set in `wrangler.jsonc` as `prism-assets`.

## 3. Run migrations

```bash
pnpm db:migrate          # local D1 (wrangler dev)
pnpm db:migrate:prod     # production D1
```

## 5. Start development servers

In one terminal:

```bash
pnpm worker:dev    # Wrangler on http://localhost:8787
```

In another terminal:

```bash
pnpm dev           # Vite on http://localhost:5173
```

Vite proxies all `/api/*` requests to the Wrangler process, so you only need to
open <http://localhost:5173>.

## 6. First-run setup

On first visit, Prism redirects you to `/init`. Fill in:

- **Email** — the admin account email
- **Username** — alphanumeric, used in profile URLs
- **Display name** — shown in the UI
- **Password**
- **Site name** — shown in the browser title and emails

Submitting creates the first admin account and marks the instance as initialized.
Subsequent visits go directly to the login page.

## 7. (Optional) Build PoW WASM

The proof-of-work bot protection has a pure-JS fallback but runs ~10× faster with
the WASM module compiled from `pow/src/lib.rs`.

```bash
cd pow
wasm-pack build --target no-modules --out-dir ../public/pow-wasm
cp ../public/pow-wasm/prism_pow_bg.wasm ../public/pow.wasm
```

Or use any of the build scripts which do this automatically:

```bash
bash scripts/build.sh --skip-frontend
```

## 8. Deploy to production

```bash
pnpm deploy
```

This runs `tsc -b && vite build` then `wrangler deploy`. The Cloudflare Assets
integration serves the built SPA with single-page-application fallback, so all
routes resolve to `index.html`.

Don't forget to update `APP_URL` in `wrangler.jsonc` to your production domain
before deploying:

```jsonc
"vars": {
  "APP_URL": "https://auth.yourdomain.com"
}
```

## Social login setup

Each provider requires an OAuth app registration. See the [OAuth / OIDC Guide](oauth.md)
for the exact callback URLs.

After obtaining a client ID and secret, go to **Admin → Settings → Social Login**
and enter them there. No redeployment is required — settings are stored in D1.

## Email setup

Prism supports two email providers, configured in **Admin → Settings → Email**.

| Provider     | `email_provider` value | Key variable               |
| ------------ | ---------------------- | -------------------------- |
| Resend       | `resend`               | `email_api_key` (Admin UI) |
| Mailchannels | `mailchannels`         | — (no key needed)          |
| None / off   | `none`                 | —                          |

Email is used for email verification. It is optional — set
`require_email_verification = false` (the default) to skip it.
