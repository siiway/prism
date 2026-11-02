---
title: Admin Guide
description: Managing users, apps, OAuth sources, settings, and the audit log in the Prism admin panel.
---

# Admin Guide

The admin panel is at `/admin` and is visible only to users with the admin role.
The first admin is created during first-run setup. Promote others from
**Admin → Users → Manage → Role**.

The panel opens on an overview with things that need attention (email not set
up, no captcha, secrets not yet encrypted), usage totals, recent activity and
the key settings. Press Ctrl/⌘ K anywhere to search pages, settings and data.

## Settings

Settings are split into sections in the admin sidebar. Changes take effect
immediately — no redeploy needed. The keys behind each setting are listed in
[Configuration](configuration.md).

### General

Site name, description and icon, plus an optional **security contact** and
**security policy URL**. When a contact is set, Prism serves
`/.well-known/security.txt`.

### Sign-up

- **Who can sign up** — open, invite-only, or closed.
- **Email verification** — when required, new users must verify their address
  before signing in.

### Sign-in & security

- **Session, access token and refresh token lifetimes.**
- **Sudo mode** — after a successful 2FA step-up, further challenges from the
  same app skip the TOTP/passkey prompt for this many minutes. `0` disables it.
  See [OAuth → Step-up 2FA](oauth.md#step-up-2fa).
- **Captcha on 2FA step-up** — require a captcha for every step-up.
- **Login rate limits** — allowance and window for login attempts per IP, per
  email or username, and for TOTP submissions.
- **IPv6 rate-limit prefix** — how many bits of an IPv6 address share one
  rate-limit bucket (default `/64`).

### Captcha

Pick a **default provider** and, optionally, **alternate providers** visitors
can switch to if the default fails or is slow. Set the default to **None** to
turn captcha off.

| Provider             | Notes                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------- |
| Cloudflare Turnstile | Site key + secret. Free tier available.                                                   |
| hCaptcha             | Site key + secret.                                                                        |
| reCAPTCHA v3         | Site key + secret. Invisible.                                                             |
| GeeTest v4           | Captcha ID + key. **Fail open** lets visitors through if GeeTest is down; off by default. |
| Cap                  | Self-hosted proof-of-work, embedded in Prism or an external server.                       |
| Proof-of-Work        | Built in, no third-party service.                                                         |

For Turnstile, the **Challenge Endpoint** setting chooses between the global
host and the Mainland-China host. Anything other than "always global" needs a
second **China site key** and **secret** from a widget created with
`region: "china"`, which requires a Cloudflare China Network entitlement. Leave
the China key empty and visitors simply get the global widget.

### Email

**Send** — choose a provider (Resend, Mailchannels, or SMTP), the from address,
and use **Send test email** to check it.

**Receive** — lets users verify their address by sending an email to Prism:

- **Verification methods** — `link`, `send`, or `both`.
- **Receive provider** — Cloudflare Email Workers (users send to
  `verify-<code>@<host>`), IMAP (Prism polls a mailbox every 6 hours and the
  user sends the code as the subject), or none.

### Public profiles

- **Users can publish a profile** — the master switch. When off, all public
  profile pages return 404.
- **Defaults** for which fields user and team profiles show. A default never
  overrides an explicit user or team choice. See [Public Profiles](public-profile.md).

### Users & teams

- **Team join requirements** — require 2FA or a verified email for every team.
  Turning these on applies to existing members immediately; anyone who hasn't
  enrolled is locked out of team operations until they do, so tell members first.
- **Sub-teams** — allow or forbid team nesting, set the maximum depth (1–20,
  default 5), and choose whether membership and verified domains pass down to
  sub-teams. See [Teams → Sub-teams](teams.md#sub-teams).

### Notifications

Pick the Telegram and Discord OAuth sources (and the Discord bot token) used to
deliver chat notifications. Leave empty to disable that channel. See
[Notifications](notifications.md).

### Appearance and Legal

- **Accent color** and **custom CSS**, applied on every page.
- **Privacy Policy** and **Terms of Service** in Markdown, published at
  `/privacy` and `/terms` with footer links. Leave one empty to hide it. Each is
  limited to 256 KiB.

### Domains and diagnostics

How often verified domains are re-checked (default 30 days) and how long failed
sign-in records are kept.

### Danger zone

Under **Maintenance**. Each tool is safe to run more than once.

- **Migrate secrets to Secrets Store** and **Migrate D1 secrets** — encrypt or
  hash existing secrets after you bind [`SECRETS_KEY`](configuration.md#secrets-key-setup).
- **Site reset** — wipe and reinitialize. Needs a working email provider and
  `ENABLE_RESET = "true"` in `wrangler.jsonc`; otherwise the button is hidden.
- **Sign everyone out** — deletes every session. Your own is kept unless you
  choose otherwise. OAuth tokens are not affected.

**Maintenance jobs** runs the scheduled tasks (domain re-verification, mailbox
polling, cleanups) on demand instead of waiting for the six-hourly schedule.

## OAuth sources

**Admin → OAuth Sources** configures social login. Each source is an
independent connection with its own slug and credentials, so you can have two
GitHub apps or Keycloak alongside Google.

| Field              | Description                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------ |
| Slug               | Unique key, used in the callback URL                                                       |
| Provider           | GitHub, Google, Microsoft, Discord, Telegram, X, Cloudflare, Generic OIDC, Generic OAuth 2 |
| Display name       | Label on the login button                                                                  |
| Client ID / Secret | From the provider                                                                          |
| Trusted            | When on (default), signing in through this source skips email verification                 |
| Enabled            | Show or hide the source without deleting it                                                |

Register this callback URL with the provider:

```text
https://<your-prism-domain>/api/connections/<slug>/callback
```

Generic OIDC sources also take an **Issuer URL** (click **Discover** to fill in
the endpoints) and optional **Scopes**. Generic OAuth 2 sources need all three
endpoint URLs entered by hand. See [Social Login Setup](social-login.md) for
per-provider walkthroughs.

## Invites

In invite-only mode, **Admin → Invites** creates, edits, disables and revokes
invite links. Each can be locked to an email address, limited in uses, and given
an expiry. A disabled invite can't register accounts until re-enabled.

## Users

The user table is searchable and sortable. Select accounts with the checkboxes
to activate, deactivate or delete up to 50 at once. Your own account is skipped.

| Action              | Effect                                                       |
| ------------------- | ------------------------------------------------------------ |
| Change role         | Switch between user and admin                                |
| Deactivate          | Blocks sign-in; existing tokens stay valid until they expire |
| Mark email verified | Verify without sending an email                              |
| Delete              | Permanently deletes the user, their apps and all their data  |

Usernames listed in `LOCKDOWN_USERS` can't be deleted. See
[Configuration → Wrangler bindings & variables](configuration.md#wrangler-bindings-variables).

**Admin → Users → Manage** opens one account in full:

- **Overview** — edit username, email and display name; set or clear the
  password; reset all 2FA or remove a single factor; verify, promote or remove
  email addresses. Setting a password doesn't notify the user, so hand it over
  separately.
- **Access** — personal access tokens, linked providers, GPG keys and authorized
  apps, each with a revoke. **Revoke all authorizations** cuts the account off
  from every app. Token values are never shown.
- **Resources** — personal domains, teams, and notification routing (reset it if
  a user says they've stopped getting notifications).
- **Audit** — everything the account did and everything an admin did to it.

Admin actions here are recorded in the user's own audit log, marked as site
admin. Signing in as another user is not offered.

## Applications

**Admin → Applications** lists every OAuth app with its owner and status.

| Action            | Effect                                                                             |
| ----------------- | ---------------------------------------------------------------------------------- |
| Verify            | Shows a verified badge on the consent screen                                       |
| Deactivate        | Blocks new authorizations; existing tokens keep working                            |
| Revoke all access | Deletes every token, code and consent for the app (optionally deactivating it too) |
| Transfer          | Moves the app to any user or team. Client ID and secret are unchanged              |

## Teams

**Admin → Teams** lists every team with its owner and member count.

| Action     | Effect                                                          |
| ---------- | --------------------------------------------------------------- |
| Manage     | Open the team's page with owner-level access without joining it |
| Add member | Add any account at any role up to co-owner                      |
| Create     | Create a team and name its owner                                |
| Disband    | Remove the team. Its apps are reassigned to the team's owner    |

Team names listed in `LOCKDOWN_TEAMS` can't be disbanded. To stop non-admins
creating teams, turn on `disable_user_create_team` (see
[Configuration](configuration.md#general)).

A site admin has owner-level authority on every team. An admin can add anyone,
change or remove any member (the owner included), and transfer ownership; the
team's join requirements are waived when adding people. These actions are marked
as site admin in both the team's audit log and the platform log. Team pages show
a banner when you're acting as the site; **Switch to normal view** makes you act
as your own membership instead. Removing or demoting an owner can leave a team
without one, which is allowed — promote someone from the team page.

### Invite-link registration

On a team's **Moderation** tab, **Allow invite sign-up** lets that team's admins
create invite links that create new accounts. **Let these accounts become full
accounts** overrides the site default for that team. No team's invites create
accounts while sign-up is closed.

To dissolve a team that created accounts, use the staged flow on its Moderation
tab. Stage one deactivates every account it created; stage two deletes them
after the grace period, and you can cancel in between. Members who joined with
their own accounts, and anyone who converted, are untouched. See
[Teams → Restricted accounts](teams.md#restricted-accounts).

**Admin → Invites → Team invites** lists every outstanding team invite on the
instance. Revoking a link stops it working immediately; accounts already created
through it stay.

## Domains

**Admin → Domains** lists every personal and team domain. **Force verify** marks
a domain verified without checking DNS (for domains the worker can't reach, such
as an internal TLD); the audit entry records it as an admin override. **Withdraw
verification** and **Delete** are also available.

## Scope grants

**Admin → Scope grants** lists the elevated OAuth grants apps hold: `site:*`
(act across the instance) and `team:<id>:*` (act in one team). Open a grant to
see who approved it, what it allows and how many live tokens carry it.
**Revoke this grant** removes those scopes and the tokens and codes that carry
them; the app keeps anything else it was approved for.

## Notices

**Admin → Notices** publishes announcements inside the product — planned
downtime, a policy change, a security advisory.

| Field             | Effect                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| Level             | Info, warning or critical                                                                                      |
| Audience          | Everyone (including signed-out visitors on sign-in pages), signed-in users, admins only, or one team's members |
| Show from / until | When the notice appears and disappears                                                                         |
| Dismissible       | Turn off for something that must stay visible, like an active incident                                         |
| Pinned            | Sorts above other notices of its level                                                                         |

Notices are Markdown. They're drafts until published, so nothing half-written
shows. Readers can dismiss a notice for themselves; editing it doesn't bring it
back, but **Show again** does. Unpublish to take a notice down but keep it.

If a deploy added the notice tables but `wrangler d1 migrations apply` hasn't
run, the board shows empty and **Admin → Notices** says so.

## Database and key-value browser

**Admin → Database** gives direct access to D1 (table browser, row editor, SQL
console) and to the KV namespaces. It is **off unless you enable it** with the
`D1_CONSOLE` variable in `wrangler.jsonc`:

| `D1_CONSOLE`                           | Effect                    |
| -------------------------------------- | ------------------------- |
| unset, `off`, or anything unrecognised | The tab is gone (default) |
| `read-only`                            | Browse and `SELECT` only  |
| `full`                                 | Reads and writes          |

`KV_CONSOLE` controls the key-value browser the same way and follows
`D1_CONSOLE` when unset.

Things to know:

- Writes in the SQL console need an explicit **Read and write** mode and a
  confirmation step. Every statement is recorded in the platform audit log.
- The audit tables can be read but never written from here, at any setting.
- Signing keys are never shown or editable. Deleting one rotates it, which signs
  everyone out.
- Result sets are capped at 500 rows.

## Audit log

**Admin → Audit log** is the platform-scope log of every admin operation. Users
and teams have their own scoped logs. See [Audit Logs](audit-logs.md) for
filtering, export and webhooks.

**Admin → Login Errors** lists failed sign-in attempts with error code, identifier
and IP.
