---
title: Getting Started
description: Deploy Prism to your Cloudflare account with one command.
---

# Getting Started

## Prerequisites

- [Bun](https://bun.sh) 1.3+
- A Cloudflare account (the free tier is enough)
- _(Optional)_ [Rust](https://rustup.rs), for the faster proof-of-work solver.
  Without it, browsers use a slower JavaScript solver.

## Deploy

```bash
git clone https://github.com/siiway/prism
cd prism/app
bun install
bun run setup
```

Setup:

1. Signs you in to Cloudflare (it opens a browser).
2. Asks for the Worker name and the public URL: a domain on your Cloudflare
   account, such as `https://auth.example.com`, or a `workers.dev` address.
3. Creates the D1 database and KV namespaces and, if you want them, an R2
   bucket for uploaded images and a Secrets Store key that encrypts stored
   secrets.
4. Writes their IDs, your URL and your account into `app/wrangler.jsonc`.
5. Builds, applies the database migrations and deploys.

Setup reuses resources that already exist, so you can run it again, for example
to add R2 later. `bun run setup --dry-run` shows what it would do without
changing anything.

## First-run setup

On your first visit Prism redirects you to `/init`. Enter the admin account's
email, username, display name and password, and the site name. After that,
visits go straight to the login page.

## Updating

In `app/`:

```bash
git pull
bun install
bun run deploy
```

`bun run deploy` builds, applies pending database migrations, then publishes the Worker. It
lists the pending migrations and asks before touching production. Use it
instead of `wrangler deploy`, which skips the migrations.

| Option              | Effect                                   |
| ------------------- | ---------------------------------------- |
| `--dry-run`         | Print each command instead of running it |
| `-y`, `--yes`       | Don't ask for confirmation (for CI)      |
| `--migrations-only` | Apply migrations without deploying       |
| `--skip-migrations` | Publish without touching the database    |
| `--skip-build`      | Deploy what is already in `dist/`        |

### CI

The repository's GitHub Actions deploy on every push to `main` and run checks on
pull requests. Deploys need a `CLOUDFLARE_API_TOKEN` secret with **Workers
Scripts:Edit**, **D1:Edit**, **Workers KV Storage:Edit** and **Secrets
Store:Read** permissions, plus **Workers Routes:Edit** and **Zone:Read** if you
use a custom domain. If the repository is also connected to Cloudflare Workers
Builds, disconnect it, or every push deploys twice.

## Settings in `app/wrangler.jsonc`

The `vars` block holds optional settings such as `LOCKDOWN_USERS` /
`LOCKDOWN_TEAMS` (accounts and teams nobody can delete) and `ENABLE_RESET`
(shows the **Site reset** button). See
[Configuration](configuration.md#wrangler-bindings-variables).

## Adding the Secrets Store key later

If you add the key to a site that already has data, sign in as the admin and
open **Admin → Maintenance → Danger zone**. Run these once; both are safe to
repeat:

- **Migrate secrets to Secret Store**: encrypts existing secrets.
- **Hash and encrypt stored tokens**: stores tokens and codes as keyed hashes.

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
