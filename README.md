# Prism

[中文](./README.zh-CN.md)

A self-hosted OAuth 2.0 / OpenID Connect identity platform built on Cloudflare Workers. Deploy globally in minutes with zero servers.

## Features

- **OAuth 2.0 + OpenID Connect** — authorization code + PKCE, RS256 ID tokens, introspection / revocation, UserInfo, Discovery, JWKS
- **Step-up 2FA** — server-initiated, action-pinned re-confirmation with sudo grace windows for sensitive operations
- **Social & federated login** — GitHub, Google, Microsoft, Discord, Telegram, X, Cloudflare, Generic OIDC, Generic OAuth 2 — multiple sources of the same type
- **Multi-factor auth** — multiple TOTP authenticators per account, passkeys (WebAuthn), GPG keys (incl. ML-DSA), backup codes
- **Teams** — shared ownership of OAuth apps and domains, roles, invites, transfer-ownership, site-floor join requirements
- **App registry** — users register and manage their own OAuth apps; admins can verify; cross-app permission scopes
- **Domain verification** — DNS TXT, HTML meta, or `.well-known` — pick per domain, auto re-verify
- **Bot protection** — Cloudflare Turnstile, hCaptcha, reCAPTCHA v3, or proof-of-work (Rust→WASM); also gates 2FA confirmations
- **Webhooks & notifications** — user + admin webhooks, app event streams (webhook / SSE / WebSocket), email + Telegram notifications with a rule engine
- **Public profiles** — opt-in `/u/<username>` and `/t/<team-id>` pages with per-field visibility, GPG keys, GitHub README sync
- **Encrypted at rest** — AES-GCM envelope + keyed HMAC, rooted in a Cloudflare Secrets Store binding
- **Admin panel** — user/app/team moderation, audit log, request log, login errors, full site config
- **Customizable** — site name, icon, accent color, custom CSS, email provider, captcha provider
- **Edge-native + SSR** — Cloudflare Workers + D1 + KV + R2, server-side rendered React 19, no servers

## Stack

| Layer            | Technology                        |
| ---------------- | --------------------------------- |
| Runtime          | Cloudflare Workers                |
| Router           | Hono v4                           |
| Database         | Cloudflare D1 (SQLite)            |
| Cache / Sessions | Cloudflare KV                     |
| File storage     | Cloudflare R2                     |
| Frontend         | React 19 + FluentUI v9            |
| Routing          | React Router v7                   |
| State            | Zustand v5 + TanStack Query v5    |
| PoW solver       | Rust → WASM (Web Worker fallback) |

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/siiway/prism
cd prism
bun install

# 2. Provision Cloudflare resources
wrangler d1 create prism-db
wrangler kv namespace create KV_SESSIONS
wrangler kv namespace create KV_CACHE
wrangler r2 bucket create prism-assets

# 3. Fill in the resource IDs in wrangler.jsonc

# 4. Run migrations
bun run db:migrate

# 5. Start dev server
bun run dev          # Vite on :5173
```

Open <http://localhost:5173> — you will be redirected to the first-run setup page to create the admin account.

## Build

```bash
# Cross-platform (requires Python 3)
python scripts/build.py

# Linux / macOS
bash scripts/build.sh

# Windows PowerShell
.\scripts\build.ps1
```

All scripts auto-install missing toolchain dependencies (Rust, wasm-pack, Node.js, bun).

Optional flags: `--skip-wasm` (skip PoW WASM compilation), `--skip-frontend` (skip Vite build)

## Deploy

```bash
bun run deploy   # type-checks + builds frontend + wrangler deploy
```

## Documentation

- [Getting Started](https://prism.wss.moe/getting-started) — full setup walkthrough
- [Configuration](https://prism.wss.moe/configuration) — all site config keys + Wrangler bindings
- [Architecture](https://prism.wss.moe/architecture) — system design, data model, secret-storage strategy
- [Admin Guide](https://prism.wss.moe/admin) — managing users, apps, teams, and settings
- [API Reference](https://prism.wss.moe/api) — REST API documentation
- [OAuth / OIDC Guide](https://prism.wss.moe/oauth) — integrating Prism as an identity provider
- [Teams](https://prism.wss.moe/teams) — shared ownership of apps and domains
- [Notifications](https://prism.wss.moe/notifications) — email and Telegram notification rules
- [Webhooks](https://prism.wss.moe/webhooks) and [App Notifications](https://prism.wss.moe/app-notifications)
- [Cross-App Permissions](https://prism.wss.moe/app-permissions) — exposing scopes to other apps
- [Personal Access Tokens](https://prism.wss.moe/personal-access-tokens) and [Public Profiles](https://prism.wss.moe/public-profile)

## Project Structure

```text
prism/
├── worker/                  # Cloudflare Worker (backend)
│   ├── index.ts             # Hono app entry point
│   ├── types.ts             # Shared TypeScript types
│   ├── db/migrations/       # D1 SQL migrations
│   ├── lib/                 # crypto, jwt, totp, webauthn, email, config
│   ├── middleware/          # auth, captcha, rateLimit
│   └── routes/              # init, auth, oauth, apps, domains, connections, user, admin
├── src/                     # React frontend
│   ├── App.tsx              # Router + guards
│   ├── components/          # Layout, ThemeProvider, Captcha
│   ├── pages/               # All page components
│   ├── lib/                 # API client, PoW solver
│   └── store/               # Zustand auth store
├── pow/                     # Rust PoW WASM crate
│   └── src/lib.rs
├── scripts/                 # Cross-platform build scripts
│   ├── build.sh
│   ├── build.ps1
│   └── build.py
├── public/                  # Static assets (pow.wasm lands here after build)
├── wrangler.jsonc           # Cloudflare Worker config
├── tsconfig.app.json        # Frontend TypeScript config
├── tsconfig.worker.json     # Worker TypeScript config
└── tsconfig.node.json       # Node tooling TypeScript config
```

## License

GNU General Public License 3.0. See [LICENSE](./LICENSE) for details.

### Icon

This project uses Microsoft's [fluentui-system-icons](https://github.com/microsoft/fluentui-system-icons) for its icons.
See [THIRD_PARTY_LICENSES/fluentui-system-icons](./THIRD_PARTY_LICENSES/fluentui-system-icons) for details.

### FluentUI

This project uses Microsoft's [fluentui](https://github.com/microsoft/fluentui) for its UI.
See [THIRD_PARTY_LICENSES/fluentui](./THIRD_PARTY_LICENSES/fluentui) for details.

### worker-mailer

This project uses zou-yu's [worker-mailer](https://github.com/zou-yu/worker-mailer/blob/main/LICENSE) for its UI.
See [THIRD_PARTY_LICENSES/worker-mailer](./THIRD_PARTY_LICENSES/worker-mailer) for details.
