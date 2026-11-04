---
title: API Reference
description: REST API for Prism — auth, OAuth, apps, teams, domains, GPG, public profiles, and admin endpoints.
---

# API Reference

Base path: `/api`

All endpoints return JSON. The web UI authenticates with a secure, HttpOnly
session cookie. API integrations should use an OAuth access token from the
standard authorization code flow, or a personal access token (prefix
`prism_pat_`). Token-authenticated user endpoints are mostly under
`/api/oauth/me/*`.

Cross-origin requests are only allowed from `APP_URL`, except for the image
proxy, `/.well-known/*` and public profile endpoints, which are safe to embed.
Request bodies are limited to 5 MiB; larger ones get `413`.

## Errors

A failed request returns a stable, machine-readable code:

```json
{ "error": "field_required", "params": { "field": "name" } }
```

`error` is a lowercase code such as `team_not_found` or `forbidden`; compare
against it. `params` is present when the message has blanks to fill (a field
name, a limit). The web UI translates each code, so there's no English message
in the response. Successful writes return data, or `{ "ok": true }` when there's
nothing to return.

OAuth and OpenID Connect protocol endpoints (`/api/oauth/token`,
`/api/oauth/register`, `/api/oauth/userinfo`, the device flow, and so on) follow
their RFCs instead: `error` is the standard code and `error_description` is
English text for client developers.

## Init

### `GET /api/init/status`

Returns `{ "initialized": false }` until first-run setup is done.

### `POST /api/init`

Creates the first admin account. Only works before setup is complete.

```json
{
  "email": "admin@example.com",
  "username": "admin",
  "password": "s3cur3",
  "display_name": "Admin",
  "site_name": "My Prism"
}
```

**Response** — `{ "user": { ... } }`. The session is set in the cookie only.

## Site

### `GET /api/site`

Public site configuration for the frontend. No authentication; secrets are never
included.

```json
{
  "site_name": "Prism",
  "site_description": "...",
  "site_icon_url": null,
  "allow_registration": true,
  "invite_only": false,
  "captcha_provider": "none",
  "accent_color": "#0078d4",
  "initialized": true,
  "require_email_verification": false,
  "enable_public_profiles": true,
  "enable_sub_teams": true,
  "max_team_depth": 5,
  "enabled_sources": [
    { "slug": "github", "provider": "github", "name": "GitHub" }
  ]
}
```

The real response has more fields (feature switches and defaults).

## Auth

### `POST /api/auth/register`

```json
{
  "email": "user@example.com",
  "username": "alice",
  "password": "hunter2",
  "display_name": "Alice",
  "captcha_token": "...",
  "invite_token": "..."
}
```

Include whichever bot-protection fields match the active captcha provider.
`invite_token` is required in invite-only mode. **Response** — `{ "user": { ... } }`
when registration also signs the user in (the session is in the cookie only).

### `POST /api/auth/login`

```json
{
  "identifier": "alice",
  "password": "hunter2",
  "totp_code": "123456",
  "captcha_token": "..."
}
```

`identifier` is a username, primary email, or (when `allow_alt_email_login` is
on) any verified secondary email. `totp_code` is needed only if TOTP is enrolled.
Passkeys use the dedicated endpoints below.

**Response** — `{ "user": { ... } }`. If TOTP is enrolled but no code was sent:

```json
{ "totp_required": true, "available_methods": ["totp", "passkey", "backup"] }
```

### `POST /api/auth/logout`

Ends the current session. Prism supports one browser session at a time;
switching accounts means signing out and in again.

### Email verification

| Endpoint                                  | Purpose                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `GET /api/auth/verify-email?token=`       | Verify using the emailed link                                          |
| `POST /api/auth/email-verify-code`        | Get an address to email for verify-by-sending: `{ "address", "code" }` |
| `POST /api/auth/check-email-verification` | `{ "verified": boolean }` — poll while the user sends the email        |
| `POST /api/auth/resend-verify-email`      | Resend the link (accepts captcha fields)                               |

## TOTP

All endpoints require authentication. A user can have several authenticators.

| Endpoint                           | Purpose                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| `GET /api/auth/totp/list`          | List authenticators                                                                               |
| `POST /api/auth/totp/setup`        | Create a secret. Optional `name`. Returns `{ name, secret, uri }`; `uri` is an `otpauth://` URI   |
| `POST /api/auth/totp/verify`       | Confirm setup with the first code. Returns backup codes the first time any authenticator is added |
| `DELETE /api/auth/totp/:id`        | Remove one. Needs a TOTP code, backup code or passkey verification                                |
| `POST /api/auth/totp/backup-codes` | Regenerate backup codes. Needs a valid TOTP code                                                  |

## Passkeys (WebAuthn)

| Endpoint                                           | Purpose                                                        |
| -------------------------------------------------- | -------------------------------------------------------------- |
| `POST /api/auth/passkey/register/begin` / `finish` | Add a passkey                                                  |
| `POST /api/auth/passkey/auth/begin` / `finish`     | Sign in. Pass `username` to narrow the credentials, or omit it |
| `POST /api/auth/passkey/verify/begin` / `finish`   | Re-verify while signed in (used by step-up confirmations)      |
| `GET /api/auth/passkeys`                           | List the user's passkeys                                       |
| `DELETE /api/auth/passkeys/:id`                    | Remove one                                                     |

## GPG keys

### `POST /api/auth/gpg-challenge`

Request a sign-in challenge: `{ "identifier": "alice" }`. Returns
`{ "challenge": "...", "text": "Prism login\n..." }`. The site's
`gpg_challenge_prefix` is added to the text so users can recognise your site.

### `POST /api/auth/gpg-login`

Submit the `gpg --clearsign`-ed challenge:

```json
{
  "identifier": "alice",
  "signed_message": "-----BEGIN PGP SIGNED MESSAGE-----\n..."
}
```

The challenge works once and expires after 5 minutes. If the account has TOTP
and hasn't turned off **Require 2FA after GPG verification**, the first call
returns `{ "totp_required": true }`; resubmit the same message with `totp_code`.

### Managing keys

`GET`, `POST` and `DELETE /api/user/gpg[/:id]` manage the signed-in user's keys.
`POST` takes an ASCII-armored `public_key` and optional `name`; RSA, EdDSA and
ML-DSA keys are supported. A `public_key` holding several keys (concatenated
blocks, or one block from `gpg --export --armor key1 key2`) is split into one
key per entry, up to 20 distinct keys (`400 gpg_too_many_keys` beyond that).
Repeated keys and keys already registered are skipped; with several keys,
`name` gets a `#1`, `#2`… suffix. The response is
`{ "keys": [...], "added": <count>, "skipped": <count> }`, or `409 key_exists`
when every key was already there.

`GET /users/:username.gpg` is a public lookup that returns the user's keys as
armored blocks (`application/pgp-keys`).

With OAuth: `GET /api/oauth/me/gpg-keys` (`gpg:read`), `POST` and
`DELETE /api/oauth/me/gpg-keys/:id` (`gpg:write`). `POST` splits keys the same
way; its response also carries the first added key's fields at the top level.

## Sessions

| Endpoint                         | Purpose                                                          |
| -------------------------------- | ---------------------------------------------------------------- |
| `GET /api/auth/sessions`         | The user's active sessions, with the IP and its geolocation      |
| `GET /api/auth/sessions/:id/ips` | Every IP a session has signed in from, with first/last seen      |
| `DELETE /api/auth/sessions/:id`  | Revoke one session                                               |
| `DELETE /api/auth/sessions`      | Revoke all but the current one. Returns `{ "revoked": <count> }` |

## User

All endpoints require authentication.

| Endpoint                                                                   | Purpose                                                                                                               |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET` / `PATCH /api/user/me`                                               | Read or update the user (display name, avatar, profile visibility, preferences)                                       |
| `POST /api/user/me/change-password`                                        | `{ "current_password", "new_password" }`                                                                              |
| `POST /api/user/me/avatar`                                                 | `multipart/form-data`, field `avatar`. Max 2 MB; JPEG, PNG, WebP or GIF                                               |
| `POST /api/user/me/readme`                                                 | Save a Markdown README                                                                                                |
| `POST /api/user/me/readme/sync`                                            | Sync it from the user's `github.com/<login>/<login>` repo                                                             |
| `GET` / `POST` / `DELETE /api/user/me/emails[/:id]`                        | Manage secondary emails. `POST /:id/resend` resends; `POST /:id/set-primary` swaps the primary after verification     |
| `GET` / `PUT /api/user/me/notifications`                                   | Notification preferences. See [Notifications](notifications.md)                                                       |
| `GET` / `POST` / `PUT` / `DELETE /api/user/me/notification-rulesets[/:id]` | Notification rulesets. See [Notifications](notifications.md)                                                          |
| `GET` / `POST` / `DELETE /api/user/tokens[/:id]`                           | Personal access tokens. The value is shown only when created. See [Personal Access Tokens](personal-access-tokens.md) |
| `DELETE /api/user/me`                                                      | Delete the account: `{ "password": "...", "confirm": "DELETE" }`                                                      |

List endpoints accept `?page=`, `?limit=` and often `?q=`, and return `total`.

## OAuth apps

All endpoints require authentication. See the [OAuth / OIDC Guide](oauth.md) and
[Cross-App Permissions](app-permissions.md).

| Method                              | Path                                         | Notes                                                                                                                 |
| ----------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET`                               | `/api/apps`                                  | Apps owned by the current user                                                                                        |
| `POST`                              | `/api/apps`                                  | Create an app                                                                                                         |
| `GET`                               | `/api/apps/:id`                              | Read an app                                                                                                           |
| `PATCH`                             | `/api/apps/:id`                              | Update fields, including `oidc_fields`, `optional_scopes`, `use_jwt_tokens`, `allow_self_manage_exported_permissions` |
| `POST`                              | `/api/apps/:id/rotate-secret`                | Rotate the `client_secret`                                                                                            |
| `DELETE`                            | `/api/apps/:id`                              | Delete an app                                                                                                         |
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/apps/:id/scope-definitions[/:scope]`   | Exported scopes                                                                                                       |
| `GET` / `POST` / `DELETE`           | `/api/apps/:id/scope-access-rules[/:ruleId]` | Who may add or request the app's scopes                                                                               |
| `GET` / `POST` / `DELETE`           | `/api/apps/:id/access-rules[/:ruleId]`       | [Access whitelist](app-access-whitelist.md)                                                                           |
| `GET` / `PUT` / `DELETE`            | `/api/apps/:id/saml`                         | [SAML](saml.md) settings, and the IdP details to give the app                                                         |
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/apps/:appId/webhooks[/:id]`            | [App notifications](app-notifications.md)                                                                             |

App secrets are write-only: the generated secret is returned only when an app is
created or its secret rotated. Everywhere else you get `has_client_secret`
instead.

## Teams

See [Teams](teams.md) for the concepts.

| Method                    | Path                                                                                 | Notes                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `GET`                     | `/api/teams`                                                                         | Teams the user can reach, including inherited sub-teams (`inherited_from`)                             |
| `POST`                    | `/api/teams`                                                                         | Create a team. `parent_team_id` makes it a sub-team. Site admins may set `owner_username` / `owner_id` |
| `GET`                     | `/api/teams/:id`                                                                     | Team details with `my_role`, `ancestors`, `sub_teams` and the first page of members                    |
| `PATCH`                   | `/api/teams/:id`                                                                     | Update settings, join requirements, `parent_team_id`, groups settings                                  |
| `DELETE`                  | `/api/teams/:id`                                                                     | Disband the team and every sub-team                                                                    |
| `GET` / `POST`            | `/api/teams/:id/sub-teams`                                                           | List or create sub-teams                                                                               |
| `GET`                     | `/api/teams/:id/members`                                                             | Members. `?q=`, `?group=` (slug)                                                                       |
| `POST`                    | `/api/teams/:id/members`                                                             | Add a member by `username` or `user_id`                                                                |
| `PATCH`                   | `/api/teams/:id/members/:userId`                                                     | Change role                                                                                            |
| `DELETE`                  | `/api/teams/:id/members/:userId`                                                     | Remove a member, or leave (your own id)                                                                |
| `PATCH`                   | `/api/teams/:id/membership/show-on-profile`                                          | Opt in or out of the team's public member list                                                         |
| `GET` / `POST`            | `/api/teams/:id/groups`                                                              | List or create [member groups](teams.md#member-groups)                                                 |
| `PATCH` / `DELETE`        | `/api/teams/:id/groups/:groupId`                                                     | Update or delete a group                                                                               |
| `PUT`                     | `/api/teams/:id/members/:userId/groups`                                              | Replace a member's groups: `{ "group_ids": [...] }`                                                    |
| `POST`                    | `/api/teams/:id/transfer-ownership`                                                  | Transfer ownership to another member                                                                   |
| `GET` / `POST`            | `/api/teams/:id/invites`                                                             | List or create invites (email lock, max uses, one group, absolute `expires_at`)                        |
| `PATCH` / `DELETE`        | `/api/teams/:id/invites/:token`                                                      | Edit, enable/disable or revoke an invite                                                               |
| `GET`                     | `/api/teams/join/:token`                                                             | Preview an invite: team, requirements, unmet items (auth optional)                                     |
| `POST`                    | `/api/teams/join/:token`                                                             | Accept an invite                                                                                       |
| `GET` / `POST` / `DELETE` | `/api/teams/:id/domains[/:domainId]`                                                 | Team domains                                                                                           |
| `POST`                    | `/api/teams/:id/domains/:domainId/verify`                                            | Re-verify                                                                                              |
| `POST`                    | `/api/teams/:id/domains/:domainId/share-to-team`, `share-to-personal`, `to-personal` | Share a personal domain with the team, reverse it, or move it out                                      |
| `GET` / `POST`            | `/api/teams/:id/apps`                                                                | Team-owned apps                                                                                        |
| `POST` / `DELETE`         | `/api/teams/:id/apps/transfer`, `/api/teams/:id/apps/:appId/transfer`                | Move a personal app into the team, or back out                                                         |

### Invite-link registration

See [Teams → Invite-link registration](teams.md#invite-link-registration).

| Method | Path                             | Notes                                                            |
| ------ | -------------------------------- | ---------------------------------------------------------------- |
| `GET`  | `/api/join/:teamId`              | Public. Team branding, requirements and captcha config           |
| `POST` | `/api/auth/register-with-invite` | Create a pending account and sign it in                          |
| `GET`  | `/api/auth/invite-join/status`   | What the pending account still has to satisfy                    |
| `POST` | `/api/auth/invite-join/complete` | Join the team once the requirements are met                      |
| `GET`  | `/api/user/me/restriction`       | Whether the caller is restricted, and whether it can convert     |
| `POST` | `/api/user/me/convert`           | Convert to a full account (one-way; needs a verified real email) |

## Domains

| Method   | Path                      | Notes                                                                              |
| -------- | ------------------------- | ---------------------------------------------------------------------------------- |
| `GET`    | `/api/domains`            | The user's domains                                                                 |
| `POST`   | `/api/domains`            | Add a domain. Returns the verification options (DNS TXT, HTML meta, `.well-known`) |
| `POST`   | `/api/domains/:id/verify` | Check verification now                                                             |
| `DELETE` | `/api/domains/:id`        | Remove                                                                             |

## Social connections

| Method   | Path                               | Notes                                                                     |
| -------- | ---------------------------------- | ------------------------------------------------------------------------- |
| `GET`    | `/api/connections`                 | The user's linked accounts                                                |
| `POST`   | `/api/connections/intent`          | Get a short-lived token for linking a provider                            |
| `GET`    | `/api/connections/:slug/begin`     | Start sign-in (`?mode=login`) or linking (`?mode=connect&intent=<token>`) |
| `GET`    | `/api/connections/:slug/callback`  | The provider's redirect target                                            |
| `POST`   | `/api/connections/:slug/tg-verify` | Verify Telegram login data                                                |
| `POST`   | `/api/connections/:id/refresh`     | Refresh display name and avatar from the provider                         |
| `DELETE` | `/api/connections/:id`             | Disconnect                                                                |

The flow must finish in the browser that started it, within 10 minutes.
OAuth-token equivalents: `GET /api/oauth/me/social-connections` (`social:read`)
and `DELETE /api/oauth/me/social-connections/:id` (`social:write`).

## OAuth 2.0 / OIDC

See the [OAuth / OIDC Guide](oauth.md) for the walkthrough.

| Method               | Path                                      | Notes                                                |
| -------------------- | ----------------------------------------- | ---------------------------------------------------- |
| `GET`                | `/api/oauth/authorize`                    | App info and requested scopes for the consent screen |
| `POST`               | `/api/oauth/authorize`                    | Approve or deny                                      |
| `POST`               | `/api/oauth/par`                          | Pushed Authorization Requests (RFC 9126)             |
| `POST`               | `/api/oauth/register`                     | Dynamic Client Registration (RFC 7591)               |
| `GET`/`PUT`/`DELETE` | `/api/oauth/register/:client_id`          | Client management (RFC 7592)                         |
| `POST`               | `/api/oauth/token`                        | Code, refresh, device and token-exchange grants      |
| `POST`               | `/api/oauth/device_authorization`         | Device Authorization Grant (RFC 8628)                |
| `GET` / `POST`       | `/api/oauth/userinfo`                     | OIDC UserInfo                                        |
| `POST`               | `/api/oauth/introspect`                   | RFC 7662                                             |
| `POST`               | `/api/oauth/revoke`                       | RFC 7009                                             |
| `GET` / `POST`       | `/api/oauth/end_session`                  | RP-Initiated Logout                                  |
| `GET`                | `/.well-known/openid-configuration`       | OpenID Connect Discovery                             |
| `GET`                | `/.well-known/oauth-authorization-server` | RFC 8414 metadata                                    |
| `GET`                | `/.well-known/oauth-protected-resource`   | RFC 9728 metadata                                    |
| `GET`                | `/.well-known/webfinger`                  | Issuer discovery                                     |
| `GET`                | `/.well-known/jwks.json`                  | Public signing keys                                  |
| `GET`                | `/.well-known/security.txt`               | When a security contact is configured                |
| `GET`                | `/.well-known/change-password`            | Redirects to the change-password page                |

### Step-up 2FA

| Method | Path                         | Auth                                                        |
| ------ | ---------------------------- | ----------------------------------------------------------- |
| `POST` | `/api/oauth/2fa/challenges`  | App credentials (HTTP Basic) or PKCE                        |
| `POST` | `/api/oauth/2fa/verify`      | App credentials — exchange the redirect code for the result |
| `POST` | `/api/oauth/2fa/sudo/revoke` | User session — end a sudo window                            |

The other step-up endpoints serve Prism's own confirmation page.

### `/api/oauth/me/*` (token-authenticated)

These accept an OAuth access token or a personal access token. Scopes are
listed in [OAuth → Scopes](oauth.md#scopes).

| Path                                                                     | Scope                                                          |
| ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `GET /me/profile`                                                        | `profile`                                                      |
| `PATCH /me/profile`                                                      | `profile:write`                                                |
| `GET` / `POST` / `PATCH` / `DELETE /me/apps[/:id]`                       | `apps:read` / `apps:write`                                     |
| `GET /me/team-apps`                                                      | `apps:read`                                                    |
| `GET` / `POST` / `PATCH` / `DELETE /me/teams[/:id]`                      | `teams:read` / `teams:create` / `teams:write` / `teams:delete` |
| `POST` / `DELETE /me/teams/:id/members`                                  | `teams:write`                                                  |
| `GET` / `POST` / `DELETE /me/domains`, `POST /me/domains/:domain/verify` | `domains:read` / `domains:write`                               |
| `GET` / `POST` / `DELETE /me/gpg-keys`                                   | `gpg:read` / `gpg:write`                                       |
| `GET` / `DELETE /me/social-connections`                                  | `social:read` / `social:write`                                 |
| `GET` / `PATCH` / `DELETE /me/admin/users`                               | `admin:users:read` / `:write` / `:delete`                      |
| `GET` / `PATCH /me/admin/config`                                         | `admin:config:read` / `admin:config:write`                     |
| `GET` / `POST` / `DELETE /me/invites`                                    | `admin:invites:read` / `:create` / `:delete`                   |
| `GET /me/team/:teamId/info`, `PATCH`                                     | `team:<id>:read` / `team:<id>:write`                           |
| `GET` / `POST` / `PATCH` / `DELETE /me/team/:teamId/members[...]`        | `team:<id>:member:read` / `team:<id>:member:write`             |
| `GET /me/team/:teamId/members/:userId/profile`                           | `team:<id>:member:profile:read`                                |

The `/me/team/:teamId/...` paths need a token bound to that team (see
[OAuth → Team scopes](oauth.md#team-scopes)); a `teams:*` token isn't enough.

`POST /me/domains` takes `{ "domain": "example.com" }` and returns `201` with
the domain's `id`, `domain`, `verification_token`, `verified`, and the values
for each verification method: `txt_record` / `txt_value` (DNS TXT),
`http_url` / `http_path` / `http_value` (`.well-known` file) and `meta_tag`
(HTML meta). If the user already has a verified parent domain (for example
`example.com` when adding `app.example.com`), the new domain is verified on
the spot: `verified` is `true` and `verified_by_parent` names that parent.

### `GET /api/oauth/consents` / `DELETE /api/oauth/consents/:client_id`

List the apps the current user has authorized, or revoke one. Revoking removes
the consent and all outstanding tokens for the app.

## Search

### `GET /api/search?q=<text>`

Powers the command palette (Ctrl/⌘ K). Requires a session. Matches names
containing `q` (at least 2 characters) and returns up to 5 results per kind:

```json
{
  "results": [
    {
      "kind": "app",
      "admin": false,
      "id": "…",
      "title": "My app",
      "subtitle": "prism_…",
      "url": "/apps/…"
    }
  ]
}
```

`kind` is `app`, `team`, `domain`, `token`, `consent`, `user` or `oauth_source`.
Admins also get site-wide results (`admin: true`).

## Public profiles

### `GET /api/users/:username`

The user's profile, filtered by what they chose to share. Returns `404` if the
user doesn't exist, is private, or profiles are switched off; the response is the
same in all three cases. See [Public Profiles](public-profile.md).

### `GET /api/public/teams/:id`

The team's profile, with the same `404` rules. Includes `sub_teams` (only those
that are public themselves) and a `parent_team` breadcrumb when the parent is
public.

## Avatar proxy

Remote avatar and icon images are served through Prism so pages don't load
third-party images directly.

- `POST /api/proxy/image/register` (authenticated) registers a remote HTTPS image
  URL and returns `{ "id": "...", "url": "/api/proxy/image/<id>" }`. Private and
  reserved addresses are rejected.
- `GET /api/proxy/image/:id` serves the image. It's safe to embed, SVGs are
  sanitized, and images over 5 MiB are refused. Only registered IDs work; it
  isn't an open proxy.

## Admin

All admin endpoints need a user with the admin role. The dashboard uses a
matching `/api/admin/*` endpoint for every admin action; the main ones are:

| Path                                                                                            | Purpose                                                                            |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `GET` / `PATCH /api/admin/config`                                                               | Read or update settings. Secrets are redacted and encrypted on write               |
| `GET /api/admin/stats`                                                                          | Totals                                                                             |
| `GET /api/admin/users`, `GET` / `PATCH` / `DELETE /api/admin/users/:id`                         | List, read, update (role, active, email, per-user token lifetimes) or delete users |
| `DELETE /api/admin/users/:id/sessions`                                                          | Revoke all of a user's sessions                                                    |
| `POST /api/admin/users/bulk`                                                                    | `{ user_ids, action }` — `activate`, `deactivate` or `delete`; up to 50            |
| `GET` / `PATCH /api/admin/apps[/:id]`                                                           | Verify or deactivate apps                                                          |
| `POST /api/admin/apps/:id/transfer`                                                             | `{ owner_id }` or `{ team_id }`                                                    |
| `GET` / `POST` / `PATCH` / `DELETE /api/admin/oauth-sources[/:id]`                              | Manage OAuth sources                                                               |
| `GET /api/admin/oauth-sources/discover`                                                         | Fetch OIDC discovery for an issuer                                                 |
| `GET` / `POST` / `DELETE /api/admin/invites[/:id]`                                              | Site invites                                                                       |
| `GET /api/admin/teams`, `DELETE /api/admin/teams/:id`                                           | List or disband teams                                                              |
| `GET /api/admin/domains`, `POST /api/admin/domains/:id/verify`, `DELETE /api/admin/domains/:id` | Domains, including force-verify                                                    |
| `GET /api/admin/audit-log`                                                                      | Platform audit log                                                                 |
| `GET /api/audit/:scope/export`                                                                  | Export an audit log you can read: `?format=csv\|json`, up to 10,000 events         |
| `GET /api/admin/login-errors`                                                                   | Failed sign-ins                                                                    |
| `POST /api/admin/test-email`                                                                    | Send a test email                                                                  |
| `GET /api/notices`, `POST /api/notices/:id/dismiss`                                             | Notices for the current viewer (public notices work signed out)                    |

The Database console, key–value browser, secrets migrations, notices editor,
scope grants and other maintenance tools are driven by the admin panel; see the
[Admin Guide](admin.md).

## Health

### `GET /api/health`

Returns `{ "ok": true }`. No authentication.
