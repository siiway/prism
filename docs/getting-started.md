---
title: Getting Started
description: Set up Prism on Cloudflare Workers from scratch — provisioning resources, secrets, migrations, and your first deploy.
---

# Getting Started

## Prerequisites

- [Bun](https://bun.sh) 1.1+ (or `pnpm` — both lockfiles are kept in sync)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`bun add -g wrangler`)
- A Cloudflare account (free tier is sufficient)
- _(Optional)_ Rust + wasm-pack for the PoW WASM accelerator

The build scripts (`scripts/build.sh`, `build.ps1`, `build.py`) install all
missing toolchain components automatically.

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
    "migrations_dir": "worker/db/migrations"
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

### R2 bucket _(optional)_

R2 is only used for hosted avatars and app icons larger than what fits inline
in D1; smaller uploads are stored directly. The binding is commented out in the
default `wrangler.jsonc` so you can deploy without it. To enable R2:

```bash
wrangler r2 bucket create prism-assets
```

…then uncomment the `r2_buckets` block in `wrangler.jsonc`.

### Secrets Store (strongly recommended)

Generate a 32-byte master key and store it in a Cloudflare Secrets Store. This
encrypts every sensitive value at rest (OAuth `client_secret`s, captcha secret,
SMTP/IMAP passwords, GitHub README PAT, plus the bearer-style tokens listed in
[Architecture → Secrets at rest](architecture.md#secrets-at-rest)).

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Create a Secrets Store in the Cloudflare dashboard, save the generated value
under name `prism-secrets-key`, then add the binding to `wrangler.jsonc`:

```jsonc
"secrets_store_secrets": [
  {
    "binding": "SECRETS_KEY",
    "store_id": "<your-store-id>",
    "secret_name": "prism-secrets-key"
  }
]
```

If you skip this binding, encryption/hashing degrades to a no-op and Prism stays
fully functional with plaintext storage. You can opt in later — the migration
endpoints in **Admin → Settings → Danger Zone** are idempotent.

## 3. Run migrations

```bash
bun db:migrate          # local D1
bun db:migrate:prod     # production D1
```

## 4. Set `APP_URL`

Update `wrangler.jsonc` so the Worker knows its public origin:

```jsonc
"vars": {
  "APP_URL": "https://auth.yourdomain.com"
}
```

For local dev, leave it as the default — the dev server uses
`http://localhost:5173`.

The `vars` block also contains three optional zero-config knobs:

- `LOCKDOWN_USERS` / `LOCKDOWN_TEAMS` — comma-separated lists of
  usernames / team names that are permanently protected from deletion
  (the API returns 403). Leave empty to disable.
- `ENABLE_RESET` — set to `"true"` to surface the **Site reset** button
  in the admin Danger Zone. Off by default to prevent accidental wipes.
  `NO_RESET_COOLDOWN` skips the 30-minute wait before confirming the reset.

See [Configuration](configuration.md#wrangler-bindings--variables) for the
full set of Wrangler vars and bindings.

## 5. Start development server

```bash
bun dev
```

Vite starts on `http://localhost:5173`. The
[Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/)
runs the Worker in-process alongside Vite — no separate `wrangler dev` needed,
and `entry-server.tsx` (SSR) is hot-reloaded along with the rest of the SPA.

## 6. First-run setup

On first visit, Prism redirects you to `/init`. Fill in:

- **Email** — the admin account email
- **Username** — alphanumeric, used in profile URLs
- **Display name** — shown in the UI
- **Password**
- **Site name** — shown in the browser title and emails

Submitting creates the first admin account and marks the instance as
initialized. Subsequent visits go directly to the login page.

## 7. (Optional) Build PoW WASM

The proof-of-work bot protection has a pure-JS fallback but runs ~10× faster
with the WASM module compiled from `pow/src/lib.rs`.

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
bash scripts/deploy.sh          # or: pwsh scripts/deploy.ps1
                                # or: python scripts/deploy.py
```

The deploy scripts build, apply any pending D1 migrations, and publish the
Worker, in that order: a compile error stops the run before anything reaches
production, and migrations land before the code that depends on them. Prism's
migrations are additive, so the currently-deployed Worker keeps running
against the new schema while the deploy finishes.

Pending migrations are listed before the confirmation prompt, so you see what
is about to be applied. Useful options:

| Option              | Effect                                   |
| ------------------- | ---------------------------------------- |
| `--dry-run`         | Print each command instead of running it |
| `-y`, `--yes`       | Skip the confirmation prompt (for CI)    |
| `--migrations-only` | Apply migrations without deploying       |
| `--skip-migrations` | Publish without touching the database    |
| `--skip-build`      | Deploy what is already in `dist/`        |

Cloudflare Workers Builds runs the same script on every push to `main`: the
build command is `bash scripts/build.sh` and the deploy command is
`bash scripts/deploy.sh --skip-build --yes`, so CI deploys apply pending
migrations exactly the way a local deploy does.

`bun deploy` remains available and runs `tsc -b && vite build` then
`wrangler deploy` — note that it does **not** apply migrations, so apply them
yourself (`bun db:migrate:prod`) if you use it.

Either way the build emits a deploy-ready `dist/prism/wrangler.json` —
production deploys must use that config so Vite's SSR pass is preserved (a
plain `wrangler deploy` from the project root re-bundles the source and skips
SSR). The provided build scripts copy the generated config back into place
automatically.

## 9. Post-deploy: encrypt secrets

If you bound `SECRETS_KEY`, log in as the admin and visit
**Admin → Settings → Danger Zone**. Run the two migrations once:

- **Migrate secrets to Secrets Store** — encrypts existing site_config secret
  values and OAuth-app/source `client_secret`s.
- **Migrate D1 secrets** — replaces plaintext bearer-style values (PATs, OAuth
  tokens/codes, invite tokens, email-verify codes, 2FA codes, individual backup
  codes) with HMAC-SHA256 keyed hashes.

Both are idempotent — re-running is safe.

## Social login setup

Each provider requires an OAuth app registration. Add OAuth Sources in
**Admin → OAuth Sources** — multiple sources of the same provider type are
supported, each with its own slug. See
[Social Login Setup](social-login.md) for per-provider walkthroughs and
[OAuth / OIDC Guide](oauth.md) for the callback URL format.

## Email setup

Prism supports three send providers and two receive providers, configured in
**Admin → Settings → Email**.

| Provider     | `email_provider` value | Key variable               |
| ------------ | ---------------------- | -------------------------- |
| Resend       | `resend`               | `email_api_key` (Admin UI) |
| Mailchannels | `mailchannels`         | `email_api_key` (Admin UI) |
| SMTP         | `smtp`                 | See UI                     |
| None / off   | `none`                 | —                          |

Email is used for verification, password reset, and notifications. Setting
`require_email_verification = false` (the default) lets users log in before
verifying.

For inbound mail (verify-by-sending), enable Cloudflare Email Workers or set
`email_receive_provider = imap` and configure the polling mailbox.
