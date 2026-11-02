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
- **Admin panel** — user/app/team moderation, audit log, login errors, full site config
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

You need [Bun](https://bun.sh) and a Cloudflare account (the free tier is enough).

```bash
git clone https://github.com/siiway/prism
cd prism/app
bun install
bun run setup
```

Setup signs you in to Cloudflare, asks for your URL, creates the database and storage, and deploys. Open your URL to create the admin account. See [Getting Started](https://prism.wss.moe/getting-started) for details.

To update, in `app/`: `git pull`, `bun install`, `bun run deploy`.

To work on Prism itself, see [CONTRIBUTING.md](./.github/CONTRIBUTING.md).

## Documentation

- [Getting Started](https://prism.wss.moe/getting-started) — full setup walkthrough
- [Configuration](https://prism.wss.moe/configuration) — all site config keys + Wrangler bindings

- [Admin Guide](https://prism.wss.moe/admin) — managing users, apps, teams, and settings
- [API Reference](https://prism.wss.moe/api) — REST API documentation
- [OAuth / OIDC Guide](https://prism.wss.moe/oauth) — integrating Prism as an identity provider
- [Teams](https://prism.wss.moe/teams) — shared ownership of apps and domains
- [Notifications](https://prism.wss.moe/notifications) — email and Telegram notification rules
- [Webhooks](https://prism.wss.moe/webhooks) and [App Notifications](https://prism.wss.moe/app-notifications)
- [Cross-App Permissions](https://prism.wss.moe/app-permissions) — exposing scopes to other apps
- [Personal Access Tokens](https://prism.wss.moe/personal-access-tokens) and [Public Profiles](https://prism.wss.moe/public-profile)

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
