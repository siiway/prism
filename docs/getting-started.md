---
title: Getting Started
description: Set up Prism on Cloudflare Workers from scratch — provisioning resources, secrets, migrations, and your first deploy.
---

# Getting Started

## Prerequisites

- [Bun](https://bun.sh) 1.1+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`bun add -g wrangler`)
- A Cloudflare account (the free tier is enough)
- _(Optional)_ Rust and wasm-pack, for the faster proof-of-work solver

The build scripts (`scripts/build.sh`, `build.ps1`, `build.py`) install any
missing toolchain pieces for you.

## 1. Install dependencies

```bash
bun install
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
    "database_id": "<paste here>",
    "migrations_dir": "src/worker/db/migrations"
  }
]
```

### KV namespaces

```bash
wrangler kv namespace create KV_SESSIONS
wrangler kv namespace create KV_CACHE
```

Copy the two `id` values into `wrangler.jsonc`. Each also needs a `preview_id`
for local development; run the same commands with `--preview`, or reuse the same
IDs.

### R2 bucket _(optional)_

R2 stores uploaded avatars and app icons that are too big to keep in D1. The
binding is commented out by default, so you can deploy without it. To enable it:

```bash
wrangler r2 bucket create prism-assets
```

Then uncomment the `r2_buckets` block in `wrangler.jsonc`.

### Secrets Store (strongly recommended)

A master key in a Cloudflare Secrets Store encrypts sensitive values (OAuth
client secrets, captcha secrets, SMTP/IMAP passwords) and stores access tokens
and codes as keyed hashes. Generate a 32-byte key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Create a Secrets Store in the Cloudflare dashboard, save the value under the
name `prism-secrets-key`, and add the binding to `wrangler.jsonc`:

```jsonc
"secrets_store_secrets": [
  {
    "binding": "SECRETS_KEY",
    "store_id": "<your-store-id>",
    "secret_name": "prism-secrets-key"
  }
]
```

Without this binding Prism still works, with plaintext storage. You can add it
later.

## 3. Run migrations

```bash
bun db:migrate          # local D1
bun db:migrate:prod     # production D1
```

## 4. Set `APP_URL`

Tell the Worker its public origin in `wrangler.jsonc`:

```jsonc
"vars": {
  "APP_URL": "https://auth.yourdomain.com"
}
```

For local development, leave the default (`http://localhost:5173`).

The same block holds optional settings such as `LOCKDOWN_USERS` /
`LOCKDOWN_TEAMS` (accounts and teams nobody can delete) and `ENABLE_RESET`
(shows the **Site reset** button). See
[Configuration](configuration.md#wrangler-bindings-variables).

## 5. Start the development server

```bash
bun dev
```

Vite starts on `http://localhost:5173` and runs the Worker alongside it, so you
don't need a separate `wrangler dev`.

## 6. First-run setup

On your first visit Prism redirects you to `/init`. Fill in:

- **Email** — the admin account's email
- **Username** — letters and digits, used in profile URLs
- **Display name**
- **Password**
- **Site name** — shown in the browser title and emails

This creates the first admin account. After that, visits go straight to the
login page.

## 7. Deploy to production

```bash
bash scripts/deploy.sh          # or: pwsh scripts/deploy.ps1
                                # or: python scripts/deploy.py
```

The script builds, applies pending D1 migrations, then publishes the Worker, in
that order. It lists the pending migrations before asking you to confirm.

| Option              | Effect                                   |
| ------------------- | ---------------------------------------- |
| `--dry-run`         | Print each command instead of running it |
| `-y`, `--yes`       | Skip the confirmation prompt (for CI)    |
| `--migrations-only` | Apply migrations without deploying       |
| `--skip-migrations` | Publish without touching the database    |
| `--skip-build`      | Deploy what is already in `dist/`        |

`bun deploy` also works but **doesn't apply migrations**. Run
`bun db:migrate:prod` first. Always apply migrations before deploying new code;
some security features fail closed until their tables exist.

### CI

The repository's GitHub Actions deploy on every push to `main` and run checks on
pull requests. Deploys need a `CLOUDFLARE_API_TOKEN` secret with **Workers
Scripts:Edit**, **D1:Edit**, **Workers KV Storage:Edit** and **Secrets
Store:Read** permissions, plus **Workers Routes:Edit** and **Zone:Read** if you
use a custom domain. If the repository is also connected to Cloudflare Workers
Builds, disconnect it, or every push deploys twice.

## 8. After deploying: encrypt secrets

If you bound `SECRETS_KEY`, sign in as the admin and open **Admin → Maintenance
→ Danger zone**. Run these once; both are safe to repeat:

- **Migrate secrets to Secrets Store** — encrypts existing secrets.
- **Migrate D1 secrets** — replaces stored tokens and codes with keyed hashes.

## Social login

Add providers under **Admin → OAuth Sources**. See
[Social Login Setup](social-login.md).

## Email

Prism can send email through Resend, Mailchannels or SMTP, configured in
**Admin → Settings → Email**. Email is used for verification, password reset and
notifications.

| Provider     | `email_provider` |
| ------------ | ---------------- |
| Resend       | `resend`         |
| Mailchannels | `mailchannels`   |
| SMTP         | `smtp`           |
| Off          | `none`           |

By default users can sign in before verifying their email; turn on
`require_email_verification` to change that. To let users verify by sending an
email to Prism, use Cloudflare Email Workers or an IMAP mailbox (see the
[Admin Guide](admin.md#email)).
