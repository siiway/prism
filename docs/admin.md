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

| Stat             | Description                      |
| ---------------- | -------------------------------- |
| Total users      | All registered accounts          |
| OAuth apps       | All registered applications      |
| Verified domains | Domains that passed verification |
| Active tokens    | Non-expired OAuth access tokens  |

A panel under the stats surfaces operational warnings — most importantly, when
[`SECRETS_KEY`](configuration.md#secrets_key-setup) is bound but the D1 data
hasn't been migrated yet. Click through to **Settings → Danger Zone** to run the
one-time encryption pass.

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
- **Sudo mode TTL (minutes)** — after a successful 2FA step-up, subsequent
  challenges from the same `(user, session, app)` skip the TOTP/passkey prompt
  for this many minutes. `0` disables sudo mode entirely. The action
  acknowledgement checkbox is still required on every confirmation. See
  [OAuth → Step-up 2FA](oauth.md#step-up-2fa).
- **Require captcha for 2FA** — site-wide: every step-up confirmation must
  solve the active captcha. Apps can also opt in per challenge. No-op when the
  captcha provider is "None".
- **IPv6 rate-limit prefix** — how many bits of an IPv6 address are bucketed
  together for rate limiting (default `/64`). Prevents a single `/64` allocation
  from getting unlimited login attempts.

### Bot Protection

Choose one captcha provider:

| Provider             | Notes                                                                |
| -------------------- | -------------------------------------------------------------------- |
| None                 | No bot protection                                                    |
| Cloudflare Turnstile | Requires a Turnstile site key + secret. Free tier available.         |
| hCaptcha             | Requires an hCaptcha site key + secret.                              |
| reCAPTCHA v3         | Requires a Google reCAPTCHA v3 site key + secret. Invisible.         |
| Proof-of-Work        | No third-party service. Difficulty 20 = ~0.1–2 s on modern hardware. |

When **Cloudflare Turnstile** is selected, a **Challenge Endpoint** setting
chooses which host serves the widget script: the global
`challenges.cloudflare.com` or the Mainland-China-accelerated mirror
`challenges.cloudflare-cn.com`. Server-side verification always uses the global
host, so this only affects how the widget loads in the visitor's browser.
Options: always global, always China, or pick automatically by browser language
(client-side), by request region (server-side), or by browser region
(client-side). See [`turnstile_endpoint_mode`](configuration.md#bot-protection-captcha).

### Email

The email settings are split into two sub-tabs: **Send** and **Receive**.

#### Send

- **Email provider** — `none`, `resend`, `mailchannels`, or `smtp`
- **API key** — for Resend or Mailchannels
- **SMTP settings** — host, port, encryption, username, password (when provider is `smtp`)
- **From address** — the sender address for verification and notification emails
- **Send test email** — sends a test email to the admin's address to verify outgoing email is working

#### Receive

- **Email verification methods** — controls how users can verify their email:
  - `link` — system sends a verification link to the user's email
  - `send` — user sends an email to verify their address (see receive provider below)
  - `both` — user can choose either method
- **Receive provider** — how Prism receives inbound verification emails:
  - `Cloudflare Email Workers` — event-driven, emails trigger the worker's `email()` handler. Requires Cloudflare Email Routing. Users send an email to `verify-<code>@<host>`.
  - `IMAP` — Prism polls an IMAP mailbox on the cron schedule (every 6 hours by default). Works with any email provider. Users send an email **with their verification code as the subject** to the configured IMAP mailbox address (e.g. `receive@prism.example.com`).
  - `None` — disable inbound email (only link-based verification will work)
- **Receive host** — domain for inbound `verify-<code>@<host>` emails (Cloudflare Email Workers only). Leave blank to default to the `APP_URL` hostname.
- **IMAP settings** — host, port, encryption, username, password (when receive provider is `imap`). The IMAP username (email address) is shown to users as the destination for verification emails.
- **Test email receiving** — generates a test code and address to verify inbound email is working

### Domain re-verification

- **Domain reverify interval (days)** — how often Prism re-checks the proof
  for each verified domain (DNS TXT, HTML meta tag, or `.well-known` file —
  whichever was used at add time). Default is 30 days.

### Public profiles

- **Enable public profiles** — master kill switch. When off, both
  `/u/<username>` and `/t/<team-id>` always return 404 regardless of any
  individual user/team opt-in. See [Public Profiles](public-profile.md).
- **User profile defaults / Team profile defaults** — the per-field defaults
  applied to users (or teams) who haven't picked a value of their own. Changing
  a default propagates immediately to inheriting profiles; it never overrides
  an explicit user/team choice.

### Team join requirements

A site-wide floor that every team is forced to meet, regardless of the
team-level flag. Owners can opt their team in further, never out below the
floor.

- **Default require 2FA** — every team requires at least one TOTP authenticator
  or passkey enrolled.
- **Default require verified email** — every team requires a verified primary
  email.

::: warning
Turning these on retroactively forces every existing member to satisfy the
factor — anyone not enrolled is locked out of team operations until they do.
Notify members before flipping.
:::

### Sub-teams (nested teams)

The whole sub-team feature is configurable from this same page. Defaults
match how most operators want it; turn knobs off to scope the feature
down. See [Teams → Sub-teams](teams.md#sub-teams-nested-teams) for the
full semantics.

- **Enable sub-teams** — master switch. Off = every sub-team API returns
  403, the **Sub-teams** tab is hidden in the UI, and `parent_team_id`
  rows in the database are ignored for inheritance (preserved but inert,
  so you can re-enable without data loss).
- **Maximum nesting depth** — hard cap, validated 1–20. The default of 5
  is enough for most orgs; raising it costs an extra DB round-trip per
  level on every authorization check.
- **Inherit team membership** — when on (default), a member of a parent
  team is treated as a member of every descendant with at least the same
  role (`effective = max(direct, inherited)`). Off = direct memberships
  only — sub-team admins must be added explicitly.
- **Inherit verified domains** — when on (default), ancestor-owned
  domains appear on sub-team listings as read-only entries
  (`inherited_from = …`) and a sub-team adding a sub-domain of an
  ancestor's verified apex is auto-verified. Off = sub-teams must
  re-verify any domain they want to use.
- **Show sub-teams on public profile by default** — sets the
  `default_team_profile_show_sub_teams` site default. Each team can
  still override via **Teams → \<team\> → Settings → Public profile →
  Sub-teams**.

### Notifications & Telegram

- **Telegram notification source** — slug of an enabled Telegram OAuth source
  whose bot token is reused to deliver Telegram notifications. Leave empty to
  disable Telegram delivery (email and webhook delivery still work). See
  [Notifications](notifications.md).

### Diagnostics

- **Login-error retention (days)** — how long failed-login rows in
  `login_errors` are kept before the cron purges them.

### Danger zone

Tools that change the shape of the database. Each runs a single batched
migration and is idempotent — re-running is safe.

- **Migrate secrets to Secrets Store** — encrypts existing site-config secret
  values (captcha secret, social-source `client_secret`s, SMTP/IMAP passwords,
  GitHub README PAT, OAuth app `client_secret`s). Requires the
  [`SECRETS_KEY`](configuration.md#secrets_key-setup) binding.
- **Migrate D1 secrets** — replaces bearer-style values (PATs, OAuth tokens
  and codes, invite tokens, email-verify codes, 2FA codes, individual backup
  codes) with HMAC-SHA256 keyed hashes. The plaintext is no longer stored;
  user-supplied candidates are hashed for `WHERE col = ?` lookup.
- **Migrate teams to team-as-user rows** — backfills synthetic `users` rows
  (`kind = 'team'`) for every team so `oauth_apps.owner_id` joins uniformly.
- **Migrate image-proxy mappings** — registers proxy mappings for any avatar /
  icon URLs that pre-date the closed-mapping image proxy.
- **Migrate recovery codes** — re-hashes legacy plaintext backup codes.
- **Site reset** — wipe and reinitialize. The destination admin signs an email
  acknowledgement first; a typo confirmation in the UI then triggers the wipe.
  This is destructive and requires a configured email provider. The button is
  hidden unless `ENABLE_RESET = "true"` is set in `wrangler.jsonc`.

## OAuth Sources

**Admin → OAuth Sources** is where all social login providers are configured. Unlike a simple per-provider on/off toggle, each _source_ is an independently named OAuth connection with its own slug, credentials, and display name. This allows multiple sources of the same provider type (e.g. two GitHub apps, or a Keycloak instance alongside Google).

### Source fields

| Field         | Description                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------ |
| Slug          | Unique URL key — appears in the callback URL as `/api/connections/<slug>/callback`               |
| Provider      | Base OAuth type (GitHub, Google, Microsoft, Discord, Telegram, X, Generic OIDC, Generic OAuth 2) |
| Display name  | Label shown on login/register buttons                                                            |
| Client ID     | OAuth application client ID                                                                      |
| Client Secret | OAuth application client secret                                                                  |
| Trusted       | When `true` (default), social login through this source skips email verification                 |
| Enabled       | Toggle to show/hide the source on login without deleting it                                      |

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
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Change role         | Toggle between `user` and `admin`                                                               |
| Deactivate          | Prevents login; existing tokens remain valid until expiry                                       |
| Mark email verified | Manually verify without sending an email                                                        |
| Delete              | Permanently deletes the user and all their data (cascades to sessions, apps, connections, etc.) |

Deleting a user is irreversible. Their OAuth apps are also deleted, which will
break any third-party integrations that used those apps.

If a username is listed in the `LOCKDOWN_USERS` env var in `wrangler.jsonc`,
the delete button is hidden and the API returns a 403 — that user is permanently
protected from deletion. See [Configuration → Wrangler bindings & variables](configuration.md#wrangler-bindings--variables).

### The account detail page

**Admin → Users → Manage** opens one account in full. The list view gives you
a row and three toggles; this is the page for everything a user can do to
*themselves*, which until now lived only behind `/api/user/me/*` and was
therefore reachable by nobody else.

**Overview**

| Action                       | Notes                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------ |
| Edit username / email / display name | The self-serve API has no path to any of these. Changing the address clears its verified status unless you set it in the same request |
| Set or clear the password    | The user is not notified and never learns it — hand it over out of band and have them change it. Clearing is refused unless a linked provider remains to sign in with |
| Reset 2FA                    | Removes every authenticator, passkey **and** recovery code. After it the password alone gets someone in |
| Remove one factor            | For the case where only one authenticator is lost                             |
| Verify / promote / remove an email | Including the primary address, which the self-serve flow can only change by promoting an already-verified alternate |

**Access** — personal access tokens, linked providers, GPG keys and authorized
applications, each with a revoke. Revoking an authorization also deletes the
tokens and codes issued under it; revoking the record and leaving the access
would be worse than doing nothing. Unlinking the last provider on an account
with no password is refused.

**Resources** — personal domains, and every team the account belongs to.
Memberships are changed on the team itself, which a site admin can open for
any team.

**Audit** — the account's own log: everything it did, and everything an
administrator did to it.

Every action on this page is written to **both** the platform log and the
user's own audit log, the latter marked `site_admin: true`. That second copy
is the point: an operator changing someone's credentials is exactly the event
the account holder needs to be able to find.

Tokens are never returned in plaintext here. They are stored hashed and an
admin has no more business reading one than anyone else.

**Signing in as another user is deliberately not offered.** Every action above
carries the operator's name; a session minted for someone else would launder
those actions into the user's own history, and no logging at the point of
issue fixes what the rest of the system then records.

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

## Teams

**Admin → Teams** lists every team across the instance with its owner, member
count, and join-requirement flags.

| Action     | Effect                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------- |
| Inspect    | View members, owned apps, and verified domains for the team                                     |
| Manage     | Open the team's own page with owner-level access, without joining it                            |
| Add member | Add any account to the team, at any role up to co-owner                                         |
| Create     | Stand up a new team and name its owner                                                          |
| Disband    | Remove the team. Team-owned apps are reassigned to the team's owner so they survive the cascade |

If a team name is listed in the `LOCKDOWN_TEAMS` env var, the disband button is
hidden and the API returns a 403. See [Configuration → Wrangler bindings & variables](configuration.md#wrangler-bindings--variables).

`disable_user_create_team` hides the "New team" button from non-admins. With it
on, only admins can create teams (existing teams keep working).

### Site-admin access to every team

A site administrator holds **owner-level authority on every team**, whether or
not they are a member. There is no separate admin-only copy of the team API —
`/api/teams/*` simply treats an admin as the owner, so the ordinary team page
at `/teams/:id` is the management screen and never drifts out of step with a
parallel implementation.

What that unlocks, from outside the team:

- Open and edit any team — name, description, avatar, profile visibility,
  join requirements, role permissions, groups, apps and domains.
- Add anyone to any team. The team's own join requirements (2FA, verified
  email) and the restricted-account scope rule are **overridden**; the audit
  entry records exactly which checks were waived under `bypassed`.
- Change any member's role, including promoting a member to `owner` — which
  demotes the sitting owner to co-owner in the same operation.
- Remove any member, the owner included. The seat never stays empty: the most
  senior remaining member (longest-serving on a tie) is promoted in the same
  batch. Removing the owner of a one-member team is refused — delete the team
  instead of emptying it.
- Transfer ownership, including to someone who isn't a member yet.

Two limits still apply to admins, because they protect an invariant rather
than a permission:

- Ownership cannot be handed to an account registered through a team invite —
  it would let the restriction be reconfigured from inside.
- `LOCKDOWN_TEAMS` still blocks deletion.

Every elevated action is written to the team's own audit log with
`site_admin: true` in its metadata, so a team can tell an owner's change apart
from the site acting over their heads.

Elevation is bound to a **session**. A Personal Access Token carries only the
scopes stamped on it, so an admin's `apps:write` token stays an `apps:write`
token and does not become a site-wide master key.

## Invite-link registration

**Admin → Teams** carries two extra controls once
`enable_team_invite_registration` is on.

**Authorise / revoke** — grants a team permission to hand out account-creating
invite links. This is the second of two doors; without it the team owner's own
switch does nothing. Revoking also closes that switch, so the channel shuts
immediately rather than reopening if the grant is later restored.

Exemptions are set through the same endpoint. Only email verification can be
exempted, and only by an administrator — it is the one check whose cost scales
with the number of registrations. Captcha, proof-of-work and every rate limit
are never exemptible.

**Dissolve (staged)** — dissolving a team that minted accounts deletes those
accounts, so it does not go through the ordinary delete button (which returns
409 for such teams). Stage one deactivates every affected account in a single
statement, however many there are. Stage two deletes them in batches after
`restricted_dissolve_grace_hours`, which leaves a window to cancel.

Only accounts whose origin is that team are deleted. Members who joined with
their own Prism accounts, and anyone who has converted, are untouched.

`GET /api/admin/restricted-users?invite_token=…` lists the accounts a given
link produced — the query to run when one leaks.

See [Teams → Restricted accounts](teams.md#restricted-accounts) for the full
model.

## Request Logs

**Admin → Request Logs** is a paginated, filterable table of every Worker
request — method, path, status, duration, IP, user agent, optional user ID
(when authenticated), and the matching audit log row if any.

- **Filter** by method, status range, path prefix, or user.
- **Spectate** opens a tail-style live view that auto-refreshes.
- **Export CSV** dumps the current filter to CSV.
- **Details** for a single request shows the full request/response timing and
  any audit-log linkage.
- **Purge** drops the entire table (or just the spectate buffer).

Request logs are independent of audit logs: a request hit may or may not result
in an audit-worthy state change, and audit log entries for cron-driven actions
have no associated request row.

**Log outbound requests** is a separate debug switch for external API calls made
by the Worker, such as Telegram and Discord notification delivery. When enabled,
Prism writes those calls into `request_logs` with the external URL as `path` and
the redacted request/response bodies in Details. Keep it off unless actively
debugging third-party delivery failures because it records message payloads and
performs an extra KV read per outbound call.

## Login Errors

**Admin → Login Errors** lists failed authentication attempts (wrong password,
wrong TOTP, expired challenge, etc.) with their error code, identifier, IP, and
metadata. The `login_error_retention_days` config controls how long rows are
kept before the cron sweeps them.

## Domains

**Admin → Domains** is every domain on the instance, personal and team-owned,
searchable and filterable by verification state. Domains were previously
reachable only through the account or team that owned them, which is the wrong
index for the question an operator actually has: who claims `example.com`?

| Action                 | Effect                                                                    |
| ---------------------- | ------------------------------------------------------------------------- |
| Force verify           | Marks the domain verified **without checking DNS**                        |
| Withdraw verification  | Clears the verified flag                                                  |
| Delete                 | Removes the domain from its owner                                         |

Force-verify is an override, not a check. It exists for domains whose DNS the
worker cannot reach — split-horizon, an internal TLD, a registrar outage —
where the alternative is the domain never working at all. The audit entry
records `method: admin_override` precisely so a verified badge asserted by an
administrator stays distinguishable from one demonstrated by a DNS record.

## Instance-wide operations

The rest of the admin surface works one row at a time. These apply to
everything at once, and each is a response to an incident rather than a
routine task.

### Sign everyone out

**Admin → Settings → Danger Zone → Sign everyone out** deletes every active
session. The count is shown before you press it. Your own session is kept by
default — an operator who signs themselves out mid-incident has to log back in
through whatever they were trying to contain — and "include my own session" is
there for when your session is the thing you are worried about.

OAuth tokens are not affected. Those are revoked per application or per
account, below.

### Cut off an application

**Admin → Applications → Revoke all access** deletes every token, refresh
token, pending authorization code **and consent record** for one app. The
consent records are the part that matters: leave them and every user walks
straight back through the consent screen without being asked, which is not
what "revoked" means to whoever pressed this during a leak. Optionally
deactivates the app in the same operation.

### Cut off an account

**Admin → Users → Manage → Access → Revoke all authorizations** does the same
for one account across every application. Personal access tokens are separate
and revoked in their own section — they are the account's own credentials
rather than something granted to a third party.

### Transfer an application

**Admin → Applications → Transfer** moves an app to any user or team. Apps
could already move between a user and their own teams; nothing could move one
to an unrelated account, which is what is needed when the owner leaves or an
app was created under the wrong identity. The client ID and secret are
untouched, so deployed integrations keep working.

### Lift an invite-registration restriction

**Admin → Users → Manage → Lift restriction** converts an account minted
through a team invite into an ordinary one. The self-serve path requires a
verified real address first; an operator who has confirmed the holder some
other way can waive that, and the audit entry records that they did.

## Database

**Admin → Database** is direct access to the D1 database behind the instance:
a schema browser with an inline row editor, and a SQL console.

### Turning it down

The `D1_CONSOLE` variable in `wrangler.jsonc` decides how much of this exists.

| Value                                             | Effect                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| unset (or anything unrecognised)                  | Full access — browse, edit rows, run any statement                           |
| `read-only` / `readonly` / `read`                 | Browse and `SELECT`. Every write is refused, including one sent with `allow_write` — the caller cannot opt back over the operator's setting |
| `off` / `false` / `0` / `no` / `disabled` / `none`| The surface is gone. Endpoints 404 and the tab disappears                     |

It defaults to full because the operator who deployed the instance is the
audience for this feature and already owns the database. Operators who would
rather not carry the risk turn it down; the setting is read per request, so a
`wrangler deploy` is all it takes to change.

It exists because every other admin screen is a curated view of the database,
and curated views always end one column short of the thing you actually need.
It is also the most dangerous surface in the product — a single statement can
empty a table or hand out admin — so three things hold it in place:

1. **Writes must be asked for.** Anything that isn't a plain read is refused
   unless write mode is on, so a mistyped console session can't destroy data it
   only meant to read. `PRAGMA x = y` counts as a write; classification errs
   toward "write" whenever it is unsure.
2. **Everything is audited.** Every statement — read, write, and rejected —
   lands in the platform audit log with the SQL, the row counts and the caller.
3. **Identifiers are never interpolated from input.** The browser and row
   editor resolve table and column names against the live schema before
   quoting them. Only the console takes raw SQL, and it takes it as one
   explicit, audited act.

### Browse tables

Pick a table to page through its rows. The header marks primary-key columns,
the DDL that created the table is shown above the grid, and the filter box
takes a raw SQL `WHERE` fragment (without the keyword).

Rows are edited, inserted and deleted in place. An update sends only the
columns you actually changed. An empty input means `NULL`, which the grid also
renders distinctly from an empty string — the two are not the same value and
must not look alike in a table you are about to edit.

A table with no primary key is browsable but not row-editable: there is no way
to address a single row. SQLite's `rowid` is used where one exists, so this
only affects `WITHOUT ROWID` tables. Those are edited from the console.

### SQL console

Runs one or more statements against the live database. Multiple statements
separated by semicolons run inside a single transaction, so a script that
fails halfway leaves nothing behind. Result sets are capped at 500 rows and
marked as truncated when they hit it.

Write mode is a switch, and turning it on adds a confirmation step that shows
the statement one more time before it runs.

### Endpoints

| Endpoint                                       | Purpose                                    |
| ---------------------------------------------- | ------------------------------------------ |
| `GET /api/admin/db/tables`                     | Tables with row counts, columns and DDL    |
| `GET /api/admin/db/tables/:table/rows`         | Page rows (`page`, `limit`, `order_by`, `dir`, `where`) |
| `POST /api/admin/db/tables/:table/rows`        | Insert a row                               |
| `PATCH /api/admin/db/tables/:table/rows`       | Update a row by primary key                |
| `DELETE /api/admin/db/tables/:table/rows`      | Delete a row by primary key                |
| `POST /api/admin/db/query`                     | Run SQL (`allow_write` required to modify) |

All of them sit behind `requireAdmin` and are session-only.

### Key–value browser

The third tab in **Admin → Database**. KV holds most of what makes an instance
behave the way it does on a given day — the debug switches, in-flight OAuth
states, sudo grants, the pending site reset — and nothing else renders any of
it.

KV has no schema, so navigation is a namespace picker and a prefix box rather
than a table list. Two namespaces are exposed: `sessions` (sessions, system
flags, signing keys) and `cache`. Listing pages with KV's own opaque cursor,
so it moves forward and back rather than jumping to a page number.

**Key material is withheld.** `system:jwt_secret` and the signing keypairs
come back flagged, without their value, and cannot be written through this
surface. Reading the JWT secret is equivalent to being able to mint a session
for any account — which is [the one thing this admin surface deliberately does
not offer](#the-account-detail-page), and a chosen signing key is the same
power as a stolen one. Deleting such a key **is** allowed: that is rotation,
it is loud in the audit log, and the next request regenerates it. Every
session and token that depended on the old key stops working.

Purging a prefix is bounded to one page per call and skips key material; the
response says how many it removed, how many it skipped, and whether more
remain.

`KV_CONSOLE` gates this the same way `D1_CONSOLE` gates the database tabs, and
follows `D1_CONSOLE` when unset.

## Audit Log

The **Audit log** tab shows the platform-scope log (Transparent Platform
Control) — every admin operation. Users and teams have their own scoped logs;
see [Audit Logs](audit-logs.md) for the full model, filtering, and scoped
webhooks. It is a paginated, append-only list of significant events:

| Event                                       | Triggered by                               |
| ------------------------------------------- | ------------------------------------------ |
| `user.register`                             | Successful registration                    |
| `user.login`                                | Successful login                           |
| `user.login.failed`                         | Failed login attempt                       |
| `user.logout`                               | Logout                                     |
| `user.delete`                               | Account deletion                           |
| `user.password_changed`                     | Password changed via Profile → Security    |
| `totp.enabled`                              | TOTP authenticator setup completed         |
| `totp.disabled`                             | TOTP authenticator removed                 |
| `passkey.registered`                        | New passkey added                          |
| `passkey.deleted`                           | Passkey removed                            |
| `gpg.key_added`                             | GPG public key registered                  |
| `gpg.key_deleted`                           | GPG public key removed                     |
| `gpg.login`                                 | Signed-in via GPG challenge                |
| `oauth.authorize`                           | User approved an OAuth app                 |
| `oauth.token`                               | Token issued                               |
| `oauth.consent_revoked`                     | User revoked an app's access               |
| `oauth.2fa.verify`                          | Step-up 2FA confirmed                      |
| `oauth.2fa.sudo_revoked`                    | User revoked a sudo grace window           |
| `team.created`                              | Team created                               |
| `team.member_added`                         | Member joined a team (invite or admin add) |
| `team.member_removed`                       | Member left or was removed                 |
| `team.transferred`                          | Team ownership transferred                 |
| `domain.added` / `verified` / `deleted`     | Domain lifecycle                           |
| `connection.added` / `removed`              | Social connection lifecycle                |
| `oauth_source.create` / `update` / `delete` | OAuth source lifecycle                     |
| `invite.create` / `revoke`                  | Site invite lifecycle                      |
| `admin.config.update`                       | Site config changed                        |
| `admin.user.update`                         | Admin changed a user                       |
| `admin.user.delete`                         | Admin deleted a user                       |
| `admin.app.update`                          | Admin verified or deactivated an app       |
| `admin.team.delete`                         | Admin disbanded a team                     |
| `admin.secrets.migrate`                     | Site-config or D1 secrets migration ran    |
| `admin.reset.*`                             | Site-reset request / cancel / confirm      |
| `admin.db.query.read`                       | SQL console ran a read-only statement      |
| `admin.db.query.write`                      | SQL console ran a statement that writes    |
| `admin.db.query.error`                      | A console statement was rejected or failed |
| `admin.db.row.insert` / `update` / `delete` | Row edited through the table browser       |
| `admin.user.password_set`                   | Admin set or cleared an account's password |
| `admin.user.2fa_reset`                      | Admin removed every second factor          |
| `admin.user.totp_removed` / `passkey_removed` | Admin removed one factor                 |
| `admin.user.token_revoked`                  | Admin revoked a personal access token      |
| `admin.user.connection_removed`             | Admin unlinked a social provider           |
| `admin.user.gpg_key_removed`                | Admin removed a GPG key                    |
| `admin.user.email_verified`                 | Admin marked an address verified           |
| `admin.user.primary_email_changed`          | Admin promoted an alternate address        |
| `admin.user.email_removed`                  | Admin removed an alternate address         |
| `admin.user.domain_removed`                 | Admin removed a personal domain            |
| `admin.user.authorization_revoked`          | Admin revoked an OAuth grant               |
| `admin.user.converted`                      | Admin lifted an invite-registration restriction |
| `admin.revoke.all_sessions`                 | Every session on the instance was deleted  |
| `admin.revoke.app`                          | An application's tokens and consents were revoked |
| `admin.revoke.user_grants`                  | One account's OAuth grants were revoked    |
| `admin.app.transfer`                        | An application changed owner               |
| `admin.domain.force_verify` / `unverify`    | Verification asserted or withdrawn by an admin |
| `admin.domain.delete`                       | Admin deleted a domain                     |
| `admin.kv.read` / `write` / `delete`        | A key–value entry was read or changed      |
| `admin.kv.purge`                            | Every key under a prefix was deleted       |

Each entry records the acting `user_id` (or `null` for system actions), the
`action`, optional `resource_type` / `resource_id`, a `metadata` JSON object,
and the `ip_address`.

For the full OAuth scope reference, see
[OAuth → Scopes](oauth.md#scopes) and [Teams → OAuth scopes](teams.md#oauth-scopes).
