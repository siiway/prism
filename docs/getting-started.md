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

A deploy and a migration are two commands, and nothing makes them atomic.
Features whose storage arrived in a migration are written to survive the gap:
if their tables are not there yet, that feature reports itself unavailable and
nothing else is affected. The [notice board](admin.md#notice-board) is the
current example — its board reads as empty and **Admin → Notices** returns a
503 naming the command to run, rather than the missing table taking down every
page that renders the board.

Security-enforcement migrations are deliberately fail-closed rather than
optional. In particular, `0073_atomic_security_state.sql` must be applied before
deploying the code that uses it; without those tables, affected authentication
and OAuth requests fail instead of falling back to non-atomic KV checks. The
provided production and CI deployment scripts already enforce this order. If
you use `bun deploy`, `--skip-migrations`, or a `deploy:*` non-production script,
run the matching `db:migrate:*` command first.

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

## Non-production environments (staging & preview)

`wrangler.jsonc` defines two non-production environments — `staging` and
`preview` — each a separate Worker with its own isolated D1 database and KV
namespaces, so testing never touches production data. They live on the same
Cloudflare account as production and are reached at their `*.workers.dev`
subdomains (no custom domain, and the domain re-verify cron is disabled).

| Task    | staging                  | preview                  |
| ------- | ------------------------ | ------------------------ |
| Dev     | `bun dev:staging`        | `bun dev:preview`        |
| Migrate | `bun db:migrate:staging` | `bun db:migrate:preview` |
| Deploy  | `bun deploy:staging`     | `bun deploy:preview`     |

The environment is selected at build time through the `CLOUDFLARE_ENV`
variable (the `dev:*` / `deploy:*` scripts set it for you). This is why deploys
go through the generated `dist/prism/wrangler.json` rather than
`wrangler deploy --env <name>` — the Vite plugin resolves exactly one
environment per build, so the emitted config is already environment-specific.
Like `bun deploy`, the `deploy:*` scripts do **not** apply migrations; run the
matching `db:migrate:*` first.

Each environment has its own `SECRETS_KEY` — prod, staging, and preview point
at three distinct Secret Store entries (`prism-secrets-key`,
`prism-staging-secrets-key`, `prism-preview-secrets-key`), all in the same
store. A leak or mistake in a throwaway non-prod environment can never expose
data encrypted under another environment's key. Create a fresh 32-byte
base64url key per environment (see step 2) and reference it by `secret_name`
in the `env` block.

To stand up another non-prod environment from scratch, create its resources
and paste the IDs into a new `env` block in `wrangler.jsonc`:

```bash
wrangler d1 create prism-staging-db
wrangler kv namespace create prism-staging-sessions
wrangler kv namespace create prism-staging-cache
```

…then run `bun db:migrate:staging` before the first `bun deploy:staging`.

### CI (GitHub Actions)

Production is built and deployed by **Cloudflare Workers Builds** (the Git
repository is connected in the dashboard under the `prism` Worker's
**Settings → Builds**), which runs on pushes to `main`. GitHub Actions never
touches production; it covers the non-production Workers only.

- **Pull requests** (`.github/workflows/pr.yml`) run the checks — typecheck
  (app + worker), lint, translation parity, and a build — then deploy the PR's
  code to the shared **preview** Worker (`prism-preview`) once the checks pass.
  Preview is one shared Worker on its own database, so the most recently
  deployed PR is what is live there; the workflow posts the URL as a PR comment.
  Fork PRs get the checks but not the deploy (secrets are withheld from forks).
  - **Force a redeploy with a PR comment** (`.github/workflows/preview-comment.yml`):
    comment `<!try_redeploy!>` on the PR to redeploy preview even when the
    checks failed — handy to re-run after a transient failure or right after
    adding the secret. It runs only when the commenter is on the allowlist
    **and** the PR is from a same-repo branch (a fork's code is never checked
    out — the comment trigger has repository secrets, so this stays strictly on
    trusted code). The allowlist is the repo variable `PREVIEW_DEPLOY_ALLOWLIST`
    (comma-separated GitHub usernames; defaults to the repository owner when
    unset). Ordinary on-commit deploys are unaffected — they still deploy only
    when checks pass.
- **Staging** (`.github/workflows/deploy-nonprod.yml`) deploys on a push to the
  `staging` branch, or a manual run (which can target staging or preview).

Both deploy workflows need one repository secret, `CLOUDFLARE_API_TOKEN`,
scoped to the account with **Workers Scripts:Edit**, **D1:Edit**,
**Workers KV Storage:Edit**, and **Secrets Store:Read** (the Workers bind a
Secrets Store `SECRETS_KEY`). The account id is pinned in `wrangler.jsonc`, so
no account-id secret is required.

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
