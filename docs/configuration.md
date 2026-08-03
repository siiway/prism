---
title: Configuration
description: All runtime configuration keys stored in D1, plus Wrangler bindings, environment variables, and secrets.
---

# Configuration

Site configuration is stored in the `site_config` D1 table and editable at runtime
through **Admin → Settings**. No redeployment is needed to change any of these values.

Sensitive keys (captcha secret, social client secrets, SMTP/IMAP passwords, the
GitHub README PAT, Discord bot token) are encrypted at rest with AES-GCM via the
[`SECRETS_KEY`](#wrangler-bindings--variables) Cloudflare Secrets Store binding.
The admin panel transparently decrypts on read; values are never exposed via the
config API.

## General

| Key                          | Type    | Default                         | Description                                                                |
| ---------------------------- | ------- | ------------------------------- | -------------------------------------------------------------------------- |
| `site_name`                  | string  | `"Prism"`                       | Displayed in the browser title and emails                                  |
| `site_description`           | string  | `"Federated identity platform"` | Shown on the login page                                                    |
| `site_icon_url`              | string? | `null`                          | URL to a favicon / logo                                                    |
| `allow_registration`         | boolean | `true`                          | Allow new users to self-register                                           |
| `invite_only`                | boolean | `false`                         | Require an invite token to register, even when `allow_registration = true` |
| `require_email_verification` | boolean | `false`                         | Block login until email is verified                                        |
| `accent_color`               | string  | `"#0078d4"`                     | Primary brand color (hex). Drives FluentUI theme                           |
| `custom_css`                 | string  | `""`                            | Injected as a `<style>` block on every page                                |
| `disable_user_create_team`   | boolean | `false`                         | Hide the "New team" button — only admins can create teams                  |
| `disable_user_create_app`    | boolean | `false`                         | Hide the "New application" button — only admins can create OAuth apps      |
| `allow_alt_email_login`      | boolean | `true`                          | Let users sign in with any verified secondary email, not just primary      |
| `initialized`                | boolean | `false`                         | Set to `true` after first-run setup. Do not change manually                |

## Sessions & tokens

| Key                        | Type   | Default | Description                                                                                                          |
| -------------------------- | ------ | ------- | -------------------------------------------------------------------------------------------------------------------- |
| `session_ttl_days`         | number | `30`    | Session JWT lifetime. Per-user override via `users.access_token_ttl_minutes` / `refresh_token_ttl_days` (admin-only) |
| `access_token_ttl_minutes` | number | `60`    | OAuth access token lifetime (default; per-user override available)                                                   |
| `refresh_token_ttl_days`   | number | `30`    | OAuth refresh token lifetime (default; per-user override available)                                                  |

## Bot protection (captcha)

Exactly one provider can be active at a time. The captcha is challenged on
register, login, password change, email-verification resend, and any flow the
admin enables.

| Key                  | Type   | Default  | Description                                                    |
| -------------------- | ------ | -------- | -------------------------------------------------------------- |
| `captcha_provider`   | string | `"none"` | `none` \| `turnstile` \| `hcaptcha` \| `recaptcha` \| `pow`    |
| `captcha_site_key`   | string | `""`     | Public site key for the chosen provider                        |
| `captcha_secret_key` | string | `""`     | Server-side secret for the chosen provider (encrypted at rest) |
| `pow_difficulty`     | number | `20`     | Leading zero bits required for proof-of-work (higher = harder) |

**Proof-of-work** requires no third-party service. The Rust→WASM solver in
`pow/` runs ~10× faster than the JS fallback. Difficulty 20 takes ~0.1–2 s
depending on device. Values above 24 may time out on low-end mobile devices.
PoW is single-use and replay-protected via the `pow_used` table.

## Two-factor / step-up

| Key                       | Type    | Default | Description                                                                                                                                                                |
| ------------------------- | ------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sudo_mode_ttl_minutes`   | number  | `5`     | After a successful step-up, subsequent challenges from the same `(user, session, app)` skip the TOTP/passkey prompt for this many minutes. `0` disables sudo mode entirely |
| `require_captcha_for_2fa` | boolean | `false` | Site-wide: every step-up confirmation must solve the active captcha. Apps can also opt in per challenge. No-op when `captcha_provider = none`                              |

## Public profiles

User and team public profiles are off until the user (or team owner) explicitly
opts in. Site defaults apply only to fields the user has not customized — they
never silently flip a private profile to public.

### User profile defaults

| Key                                    | Type    | Default | Description                                                                             |
| -------------------------------------- | ------- | ------- | --------------------------------------------------------------------------------------- |
| `enable_public_profiles`               | boolean | `true`  | Master kill switch. `false` ⇒ both `/u/:username` and `/t/:id` always 404               |
| `default_profile_show_display_name`    | boolean | `true`  |                                                                                         |
| `default_profile_show_avatar`          | boolean | `true`  |                                                                                         |
| `default_profile_show_email`           | boolean | `false` | Sensitive — opt-in even when the rest of the profile is public                          |
| `default_profile_show_joined_at`       | boolean | `true`  |                                                                                         |
| `default_profile_show_gpg_keys`        | boolean | `true`  |                                                                                         |
| `default_profile_show_authorized_apps` | boolean | `false` | Reveals the user's connected services — opt-in                                          |
| `default_profile_show_owned_apps`      | boolean | `true`  |                                                                                         |
| `default_profile_show_domains`         | boolean | `true`  |                                                                                         |
| `default_profile_show_joined_teams`    | boolean | `false` | Also gates appearing in any team's public member list                                   |
| `default_profile_show_readme`          | boolean | `true`  | README is itself opt-in (empty = hidden); this only matters if the user has written one |
| `profile_readme_max_bytes`             | number  | `65536` | Hard cap on README markdown source size                                                 |

### Team profile defaults

| Key                                      | Type    | Default | Description                                                                       |
| ---------------------------------------- | ------- | ------- | --------------------------------------------------------------------------------- |
| `default_team_profile_show_description`  | boolean | `true`  |                                                                                   |
| `default_team_profile_show_avatar`       | boolean | `true`  |                                                                                   |
| `default_team_profile_show_owner`        | boolean | `false` | Opt-in: would otherwise reveal the owner's username                               |
| `default_team_profile_show_member_count` | boolean | `true`  |                                                                                   |
| `default_team_profile_show_apps`         | boolean | `true`  |                                                                                   |
| `default_team_profile_show_domains`      | boolean | `true`  |                                                                                   |
| `default_team_profile_show_members`      | boolean | `false` | The full member list. Each member's own `profile_show_joined_teams` still applies |
| `default_team_profile_show_sub_teams`    | boolean | `true`  | Sub-team listing. Each child must also be public to actually appear               |

There is no site default for the master `profile_is_public` flag — privacy-first.
The team owner (or admin) must always set it explicitly.

### Sub-teams (nested teams)

Master switch and inheritance toggles for the [sub-team feature](teams.md#sub-teams-nested-teams).
See that page for the full semantics; the keys themselves:

| Key                       | Type    | Default | Description                                                                     |
| ------------------------- | ------- | ------- | ------------------------------------------------------------------------------- |
| `enable_sub_teams`        | boolean | `true`  | Master switch. When `false` every sub-team endpoint returns 403.                |
| `max_team_depth`          | integer | `5`     | Hard cap on nesting depth (root = 0). Admin API validates 1–20.                 |
| `inherit_team_membership` | boolean | `true`  | Cascade member roles to descendants (effective role = max(direct, inherited)).  |
| `inherit_team_domains`    | boolean | `true`  | Surface ancestor-owned domains on sub-team listings + use them for auto-verify. |

### Member groups

Site-wide fallback for the per-team capability set behind
[member groups](teams.md#member-groups). There is no master switch — the
feature is opt-in per team and off by default, so nothing is emitted until a
team owner turns it on.

| Key                             | Type   | Default | Description                                                                              |
| ------------------------------- | ------ | ------- | ---------------------------------------------------------------------------------------- |
| `default_team_role_permissions` | object | `{}`    | Fallback capability grants for the `admin` role, e.g. `{"admin":{"groups:manage":true}}` |

Resolution order is per-group override → team `role_permissions` → this key →
built-in defaults (`groups:manage` off, `groups:assign` on). Each level only
contributes the keys it explicitly sets, so an empty object here simply lets
every team fall through to the built-ins.

### Team join requirements (site floor)

Site-wide minimums every team is forced to require, regardless of the team-level
flag. Owners can opt their team in further but cannot opt out below the floor.

| Key                                   | Type    | Default | Description                                                           |
| ------------------------------------- | ------- | ------- | --------------------------------------------------------------------- |
| `default_team_require_2fa`            | boolean | `false` | Floor: every team requires at least one TOTP authenticator or passkey |
| `default_team_require_verified_email` | boolean | `false` | Floor: every team requires a verified primary email                   |

::: warning
Turning these on retroactively forces every existing member to satisfy the
factor — anyone who hasn't enrolled is locked out of team operations until they
do. Roll them out behind a member-side notice.
:::

## GitHub README sync

Users can opt to sync their public profile README from a GitHub user repo. Cache
respects ETag and serves stale-on-error.

| Key                               | Type   | Default | Description                                                                                                                         |
| --------------------------------- | ------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `github_readme_token`             | string | `""`    | Site-global GitHub PAT used as the last-resort token for README fetches. Empty = unauthenticated 60 req/h per IP. Encrypted at rest |
| `github_readme_cache_ttl_seconds` | number | `3600`  | Serve cached README for this long before issuing a conditional GET                                                                  |
| `github_readme_token_failures`    | number | `0`     | Auto-managed: site PAT 401 counter. Auto-clears the token at 3 failures                                                             |

## GPG login

| Key                    | Type   | Default | Description                                                                                                                                                                                                    |
| ---------------------- | ------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gpg_challenge_prefix` | string | `""`    | Extra lines inserted between the site header and the random challenge in the clearsign payload. Use this to add a human-readable marker so users can verify the challenge they're signing comes from your site |

## Third-party notifications

| Key                          | Type   | Default | Description                                                                                                                                                                                             |
| ---------------------------- | ------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tg_notify_source_slug`      | string | `""`    | Slug of an enabled Telegram OAuth source whose bot is used to deliver Telegram notifications. Leave empty to disable Telegram delivery. The source's bot token doubles as the bot used to message users |
| `discord_notify_source_slug` | string | `""`    | Slug of an enabled Discord OAuth source used to identify linked Discord users for notification DMs. Leave empty to disable Discord delivery                                                             |
| `discord_bot_token`          | string | `""`    | Discord bot token used to open DM channels and send notification messages. This is separate from the Discord OAuth source client secret                                                                 |

## Social login

Each OAuth source (GitHub, Google, Microsoft, Discord, Telegram, X, Generic OIDC,
Generic OAuth 2) is now a row in the `oauth_sources` table — managed in
**Admin → OAuth Sources**, not here. The legacy keys below remain readable for
backwards compatibility but new deployments should use OAuth Sources directly.

| Key (legacy)              | Description                          |
| ------------------------- | ------------------------------------ |
| `github_client_id`        | GitHub OAuth App Client ID           |
| `github_client_secret`    | GitHub OAuth App Client Secret       |
| `google_client_id`        | Google Cloud OAuth 2.0 Client ID     |
| `google_client_secret`    | Google Cloud OAuth 2.0 Client Secret |
| `microsoft_client_id`     | Azure AD Application (client) ID     |
| `microsoft_client_secret` | Azure AD Client Secret               |
| `discord_client_id`       | Discord Application ID               |
| `discord_client_secret`   | Discord Client Secret                |

All `*_client_secret` values are encrypted at rest. Callback URL format for
sources is:

```
https://your-domain/api/connections/<slug>/callback
```

## Email — Sending

| Key              | Type    | Default                 | Description                                    |
| ---------------- | ------- | ----------------------- | ---------------------------------------------- |
| `email_provider` | string  | `"none"`                | `none` \| `resend` \| `mailchannels` \| `smtp` |
| `email_api_key`  | string  | `""`                    | API key for Resend or Mailchannels (encrypted) |
| `email_from`     | string  | `"noreply@example.com"` | From address for outgoing emails               |
| `smtp_host`      | string  | `""`                    | SMTP server hostname (when provider is `smtp`) |
| `smtp_port`      | number  | `587`                   | SMTP server port                               |
| `smtp_secure`    | boolean | `false`                 | Use SSL/TLS (true) or STARTTLS (false)         |
| `smtp_user`      | string  | `""`                    | SMTP username                                  |
| `smtp_password`  | string  | `""`                    | SMTP password (encrypted)                      |

## Email — Receiving

| Key                      | Type    | Default        | Description                                                                                                                                          |
| ------------------------ | ------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `email_verify_methods`   | string  | `"both"`       | `link` (system sends email) \| `send` (user sends email to verify) \| `both`                                                                         |
| `email_receive_provider` | string  | `"cloudflare"` | `cloudflare` (Email Workers) \| `imap` (poll via IMAP) \| `none`                                                                                     |
| `email_receive_host`     | string  | `""`           | Domain for `verify-<code>@<host>` emails (Cloudflare only). Blank = derive from `APP_URL`                                                            |
| `imap_host`              | string  | `""`           | IMAP server hostname (when receive provider is `imap`)                                                                                               |
| `imap_port`              | number  | `993`          | IMAP server port                                                                                                                                     |
| `imap_secure`            | boolean | `true`         | Use implicit TLS (true, port 993) or STARTTLS (false, port 143)                                                                                      |
| `imap_user`              | string  | `""`           | IMAP username — also shown to users as the destination address (with code as subject)                                                                |
| `imap_password`          | string  | `""`           | IMAP password (encrypted)                                                                                                                            |
| `social_verify_ttl_days` | number  | `0`            | When non-zero, an email verified through a social provider stays trusted for this many days before re-verification is requested. `0` disables expiry |

## Domain verification

Domains can be verified via DNS TXT, an HTML meta tag, or a `.well-known` file —
whichever the user picks at add time. Verified domains are re-checked on the
configured cron interval.

| Key                    | Type   | Default | Description                                               |
| ---------------------- | ------ | ------- | --------------------------------------------------------- |
| `domain_reverify_days` | number | `30`    | Days between automatic re-verification checks for domains |

## Diagnostics & rate limiting

| Key                          | Type   | Default | Description                                                                                                |
| ---------------------------- | ------ | ------- | ---------------------------------------------------------------------------------------------------------- |
| `login_error_retention_days` | number | `30`    | How long failed-login rows in the `login_errors` table are kept before the cron purges them                |
| `ipv6_rate_limit_prefix`     | number | `64`    | Prefix length used to bucket IPv6 addresses in the rate limiter (so a `/64` doesn't get unlimited retries) |

## Wrangler bindings & variables

These are configured in `wrangler.jsonc` and not editable from the admin panel.

### Variables

| Variable            | Required | Description                                                                                                                                             |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_URL`           | Yes      | Full origin of the deployment, e.g. `https://auth.example.com`                                                                                          |
| `LOCKDOWN_USERS`    | No       | Comma / semicolon / whitespace separated list of usernames that cannot be deleted by anyone (including admins). Leave empty to disable.                 |
| `LOCKDOWN_TEAMS`    | No       | Comma / semicolon / whitespace separated list of team names that cannot be deleted by anyone (including admins). Leave empty to disable.                |
| `ENABLE_RESET`      | No       | Set to `"true"` to enable the **Admin → Settings → Danger Zone → Site reset** button. When unset or anything else the button is hidden (destructive).   |
| `NO_RESET_COOLDOWN` | No       | Set to `"true"` to skip the 30-minute cooldown between requesting a reset and being allowed to confirm it. 2FA is still required even when this is set. |

### Bindings

| Binding       | Kind                 | Required             | Notes                                                                                     |
| ------------- | -------------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| `DB`          | D1 database          | Yes                  | All persistent state                                                                      |
| `KV_SESSIONS` | KV namespace         | Yes                  | Session JWT secret, RSA keypair (for ID token signing), per-session metadata              |
| `KV_CACHE`    | KV namespace         | Yes                  | Rate-limit counters, IMAP poll cursors, image-proxy cache                                 |
| `ASSETS`      | Workers Assets       | Yes                  | Built SPA. `html_handling: "none"` so SSR can render `/` itself                           |
| `SECRETS_KEY` | Secrets Store secret | Strongly recommended | 32-byte base64url AES-GCM master key. When bound, all sensitive D1 fields encrypt at rest |

### `SECRETS_KEY` setup

Generate a 32-byte master key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Create the Secrets Store, store the key under name `prism-secrets-key`, and add
the `secrets_store_secrets` binding shown in `wrangler.jsonc`.

After redeploying, run the migration once from
**Admin → Settings → Danger Zone → "Migrate secrets to Secrets Store"** to
encrypt existing OAuth/source/SMTP/IMAP/captcha credentials in D1. Bearer-style
secrets (PATs, OAuth codes, OAuth tokens, invite tokens, email-verify codes, 2FA
codes, individual backup codes) are migrated to a keyed HMAC-SHA256 hash in a
companion endpoint (**"Migrate D1 secrets"**) so they remain look-up-able by
value but are not recoverable from the database.

If `SECRETS_KEY` is not bound, encryption/hashing is a no-op — the legacy
plaintext path keeps working until you opt in.

### Cron triggers

```jsonc
"triggers": { "crons": ["0 */6 * * *"] }
```

Every 6 hours the worker:

- re-verifies domains whose `next_reverify_at` has passed,
- polls the IMAP mailbox (when `email_receive_provider = imap`),
- purges the `app_event_queue` and expired `pow_used` rows,
- sweeps orphaned `image_proxy_mappings` (mappings whose source row no longer exists).

### User / team deletion lockdown

When you have users or teams that must never be deleted — shared service
accounts, bot identities, or critical organisational teams — set
`LOCKDOWN_USERS` and `LOCKDOWN_TEAMS` in `wrangler.jsonc`. Locked accounts
return a 403 error when any admin (or team owner) attempts to delete them
through the API.

The variables accept a comma, semicolon, or whitespace separated list of names.
Leading and trailing whitespace on each name is stripped.
