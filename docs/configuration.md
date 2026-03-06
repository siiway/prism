---
title: Configuration
description: All runtime configuration keys stored in D1, plus Wrangler environment variables and secrets.
---

# Configuration

Site configuration is stored in the `site_config` D1 table and editable at runtime
through **Admin → Settings**. No redeployment is needed to change any of these values.

## General

| Key                          | Type    | Default                         | Description                                                 |
|------------------------------|---------|---------------------------------|-------------------------------------------------------------|
| `site_name`                  | string  | `"Prism"`                       | Displayed in the browser title and emails                   |
| `site_description`           | string  | `"Federated identity platform"` | Shown on the login page                                     |
| `site_icon_url`              | string? | `null`                          | URL to a favicon / logo                                     |
| `allow_registration`         | boolean | `true`                          | Allow new users to self-register                            |
| `require_email_verification` | boolean | `false`                         | Block login until email is verified                         |
| `accent_color`               | string  | `"#0078d4"`                     | Primary brand color (hex). Drives FluentUI theme            |
| `custom_css`                 | string  | `""`                            | Injected as a `<style>` block on every page                 |
| `initialized`                | boolean | `false`                         | Set to `true` after first-run setup. Do not change manually |

## Sessions & tokens

| Key                        | Type   | Default | Description                          |
|----------------------------|--------|---------|--------------------------------------|
| `session_ttl_days`         | number | `30`    | How long a user session JWT is valid |
| `access_token_ttl_minutes` | number | `60`    | OAuth access token lifetime          |
| `refresh_token_ttl_days`   | number | `30`    | OAuth refresh token lifetime         |

## Bot protection (captcha)

Exactly one provider can be active at a time.

| Key                  | Type   | Default  | Description                                                    |
|----------------------|--------|----------|----------------------------------------------------------------|
| `captcha_provider`   | string | `"none"` | `none` \| `turnstile` \| `hcaptcha` \| `recaptcha` \| `pow`    |
| `captcha_site_key`   | string | `""`     | Public site key for the chosen provider                        |
| `captcha_secret_key` | string | `""`     | Server-side secret for the chosen provider                     |
| `pow_difficulty`     | number | `20`     | Leading zero bits required for proof-of-work (higher = harder) |

**Proof-of-work** requires no third-party service. Difficulty 20 takes ~0.1–2 s
depending on device. Values above 24 may timeout on low-end mobile devices.

## Social login

All fields are empty by default (provider disabled).

| Key                       | Description                          |
|---------------------------|--------------------------------------|
| `github_client_id`        | GitHub OAuth App Client ID           |
| `github_client_secret`    | GitHub OAuth App Client Secret       |
| `google_client_id`        | Google Cloud OAuth 2.0 Client ID     |
| `google_client_secret`    | Google Cloud OAuth 2.0 Client Secret |
| `microsoft_client_id`     | Azure AD Application (client) ID     |
| `microsoft_client_secret` | Azure AD Client Secret               |
| `discord_client_id`       | Discord Application ID               |
| `discord_client_secret`   | Discord Client Secret                |

Callback URLs to register with each provider:

| Provider  | Callback URL                                             |
|-----------|----------------------------------------------------------|
| GitHub    | `https://your-domain/api/connections/github/callback`    |
| Google    | `https://your-domain/api/connections/google/callback`    |
| Microsoft | `https://your-domain/api/connections/microsoft/callback` |
| Discord   | `https://your-domain/api/connections/discord/callback`   |

## Email

| Key              | Type   | Default                 | Description                          |
|------------------|--------|-------------------------|--------------------------------------|
| `email_provider` | string | `"none"`                | `none` \| `resend` \| `mailchannels` |
| `email_api_key`  | string | `""`                    | API key for Resend or Mailchannels   |
| `email_from`     | string | `"noreply@example.com"` | From address for outgoing emails     |

## Domain verification

| Key                    | Type   | Default | Description                                               |
|------------------------|--------|---------|-----------------------------------------------------------|
| `domain_reverify_days` | number | `30`    | Days between automatic re-verification checks for domains |

## Wrangler environment variables

These are set in `wrangler.jsonc` under `vars` or via `wrangler secret put` and
are not editable from the admin panel.

| Variable  | Required | Description                                                    |
|-----------|----------|----------------------------------------------------------------|
| `APP_URL` | Yes      | Full origin of the deployment, e.g. `https://auth.example.com` |
