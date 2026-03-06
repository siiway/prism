---
title: Admin Guide
description: Managing users, apps, settings, and the audit log in the Prism admin panel.
---

# Admin Guide

The admin panel is available at `/admin` and is visible only to users with `role = admin`.
The first admin is created during first-run setup. Additional admins are promoted via
**Admin → Users → Edit User → Role → Admin**.

## Dashboard

Shows four summary stats:

| Stat             | Description                          |
| ---------------- | ------------------------------------ |
| Total users      | All registered accounts              |
| OAuth apps       | All registered applications          |
| Verified domains | Domains that passed DNS verification |
| Active tokens    | Non-expired OAuth access tokens      |

## Settings

Settings are grouped into tabs. All changes take effect immediately — no redeployment needed.

### General

- **Site name** — shown in the browser tab and email templates
- **Site description** — shown on the login page
- **Site icon URL** — link to a PNG/SVG logo
- **Allow registration** — toggle self-registration on/off. When disabled, only admins can create accounts (not yet implemented — contact the instance owner)
- **Require email verification** — users must click the verification link before logging in

### Appearance

- **Accent color** — hex color that drives the entire FluentUI theme. Changes are reflected immediately after saving.
- **Custom CSS** — injected as a `<style>` block on every page. Useful for branding tweaks without forking the UI.

### Security / Sessions

- **Session TTL (days)** — how long a login session lasts
- **Access token TTL (minutes)** — OAuth access token lifetime
- **Refresh token TTL (days)** — OAuth refresh token lifetime

### Bot Protection

Choose one captcha provider:

| Provider             | Notes                                                                |
| -------------------- | -------------------------------------------------------------------- |
| None                 | No bot protection                                                    |
| Cloudflare Turnstile | Requires a Turnstile site key + secret. Free tier available.         |
| hCaptcha             | Requires an hCaptcha site key + secret.                              |
| reCAPTCHA v3         | Requires a Google reCAPTCHA v3 site key + secret. Invisible.         |
| Proof-of-Work        | No third-party service. Difficulty 20 = ~0.1–2 s on modern hardware. |

### Social Login

Enter the client ID and secret for each provider. Leave both fields blank to
disable that provider. See [Configuration](configuration.md#social-login) for the
callback URLs to register with each provider's developer console.

### Email

- **Email provider** — `none`, `resend`, or `mailchannels`
- **Email API key** — the API key for Resend or Mailchannels
- **From address** — the sender address for verification emails

### Domain re-verification

- **Domain reverify interval (days)** — how often Prism re-checks DNS TXT records
  for verified domains. Default is 30 days.

## Users

The user table is searchable and sortable. Click a user row to open the detail view.

### Actions on a user

| Action              | Effect                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Change role         | Toggle between `user` and `admin`                                                               |
| Deactivate          | Prevents login; existing tokens remain valid until expiry                                       |
| Mark email verified | Manually verify without sending an email                                                        |
| Delete              | Permanently deletes the user and all their data (cascades to sessions, apps, connections, etc.) |

Deleting a user is irreversible. Their OAuth apps are also deleted, which will
break any third-party integrations that used those apps.

## Applications

The app table lists all OAuth apps across all users, including:

- Owner username
- Verification status
- Active/inactive status

### App moderation

| Action     | Effect                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------- |
| Verify     | Marks the app with a verified badge visible on the consent screen                           |
| Deactivate | Prevents the app from completing new authorization flows. Existing tokens continue to work. |

Verified apps are shown with a checkmark on the consent screen, indicating they
have been reviewed by an admin.

## Audit Log

The audit log is a paginated, append-only list of significant events:

| Event                 | Triggered by               |
| --------------------- | -------------------------- |
| `user.register`       | Successful registration    |
| `user.login`          | Successful login           |
| `user.login.failed`   | Failed login attempt       |
| `user.logout`         | Logout                     |
| `user.delete`         | Account deletion           |
| `totp.enabled`        | TOTP setup completed       |
| `totp.disabled`       | TOTP disabled              |
| `passkey.registered`  | New passkey added          |
| `passkey.deleted`     | Passkey removed            |
| `oauth.authorize`     | User approved an OAuth app |
| `oauth.token`         | Token issued               |
| `admin.config.update` | Site config changed        |
| `admin.user.update`   | Admin changed a user       |
| `admin.user.delete`   | Admin deleted a user       |

Each entry records the acting `user_id`, the `action`, optional `resource_type` /
`resource_id`, a `metadata` JSON object, and the `ip_address`.
