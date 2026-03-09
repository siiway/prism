---
title: Admin Guide
description: Managing users, apps, OAuth sources, settings, and the audit log in the Prism admin panel.
---

# Admin Guide

The admin panel is available at `/admin` and is visible only to users with `role = admin`.
The first admin is created during first-run setup. Additional admins are promoted via
**Admin → Users → Edit User → Role → Admin**.

## Dashboard

Shows four summary stats:

| Stat             | Description                          |
|------------------|--------------------------------------|
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
- **Registration mode** — `open` (anyone can register), `invite-only` (requires an invite token), or `closed` (no new registrations)
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
|----------------------|----------------------------------------------------------------------|
| None                 | No bot protection                                                    |
| Cloudflare Turnstile | Requires a Turnstile site key + secret. Free tier available.         |
| hCaptcha             | Requires an hCaptcha site key + secret.                              |
| reCAPTCHA v3         | Requires a Google reCAPTCHA v3 site key + secret. Invisible.         |
| Proof-of-Work        | No third-party service. Difficulty 20 = ~0.1–2 s on modern hardware. |

### Email

- **Email provider** — `none`, `resend`, `mailchannels`, or `smtp`
- **API key** — for Resend or Mailchannels
- **SMTP settings** — host, port, encryption, username, password (when provider is `smtp`)
- **From address** — the sender address for verification and notification emails

### Domain re-verification

- **Domain reverify interval (days)** — how often Prism re-checks DNS TXT records for verified domains. Default is 30 days.

## OAuth Sources

**Admin → OAuth Sources** is where all social login providers are configured. Unlike a simple per-provider on/off toggle, each *source* is an independently named OAuth connection with its own slug, credentials, and display name. This allows multiple sources of the same provider type (e.g. two GitHub apps, or a Keycloak instance alongside Google).

### Source fields

| Field         | Description                                                                         |
|---------------|-------------------------------------------------------------------------------------|
| Slug          | Unique URL key — appears in the callback URL as `/api/connections/<slug>/callback`  |
| Provider      | Base OAuth type (GitHub, Google, Microsoft, Discord, Generic OIDC, Generic OAuth 2) |
| Display name  | Label shown on login/register buttons                                               |
| Client ID     | OAuth application client ID                                                         |
| Client Secret | OAuth application client secret                                                     |
| Enabled       | Toggle to show/hide the source on login without deleting it                         |

### Generic OIDC sources

When provider is **Generic OpenID Connect**, three additional endpoint URL fields appear:

- **Issuer URL** — the provider's base issuer (e.g. `https://accounts.example.com`). Click **Discover** to auto-fetch the three endpoints from `{issuer}/.well-known/openid-configuration`.
- **Auth URL** — OAuth 2.0 authorization endpoint
- **Token URL** — token exchange endpoint
- **Userinfo URL** — endpoint to fetch the user profile

An optional **Scopes** field allows customizing the requested scopes (default: `openid email profile`).

### Generic OAuth 2 sources

When provider is **Generic OAuth 2**, the same Auth URL / Token URL / Userinfo URL fields appear but there is no OIDC discovery. All three must be filled in manually.

### Callback URL

Each source's callback URL is:

```
https://<your-prism-domain>/api/connections/<slug>/callback
```

Register this URL in the provider's developer console when creating the OAuth app.

For detailed per-provider setup instructions see [Social Login Setup](social-login.md).

## Invites

When registration mode is **invite-only**, the Invites tab lets you create and revoke invite tokens.

- **Email (optional)** — restrict the invite to a specific email address
- **Max uses** — leave empty for unlimited
- **Expires after (days)** — optional expiry

Invite links are copyable and can be shared directly. Email delivery requires a configured email provider.

## Users

The user table is searchable and sortable. Click a user row to open the detail view.

### Actions on a user

| Action              | Effect                                                                                          |
|---------------------|-------------------------------------------------------------------------------------------------|
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
|------------|---------------------------------------------------------------------------------------------|
| Verify     | Marks the app with a verified badge visible on the consent screen                           |
| Deactivate | Prevents the app from completing new authorization flows. Existing tokens continue to work. |

Verified apps are shown with a checkmark on the consent screen, indicating they
have been reviewed by an admin.

## Audit Log

The audit log is a paginated, append-only list of significant events:

| Event                 | Triggered by               |
|-----------------------|----------------------------|
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
