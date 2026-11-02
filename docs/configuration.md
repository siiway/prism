---
title: Configuration
description: Runtime configuration keys, plus Wrangler bindings, environment variables, and secrets.
---

# Configuration

Site settings are edited at runtime in **Admin → Settings**; no redeploy is
needed. This page lists the keys behind them, then the Wrangler bindings and
variables that are set at deploy time.

Sensitive values (captcha secrets, social client secrets, SMTP/IMAP passwords,
the GitHub README token, the Discord bot token) are encrypted at rest when the
[`SECRETS_KEY`](#secrets-key-setup) binding is present, and are never returned by
the config API.

## General

| Key                          | Type    | Default                         | Description                                                |
| ---------------------------- | ------- | ------------------------------- | ---------------------------------------------------------- |
| `site_name`                  | string  | `"Prism"`                       | Shown in the browser title and emails                      |
| `site_description`           | string  | `"Federated identity platform"` | Shown on the login page                                    |
| `site_icon_url`              | string? | `null`                          | URL to a favicon / logo                                    |
| `allow_registration`         | boolean | `true`                          | Allow self-registration                                    |
| `invite_only`                | boolean | `false`                         | Require an invite token to register                        |
| `require_email_verification` | boolean | `false`                         | Block sign-in until the email is verified                  |
| `accent_color`               | string  | `"#0078d4"`                     | Primary brand color (hex)                                  |
| `custom_css`                 | string  | `""`                            | Injected as a `<style>` block on every page                |
| `disable_user_create_team`   | boolean | `false`                         | Hide "New team" — only admins can create teams             |
| `disable_user_create_app`    | boolean | `false`                         | Hide "New application" — only admins can create OAuth apps |
| `allow_alt_email_login`      | boolean | `true`                          | Let users sign in with any verified secondary email        |
| `security_contact`           | string  | `""`                            | `mailto:` address or https URL for vulnerability reports   |
| `security_policy_url`        | string  | `""`                            | Link to your disclosure policy                             |

When `security_contact` is set, Prism serves `/.well-known/security.txt`.

## Legal pages

A Privacy Policy and Terms of Service, written in Markdown, can be published
from **Admin → Settings → Legal**. They're served without sign-in at `/privacy`
and `/terms`, with footer links on every page. Each is limited to 256 KiB. Save
a document empty to hide both the page and its link.

## Avatar proxy

Avatars and icons from other sites are served through Prism's image proxy.
Responses over the size limit are rejected. An optional cache (off by default,
using KV or D1) and its TTL are set in **Admin → Avatar Proxy**. Raster
conversion to WebP is optional and needs an `IMAGES` Cloudflare Images binding.

## Sessions & tokens

| Key                        | Type   | Default | Description                  |
| -------------------------- | ------ | ------- | ---------------------------- |
| `session_ttl_days`         | number | `30`    | Session lifetime             |
| `access_token_ttl_minutes` | number | `60`    | OAuth access token lifetime  |
| `refresh_token_ttl_days`   | number | `30`    | OAuth refresh token lifetime |

An admin can override the access and refresh lifetimes for a single user.

## Bot protection (captcha)

Prism runs an ordered set of providers. The first is the default; the rest are
alternates a visitor can switch to if the default fails or is slow. Each
provider has its own credentials, so you can configure all of them. Captcha
protects registration, sign-in, password change, email-verification resend,
team join, invite registration and step-up 2FA.

| Key                              | Type     | Default      | Description                                                               |
| -------------------------------- | -------- | ------------ | ------------------------------------------------------------------------- |
| `captcha_providers`              | string[] | `[]`         | Ordered enabled set. First is the default. `[]` = off                     |
| `captcha_switch_timeout_seconds` | number   | `15`         | Delay before "try a different method" appears. `0` = only after a failure |
| `turnstile_site_key`             | string   | `""`         | Turnstile site key                                                        |
| `turnstile_secret_key`           | string   | `""`         | Turnstile secret                                                          |
| `turnstile_endpoint_mode`        | string   | `"global"`   | Which host serves Turnstile (see below)                                   |
| `turnstile_china_site_key`       | string   | `""`         | Site key of a `region: "china"` widget                                    |
| `turnstile_china_secret_key`     | string   | `""`         | Secret for that key                                                       |
| `hcaptcha_site_key`              | string   | `""`         | hCaptcha site key                                                         |
| `hcaptcha_secret_key`            | string   | `""`         | hCaptcha secret                                                           |
| `recaptcha_site_key`             | string   | `""`         | reCAPTCHA v3 site key                                                     |
| `recaptcha_secret_key`           | string   | `""`         | reCAPTCHA v3 secret                                                       |
| `geetest_captcha_id`             | string   | `""`         | GeeTest v4 CAPTCHA ID                                                     |
| `geetest_captcha_key`            | string   | `""`         | GeeTest v4 key                                                            |
| `geetest_fail_open`              | boolean  | `false`      | Accept visitors when GeeTest is unreachable. `false` = reject             |
| `cap_mode`                       | string   | `"embedded"` | `embedded` (runs inside Prism) or `external` (self-hosted Cap Standalone) |
| `cap_api_endpoint`               | string   | `""`         | Cap Standalone base URL (external mode)                                   |
| `cap_site_key`                   | string   | `""`         | Cap Standalone site key (external mode)                                   |
| `cap_secret_key`                 | string   | `""`         | Cap Standalone secret (external mode)                                     |
| `cap_challenge_count`            | number   | `50`         | Puzzles per Cap challenge (embedded mode)                                 |
| `cap_challenge_difficulty`       | number   | `4`          | Cap difficulty (embedded mode)                                            |
| `cap_instrumentation`            | boolean  | `true`       | Cap's anti-automation script (embedded mode)                              |

Provider names: `turnstile`, `hcaptcha`, `recaptcha`, `geetest` and `cap`
([Cap](https://trycap.dev)).

### Turnstile and Mainland China

Cloudflare serves Turnstile from a global host and a Mainland-China host
(`challenges.cloudflare-cn.com`). A widget only works on the host matching the
region it was created with, so using the China host means a second widget
created with `region: "china"` (this needs a Cloudflare China Network
entitlement). Put its keys in `turnstile_china_site_key` and
`turnstile_china_secret_key`.

`turnstile_endpoint_mode` picks which pair a visitor gets:

- `global` — always the global host.
- `china` — always the China host.
- `client_language` — China when the browser language is Chinese.
- `server_region` — China when the request comes from `CN`.
- `client_region` — China when the browser timezone is in Mainland China.

If `turnstile_china_site_key` is empty, every mode behaves as `global`, so
picking a China mode without the entitlement costs nothing. Prism also checks a
China key before using it and falls back to global if it doesn't work.

## Two-factor / step-up

| Key                       | Type    | Default | Description                                                                                                  |
| ------------------------- | ------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| `sudo_mode_ttl_minutes`   | number  | `5`     | After a successful step-up, further challenges from the same app skip the prompt for this long. `0` disables |
| `require_captcha_for_2fa` | boolean | `false` | Every step-up confirmation must solve the captcha                                                            |

## Public profiles

Profiles are off until a user (or team owner) opts in. Site defaults only apply
to fields the user hasn't set themselves, and never make a private profile
public.

| Key                                      | Default | Description                                            |
| ---------------------------------------- | ------- | ------------------------------------------------------ |
| `enable_public_profiles`                 | `true`  | Master switch. `false` = all profile pages 404         |
| `default_profile_show_display_name`      | `true`  |                                                        |
| `default_profile_show_avatar`            | `true`  |                                                        |
| `default_profile_show_email`             | `false` |                                                        |
| `default_profile_show_joined_at`         | `true`  |                                                        |
| `default_profile_show_gpg_keys`          | `true`  |                                                        |
| `default_profile_show_authorized_apps`   | `false` |                                                        |
| `default_profile_show_owned_apps`        | `true`  |                                                        |
| `default_profile_show_domains`           | `true`  |                                                        |
| `default_profile_show_joined_teams`      | `false` | Also controls appearing in a team's public member list |
| `default_profile_show_readme`            | `true`  |                                                        |
| `profile_readme_max_bytes`               | `65536` | Maximum README size                                    |
| `default_team_profile_show_description`  | `true`  | Team profile defaults                                  |
| `default_team_profile_show_avatar`       | `true`  |                                                        |
| `default_team_profile_show_owner`        | `false` |                                                        |
| `default_team_profile_show_member_count` | `true`  |                                                        |
| `default_team_profile_show_apps`         | `true`  |                                                        |
| `default_team_profile_show_domains`      | `true`  |                                                        |
| `default_team_profile_show_members`      | `false` |                                                        |
| `default_team_profile_show_sub_teams`    | `true`  |                                                        |

## Teams

| Key                                   | Type    | Default | Description                                                                        |
| ------------------------------------- | ------- | ------- | ---------------------------------------------------------------------------------- |
| `enable_sub_teams`                    | boolean | `true`  | Master switch for [sub-teams](teams.md#sub-teams)                                  |
| `max_team_depth`                      | integer | `5`     | Maximum nesting depth (1–20)                                                       |
| `inherit_team_membership`             | boolean | `true`  | Members of a team have at least the same role on its sub-teams                     |
| `inherit_team_domains`                | boolean | `true`  | Sub-teams see and auto-verify against ancestors' domains                           |
| `default_team_require_2fa`            | boolean | `false` | Every team requires a TOTP authenticator or passkey                                |
| `default_team_require_verified_email` | boolean | `false` | Every team requires a verified primary email                                       |
| `default_team_role_permissions`       | object  | `{}`    | Default group permissions for team admins, e.g. `{"admin":{"groups:manage":true}}` |

Turning on the two `default_team_require_*` floors applies to existing members
immediately; tell them first.

### Invite-link registration

Whether a team may use [invite-link registration](teams.md#invite-link-registration)
is a per-team grant from a site admin. Nothing creates accounts while
`allow_registration` is `false`.

| Key                                      | Default | Description                                                                              |
| ---------------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `team_invite_registration_max_uses_cap`  | `1000`  | Highest `max_uses` an invite that creates accounts may have                              |
| `team_invite_registration_rate_per_hour` | `200`   | Registrations per hour per invite                                                        |
| `restricted_user_capabilities`           | `{}`    | Features granted to restricted accounts, e.g. `{"app:create": true}`. Empty = all denied |
| `restricted_pending_ttl_hours`           | `72`    | How long an unfinished registration survives                                             |
| `restricted_dissolve_grace_hours`        | `168`   | Delay between deactivating and deleting accounts when a team is dissolved                |

Capability keys: `team:create`, `app:create`, `domain:create`, `pat:create`,
`profile:public`, `gpg:manage`, `self:convert`.

## GitHub README sync

Users can sync their profile README from a GitHub repo.

| Key                               | Default | Description                                                                        |
| --------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| `github_readme_token`             | `""`    | GitHub token for README fetches. Empty = unauthenticated (60 requests/hour per IP) |
| `github_readme_cache_ttl_seconds` | `3600`  | How long a fetched README is served before re-checking                             |

## GPG login

| Key                    | Default | Description                                                                               |
| ---------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `gpg_challenge_prefix` | `""`    | Extra text in the challenge users sign, so they can recognise it as coming from your site |

## Third-party notifications

| Key                          | Default | Description                                                                  |
| ---------------------------- | ------- | ---------------------------------------------------------------------------- |
| `tg_notify_source_slug`      | `""`    | Telegram OAuth source whose bot sends notifications. Empty disables Telegram |
| `discord_notify_source_slug` | `""`    | Discord OAuth source used to find users for DMs. Empty disables Discord      |
| `discord_bot_token`          | `""`    | Discord bot token used to send the DMs                                       |

## Social login

Social providers are configured as OAuth sources in **Admin → OAuth Sources**,
not here. See [Social Login Setup](social-login.md).

## Email

| Key              | Default                 | Description                                |
| ---------------- | ----------------------- | ------------------------------------------ |
| `email_provider` | `"none"`                | `none`, `resend`, `mailchannels` or `smtp` |
| `email_api_key`  | `""`                    | API key for Resend or Mailchannels         |
| `email_from`     | `"noreply@example.com"` | From address                               |
| `smtp_host`      | `""`                    | SMTP server                                |
| `smtp_port`      | `587`                   | SMTP port                                  |
| `smtp_secure`    | `false`                 | `true` = implicit TLS, `false` = STARTTLS  |
| `smtp_user`      | `""`                    | SMTP username                              |
| `smtp_password`  | `""`                    | SMTP password                              |

### Receiving

| Key                      | Default        | Description                                                                     |
| ------------------------ | -------------- | ------------------------------------------------------------------------------- |
| `email_verify_methods`   | `"both"`       | `link`, `send` (user emails Prism) or `both`                                    |
| `email_receive_provider` | `"cloudflare"` | `cloudflare` (Email Workers), `imap`, or `none`                                 |
| `email_receive_host`     | `""`           | Domain for `verify-<code>@<host>` (Cloudflare only). Blank = the `APP_URL` host |
| `imap_host`              | `""`           | IMAP server                                                                     |
| `imap_port`              | `993`          | IMAP port                                                                       |
| `imap_secure`            | `true`         | Implicit TLS (port 993) or STARTTLS (port 143)                                  |
| `imap_user`              | `""`           | IMAP username; also shown to users as the address to email                      |
| `imap_password`          | `""`           | IMAP password                                                                   |
| `social_verify_ttl_days` | `0`            | Days an email verified through a social provider stays trusted. `0` = no expiry |

## Domain verification

Domains can be verified by DNS TXT record, HTML meta tag or a `.well-known`
file, and are re-checked on a schedule.

| Key                    | Default | Description                             |
| ---------------------- | ------- | --------------------------------------- |
| `domain_reverify_days` | `30`    | Days between automatic re-verifications |

## Diagnostics & rate limiting

| Key                                               | Default      | Description                                              |
| ------------------------------------------------- | ------------ | -------------------------------------------------------- |
| `login_error_retention_days`                      | `30`         | How long failed-sign-in records are kept                 |
| `login_dos_rate_limit` / `_window_seconds`        | `120` / `60` | Login POSTs per IP                                       |
| `login_ip_rate_limit` / `_window_seconds`         | `60` / `60`  | Captcha-cleared login attempts per IP                    |
| `login_identifier_rate_limit` / `_window_seconds` | `30` / `300` | Login attempts per email or username                     |
| `login_totp_rate_limit` / `_window_seconds`       | `15` / `300` | TOTP submissions per user                                |
| `ipv6_rate_limit_prefix`                          | `64`         | Bits of an IPv6 address that share one rate-limit bucket |

Limits are integers from `1` to `86400`. The password step and the TOTP step are
separate requests, and both count.

## Wrangler bindings & variables

These are set in `wrangler.jsonc`, not in the admin panel.

### Variables

| Variable            | Required | Description                                                                                                                                          |
| ------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_URL`           | Yes      | Full origin of the deployment, e.g. `https://auth.example.com`                                                                                       |
| `LOCKDOWN_USERS`    | No       | Usernames that nobody, admins included, can delete. Separate with commas, semicolons or spaces                                                       |
| `LOCKDOWN_TEAMS`    | No       | Team names that nobody can delete. Same format                                                                                                       |
| `ENABLE_RESET`      | No       | `"true"` shows the **Site reset** button in the Danger zone. Hidden otherwise                                                                        |
| `NO_RESET_COOLDOWN` | No       | `"true"` skips the 30-minute wait before a reset can be confirmed. 2FA is still required                                                             |
| `D1_CONSOLE`        | No       | Availability of **Admin → Database**: unset/`off` (default), `read-only`, or `full`. See [Admin → Database](admin.md#database-and-key-value-browser) |
| `KV_CONSOLE`        | No       | Same for the key–value browser. Follows `D1_CONSOLE` when unset                                                                                      |

### Bindings

| Binding       | Kind                 | Required             | Notes                                      |
| ------------- | -------------------- | -------------------- | ------------------------------------------ |
| `DB`          | D1 database          | Yes                  | Persistent state                           |
| `KV_SESSIONS` | KV namespace         | Yes                  | Session secrets and signing keys           |
| `KV_CACHE`    | KV namespace         | Yes                  | Caches and short-lived state               |
| `ASSETS`      | Workers Assets       | Yes                  | The built web app                          |
| `SECRETS_KEY` | Secrets Store secret | Strongly recommended | Master key used to encrypt secrets at rest |

### `SECRETS_KEY` setup

Generate a 32-byte key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Create a Secrets Store, save the key under the name `prism-secrets-key`, and add
the `secrets_store_secrets` binding shown in `wrangler.jsonc`. After
redeploying, run **Admin → Maintenance → Danger zone → Migrate secrets to
Secrets Store** and **Migrate D1 secrets** once to protect existing data.

Without the binding, Prism works with plaintext storage, and you can add it
later.

### Cron trigger

```jsonc
"triggers": { "crons": ["0 */6 * * *"] }
```

Every six hours Prism re-verifies domains, polls the IMAP mailbox (when used)
and cleans up expired data. You can also run these on demand from **Admin →
Settings → Maintenance jobs**.

### Deletion lockdown

Users and teams that must never be deleted (service accounts, bot identities,
critical teams) can be listed in `LOCKDOWN_USERS` and `LOCKDOWN_TEAMS`. Attempts
to delete them through the API return 403.
