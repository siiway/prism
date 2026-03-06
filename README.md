# Prism

A self-hosted OAuth 2.0 / OpenID Connect identity platform built on Cloudflare Workers. Deploy globally in minutes with zero servers.

## Features

- **OAuth 2.0 authorization server** — authorization code + PKCE, OpenID Connect, token introspection/revocation
- **Social login** — GitHub, Google, Microsoft, Discord
- **Multi-factor auth** — TOTP (RFC 6238), passkeys (WebAuthn)
- **App registry** — users register and manage their own OAuth apps
- **Domain verification** — DNS TXT-based with auto re-verification
- **Bot protection** — Cloudflare Turnstile, hCaptcha, reCAPTCHA v3, or proof-of-work (WASM)
- **Admin panel** — user management, app moderation, audit log, full site config
- **Customizable** — site name, icon, accent color, custom CSS, email provider
- **Edge-native** — Cloudflare Workers + D1 + KV + R2, no servers

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
pnpm install

# 2. Provision Cloudflare resources
wrangler d1 create prism-db
wrangler kv namespace create KV_SESSIONS
wrangler kv namespace create KV_CACHE
wrangler r2 bucket create prism-assets

# 3. Fill in the resource IDs in wrangler.jsonc

# 4. Run migrations
pnpm db:migrate

# 5. Start dev servers (two terminals)
pnpm worker:dev   # Wrangler on :8787
pnpm dev          # Vite on :5173
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

All scripts auto-install missing toolchain dependencies (Rust, wasm-pack, Node.js, pnpm).

Optional flags: `--skip-wasm` (skip PoW WASM compilation), `--skip-frontend` (skip Vite build)

## Deploy

```bash
pnpm deploy   # type-checks + builds frontend + wrangler deploy
```

## Documentation

- [Getting Started](docs/getting-started.md) — full setup walkthrough
- [Configuration](docs/configuration.md) — all site config keys
- [API Reference](docs/api.md) — REST API documentation
- [OAuth / OIDC Guide](docs/oauth.md) — integrating Prism as an identity provider
- [Architecture](docs/architecture.md) — system design and data model
- [Admin Guide](docs/admin.md) — managing users, apps, and settings

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

GNU General Public License 3.0.
