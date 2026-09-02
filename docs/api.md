---
title: API Reference
description: REST API for Prism — auth, OAuth, apps, teams, domains, GPG, public profiles, and admin endpoints.
---

# API Reference

Base path: `/api`

All endpoints return JSON. The web UI authenticates with the
`__Host-prism_session` cookie, which is `Secure`, `HttpOnly`, and never exposed
to browser JavaScript. API integrations should use an OAuth access token from
the standard authorization code flow or a personal access token prefixed
`prism_pat_`; OAuth-token endpoints are usually exposed under `/api/oauth/me/*`.

CORS is locked to `APP_URL` for `/api/*`. The `/api/proxy/image/*`,
`/.well-known/*`, and `/api/users/:username` (public profile) endpoints are
served without `Access-Control-Allow-Credentials` so they're safely embeddable.

## Init

### `GET /api/init/status`

Returns whether the instance has been set up.

**Response** — `{ "initialized": false }`

### `POST /api/init`

Creates the first admin account. Only works when `initialized = false`.

```json
{
  "email": "admin@example.com",
  "username": "admin",
  "password": "s3cur3",
  "display_name": "Admin",
  "site_name": "My Prism"
}
```

**Response** — `{ "user": { ... } }`. The new session is set only in the
HttpOnly cookie.

## Site

### `GET /api/site`

Public site configuration for the frontend. No authentication required. The
endpoint reads only fields safe to expose; secrets are never included.

```json
{
  "site_name": "Prism",
  "site_description": "...",
  "site_icon_url": null,
  "allow_registration": true,
  "invite_only": false,
  "captcha_provider": "none",
  "captcha_site_key": "",
  "pow_difficulty": 20,
  "accent_color": "#0078d4",
  "custom_css": "",
  "initialized": true,
  "require_email_verification": false,
  "email_verify_methods": "both",
  "enable_public_profiles": true,
  "disable_user_create_team": false,
  "disable_user_create_app": false,
  "enable_sub_teams": true,
  "max_team_depth": 5,
  "inherit_team_membership": true,
  "inherit_team_domains": true,
  "default_team_profile_show_sub_teams": true,
  "enabled_sources": [
    { "slug": "github", "provider": "github", "name": "GitHub" },
    { "slug": "google", "provider": "google", "name": "Google" }
  ]
}
```

## Auth

### `POST /api/auth/register`

```json
{
  "email": "user@example.com",
  "username": "alice",
  "password": "hunter2",
  "display_name": "Alice",
  "captcha_token": "...",
  "pow_challenge": "...",
  "pow_nonce": 12345,
  "invite_token": "..."
}
```

Include whichever bot-protection fields match the active captcha provider.
`invite_token` is required when the site is in invite-only mode.

**Response** — `{ "user": { ... } }` when registration also signs the user
in. The session credential is set only in the HttpOnly cookie.

### `POST /api/auth/login`

```json
{
  "identifier": "alice",
  "password": "hunter2",
  "totp_code": "123456",
  "captcha_token": "..."
}
```

`identifier` accepts username, primary email, or any verified secondary email
(when `allow_alt_email_login` is true). `totp_code` is required only if TOTP
is enrolled — for passkey authenticators, use the dedicated passkey endpoints.

**Response** — `{ "user": { ... } }`. The session credential is set only in
the HttpOnly cookie and is not returned in JSON.

If TOTP is enrolled but no code was provided:

```json
{ "totp_required": true, "available_methods": ["totp", "passkey", "backup"] }
```

### `POST /api/auth/logout`

Revokes the current session. Requires auth.

Prism intentionally supports one browser session at a time. Switching accounts
requires signing out and authenticating again; session JWTs are never retained
in Web Storage for background accounts.

### `GET /api/auth/verify-email?token=<token>`

Verifies an email using the token sent by email.

### `POST /api/auth/email-verify-code`

Returns a verification address the user can send an email to. Format:
`verify-<code>@<domain>` (Cloudflare Email Workers) or the configured IMAP
mailbox with the code as the subject. Requires auth.

```json
{ "address": "verify-abc123@example.com", "code": "abc123" }
```

### `POST /api/auth/check-email-verification`

Long-poll-friendly: returns `{ "verified": boolean }` for the user's primary
email. Useful while the user is sending the verify-by-email message.

### `POST /api/auth/resend-verify-email`

Re-sends the verification link. Requires auth. Accepts optional captcha fields.

### `GET /api/auth/pow-challenge`

Returns a PoW challenge for the proof-of-work provider.

```json
{ "challenge": "...", "difficulty": 20, "expires_at": 1741568400 }
```

## TOTP (multiple authenticators)

All endpoints require authentication.

### `GET /api/auth/totp/list`

Lists the user's enrolled TOTP authenticators.

### `POST /api/auth/totp/setup`

Generates a new TOTP secret. Returns the secret and `otpauth://` URI for QR
codes. Pass `name` to label the new authenticator (e.g. `"Pixel 9"`).

```json
{ "name": "Pixel 9", "secret": "...", "uri": "otpauth://totp/..." }
```

### `POST /api/auth/totp/verify`

Confirms TOTP setup by verifying the first code. Returns backup codes the first
time any authenticator is enrolled.

### `DELETE /api/auth/totp/:id`

Removes a single authenticator by ID. Requires either a current TOTP code, a
backup code, or a passkey verification — the dialog in **Profile → Security**
walks the user through whichever the account has enrolled.

### `POST /api/auth/totp/backup-codes`

Regenerates backup codes. Requires a valid TOTP code.

## Passkeys (WebAuthn)

### `POST /api/auth/passkey/register/begin` / `/finish`

Adds a passkey for the authenticated user.

### `POST /api/auth/passkey/auth/begin` / `/finish`

Sign-in with a passkey. Pass `username` to begin to scope the allowed
credentials, or omit it for discoverable credentials.

### `POST /api/auth/passkey/verify/begin` / `/finish`

Authenticated re-verification with a passkey — used by step-up confirmation
flows (e.g. removing the last TOTP authenticator).

### `GET /api/auth/passkeys`

Lists the authenticated user's registered passkeys.

### `DELETE /api/auth/passkeys/:id`

Removes a passkey.

## GPG keys

### `POST /api/auth/gpg-challenge`

Request a sign-in challenge. Rate-limited to 30 req/min per IP.

```json
{ "identifier": "alice" }
```

**Response** — `{ "challenge": "...", "text": "Prism login\n..." }`

The `gpg_challenge_prefix` config is inserted between the site header and the
random challenge so users can verify the text they're signing belongs to your
site.

### `POST /api/auth/gpg-login`

Submit a `gpg --clearsign`-ed challenge. Rate-limited to 10 req/min per IP. The
challenge is single-use and expires after 5 minutes.

```json
{
  "identifier": "alice",
  "signed_message": "-----BEGIN PGP SIGNED MESSAGE-----\n..."
}
```

**Response** — `{ "user": { ... } }`; the session is set only in the HttpOnly
cookie.

### `GET /api/user/gpg` / `POST /api/user/gpg` / `DELETE /api/user/gpg/:id`

Session-auth GPG key management. `POST` accepts ASCII-armored or binary
`public_key` plus optional `name`; classical RSA/EdDSA and ML-DSA keys are
both supported.

### `GET /users/:username.gpg`

Public, federated lookup. Returns the user's registered GPG keys as ASCII
armor blocks separated by blank lines, with `Content-Type: application/pgp-keys`.

### OAuth-scoped GPG endpoints

| Method   | Path                         | Scope required |
| -------- | ---------------------------- | -------------- |
| `GET`    | `/api/oauth/me/gpg-keys`     | `gpg:read`     |
| `POST`   | `/api/oauth/me/gpg-keys`     | `gpg:write`    |
| `DELETE` | `/api/oauth/me/gpg-keys/:id` | `gpg:write`    |

Request/response shapes match the session-auth equivalents.

## Sessions

### `GET /api/auth/sessions`

List the authenticated user's active (non-expired) sessions. Expired rows are
excluded and swept by a cron task, so this only ever returns live sessions.

Each session includes the IP it was created from plus `ip_geo`: a JSON string
holding the full Cloudflare geolocation for that IP (continent, country,
region, city, postalCode, latitude/longitude, timezone, colo, asn, org, …),
or `null` when unavailable (e.g. local development).

### `GET /api/auth/sessions/:id/ips`

Every distinct IP the given session has authenticated from, most recent first.
Each entry carries the IP, its `geo` (the same full Cloudflare geolocation JSON
string), and `first_seen` / `last_seen` timestamps. 404 if the session does not
belong to the caller.

### `DELETE /api/auth/sessions/:id`

Revoke a single session by id.

### `DELETE /api/auth/sessions`

Revoke every session **except** the current one ("sign out everywhere else").
Returns `{ "revoked": <count> }`.

## User

All endpoints require authentication.

### `GET /api/user/me` / `PATCH /api/user/me`

Read and partial-update the current user (display name, avatar, profile
visibility flags, notification preferences). Some sub-resources have dedicated
endpoints below.

### `POST /api/user/me/change-password`

```json
{ "current_password": "...", "new_password": "..." }
```

### `POST /api/user/me/avatar`

`multipart/form-data` with field `avatar`. Max 2 MB. Accepted types: JPEG,
PNG, WebP, GIF. Stored in R2 (when bound) or inline in D1.

### `POST /api/user/me/readme` / `POST /api/user/me/readme/sync`

Manually save a markdown README, or sync it from the user's GitHub user-repo
README (`github.com/<login>/<login>`). The sync endpoint respects the
`github_readme_cache_ttl_seconds` cache and `github_readme_token` PAT.

### `GET /api/user/me/emails` / `POST` / `DELETE /api/user/me/emails/:id`

Manage secondary emails. `POST /:id/resend` re-sends the verification link;
`POST /:id/set-primary` swaps the primary email after verification.

### `GET /api/user/me/notifications` / `PUT`

Read or replace the user's notification preferences (events × delivery
channel × `brief|full` level). See [Notifications](notifications.md).

### `GET /api/user/me/notification-rulesets` / `POST` / `PUT /:id` / `DELETE /:id`

Named rulesets — ordered match/action rules with optional account-key
filtering and `stop` semantics. Same data shape, more expressive than the
flat preferences map. See [Notifications](notifications.md).

### `GET /api/user/tokens` / `POST` / `DELETE /:id`

Personal access tokens. The full plaintext is shown only in the create
response. `GET` accepts `?page=`, `?limit=`, `?q=` name search and returns
`total`. See [Personal Access Tokens](personal-access-tokens.md).

### `DELETE /api/user/me`

Deletes the account permanently. `{ "password": "...", "confirm": "DELETE" }`.

## OAuth Apps

All endpoints require authentication. See [OAuth / OIDC Guide](oauth.md) and
[Cross-App Permissions](app-permissions.md) for the full integration story.

| Method                              | Path                                         | Notes                                                                                                                |
| ----------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET`                               | `/api/apps`                                  | List apps owned by the current user. `?page=`, `?limit=`, `?q=` name search, returns `total`                         |
| `POST`                              | `/api/apps`                                  | Create app                                                                                                           |
| `GET`                               | `/api/apps/:id`                              | Read app                                                                                                             |
| `PATCH`                             | `/api/apps/:id`                              | Update fields including `oidc_fields`, `optional_scopes`, `use_jwt_tokens`, `allow_self_manage_exported_permissions` |
| `POST`                              | `/api/apps/:id/rotate-secret`                | Rotate `client_secret`                                                                                               |
| `DELETE`                            | `/api/apps/:id`                              | Delete app                                                                                                           |
| `GET`                               | `/api/apps/:id/scope-definitions`            | List exported scopes                                                                                                 |
| `POST` / `PATCH` / `DELETE`         | `/api/apps/:id/scope-definitions[/:scope]`   | Manage exported scopes (HTTP Basic from the app itself works when `allow_self_manage_exported_permissions` is on)    |
| `GET` / `POST` / `DELETE`           | `/api/apps/:id/scope-access-rules[/:ruleId]` | Owner-allow / owner-deny / app-allow / app-deny rules                                                                |
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/apps/:appId/webhooks[/:id]`            | App notification webhooks; see [App Notifications](app-notifications.md)                                             |

OAuth app secrets are write-only. `POST /api/apps`, `POST
/api/teams/:id/apps`, and `POST /api/apps/:id/rotate-secret` return the freshly
generated plaintext only in that response. List, read, update, and admin-list
responses never return the stored value; app representations expose
`has_client_secret` instead. Creating or rotating a team-owned app requires an
effective team `admin` role or stronger.

App-event streaming (SSE / WebSocket) is also under `/api/apps/:appId/events/*`
— see [App Notifications](app-notifications.md).

## Teams

See [Teams](teams.md) for the full guide. Endpoint summary:

| Method                    | Path                                                 | Notes                                                                                                                                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`                     | `/api/teams`                                         | List teams the user can reach (direct + inherited via sub-team nesting; each entry carries `parent_team_id` + `inherited_from`)                                                                                                                                       |
| `POST`                    | `/api/teams`                                         | Create team. Optional `parent_team_id` makes it a sub-team — caller must be admin+ (direct or inherited) of the parent, depth ≤ `max_team_depth`. Site admins may pass `owner_username` / `owner_id` to hand the team to someone else                                 |
| `GET`                     | `/api/teams/:id`                                     | Team details + `my_role` (effective), `inherited_from`, `ancestors[]` (parent → root), `sub_teams[]` (immediate children with member counts), direct members                                                                                                          |
| `PATCH`                   | `/api/teams/:id`                                     | Update name, description, avatar, public-profile flags (incl. `profile_show_sub_teams`), `parent_team_id` (owner-only, cycle/depth-checked), `require_2fa`, `require_verified_email`, `enable_groups` (owner-only), `role_permissions` (owner-only)                   |
| `DELETE`                  | `/api/teams/:id`                                     | Disband (owner — direct or inherited). Cascades to every sub-team; each level's apps fall back to that level's own owner                                                                                                                                              |
| `GET`                     | `/api/teams/:id/sub-teams`                           | List immediate sub-teams. `?page=`, `?limit=`, `?q=`, returns `total`. Members of an ancestor team (direct or inherited) may list                                                                                                                                     |
| `POST`                    | `/api/teams/:id/sub-teams`                           | Create a sub-team under `:id` — convenience alias for `POST /api/teams` with `parent_team_id`                                                                                                                                                                         |
| `GET`                     | `/api/teams/:id/members`                             | Paginated member list. `?page=`, `?limit=` (max 100), `?q=` (display name / username), `?group=` (slug, matches inherited labels too)                                                                                                                                 |
| `POST`                    | `/api/teams/:id/members`                             | Add member by `username` or `user_id` (admins+). A site admin overrides the team's join requirements and the restricted-account scope rule; the audit entry lists what was `bypassed`                                                                                 |
| `PATCH`                   | `/api/teams/:id/members/:userId`                     | Change role. Site admins may also set `owner` (transfers ownership, demoting the sitting owner to co-owner) and may demote the owner outright, which leaves the team ownerless — the response and audit entry both carry `owner_vacated`                              |
| `DELETE`                  | `/api/teams/:id/members/:userId`                     | Remove member (or leave the team if `:userId = self`). A site admin may remove the owner — the most senior remaining member is promoted in the same batch (`new_owner_id`), or the team is left empty and ownerless (`owner_vacated`) when there is nobody to promote |
| `PATCH`                   | `/api/teams/:id/membership/show-on-profile`          | Per-member opt-in to appear in the team's public member list                                                                                                                                                                                                          |
| `GET`                     | `/api/teams/:id/groups`                              | List [member group](teams.md#member-groups) definitions plus the resolved admin capabilities (any member)                                                                                                                                                             |
| `POST`                    | `/api/teams/:id/groups`                              | Create a group. Requires the `groups:manage` capability; `admin_assignable` is owner-only                                                                                                                                                                             |
| `PATCH`                   | `/api/teams/:id/groups/:groupId`                     | Update name/description/colour. `slug` is immutable; `admin_assignable` is owner-only                                                                                                                                                                                 |
| `DELETE`                  | `/api/teams/:id/groups/:groupId`                     | Delete a group — cascades to every assignment                                                                                                                                                                                                                         |
| `PUT`                     | `/api/teams/:id/members/:userId/groups`              | Replace a member's group set (`{ group_ids: [...] }`). Only the groups that change are permission-checked                                                                                                                                                             |
| `POST`                    | `/api/teams/:id/transfer-ownership`                  | Transfer ownership to another member. Site admins can call this from outside the team, and may name someone who isn't a member yet                                                                                                                                    |
| `GET`                     | `/api/teams/:id/invites`                             | List active invite tokens. `?page=`, `?limit=`, `?q=` email search, returns `total`                                                                                                                                                                                   |
| `POST`                    | `/api/teams/:id/invites`                             | Mint an invite token (optional email lock + max uses + expiry)                                                                                                                                                                                                        |
| `DELETE`                  | `/api/teams/:id/invites/:token`                      | Revoke an invite                                                                                                                                                                                                                                                      |
| `GET`                     | `/api/teams/join/:token` (auth optional)             | Inspect an invite — returns the team, requirements, unmet flags                                                                                                                                                                                                       |
| `POST`                    | `/api/teams/join/:token`                             | Accept an invite                                                                                                                                                                                                                                                      |
| `GET` / `POST` / `DELETE` | `/api/teams/:id/domains[/:domainId]`                 | Team-owned domains. `?page=`, `?limit=`, `?q=`, returns `total`. `GET` also returns ancestor-owned domains as read-only entries tagged `inherited_from` (subject to `inherit_team_domains`)                                                                           |
| `POST`                    | `/api/teams/:id/domains/:domainId/verify`            | Trigger re-verification                                                                                                                                                                                                                                               |
| `POST`                    | `/api/teams/:id/domains/:domainId/to-personal`       | Move a verified domain to the user's personal namespace                                                                                                                                                                                                               |
| `POST`                    | `/api/teams/:id/domains/:domainId/share-to-team`     | Share a personal domain with the team                                                                                                                                                                                                                                 |
| `POST`                    | `/api/teams/:id/domains/:domainId/share-to-personal` | Reverse the above                                                                                                                                                                                                                                                     |
| `GET` / `POST`            | `/api/teams/:id/apps`                                | Team-owned OAuth apps. `?page=`, `?limit=`, `?q=`, returns `total`                                                                                                                                                                                                    |
| `POST`                    | `/api/teams/:id/apps/transfer`                       | Transfer a personal app into the team                                                                                                                                                                                                                                 |
| `DELETE`                  | `/api/teams/:id/apps/:appId/transfer`                | Move a team-owned app back to the original owner                                                                                                                                                                                                                      |

## Invite-link registration

See [Teams → Invite-link registration](teams.md#invite-link-registration) for
the semantics.

| Method  | Path                                       | Notes                                                                                                   |
| ------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `GET`   | `/api/join/:teamId`                        | Unauthenticated. Team branding, effective requirements, captcha config. 404s when the channel is closed |
| `POST`  | `/api/auth/register-with-invite`           | Creates a pending account and returns a session. Claims an invite seat atomically                       |
| `GET`   | `/api/auth/invite-join/status`             | What the pending account still has to satisfy                                                           |
| `POST`  | `/api/auth/invite-join/complete`           | Writes the membership row once requirements are met. Always joins as `member`                           |
| `GET`   | `/api/user/me/restriction`                 | Whether the caller is restricted, its capabilities, and whether it may convert                          |
| `POST`  | `/api/user/me/convert`                     | Lift the restriction. One-way; requires a verified real address                                         |
| `PATCH` | `/api/admin/teams/:id/invite-registration` | Site admin: grant/revoke, and set exemptions (`email_verification` only)                                |
| `POST`  | `/api/admin/teams/:id/dissolve`            | Site admin: stage one — deactivate the team's accounts. Confirm with the team name                      |
| `POST`  | `/api/admin/teams/:id/dissolve/cancel`     | Undo a staged dissolution during the grace period                                                       |
| `GET`   | `/api/admin/restricted-users`              | Accounts produced by `?team_id=` or `?invite_token=` — the query for scoping a leaked link              |

`POST /api/teams/:id/invites` additionally accepts `allows_registration`, which
requires a finite `max_uses` under the site cap and forces the role to `member`.
`PATCH /api/teams/:id` accepts `invite_registration_enabled` (owner-only, and
only once granted) and `allow_normal_user_join`.

## Domains

| Method   | Path                      | Notes                                                                                                               |
| -------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/domains`            | List the current user's domains. `?page=`, `?limit=`, `?q=`, returns `total`                                        |
| `POST`   | `/api/domains`            | Add domain. Returns `verification_method` options + the per-method instructions (DNS TXT, HTML meta, `.well-known`) |
| `POST`   | `/api/domains/:id/verify` | Trigger a re-verification check using the chosen method                                                             |
| `DELETE` | `/api/domains/:id`        | Remove                                                                                                              |

## Social Connections

| Method   | Path                               | Notes                                                                                                                        |
| -------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/connections`                 | List the user's linked accounts                                                                                              |
| `POST`   | `/api/connections/intent`          | Create a five-minute, session-bound pre-flight token for `mode=connect`                                                      |
| `GET`    | `/api/connections/:slug/begin`     | Begin login (`?mode=login`, default) or linking (`?mode=connect`); sets the browser correlation cookie                       |
| `GET`    | `/api/connections/:slug/callback`  | Browser-bound OAuth callback (auto-handled by the provider redirect); connect mode requires the same live initiating session |
| `POST`   | `/api/connections/:slug/tg-verify` | Verify Telegram callback data with the same browser and session binding                                                      |
| `POST`   | `/api/connections/:id/refresh`     | Refresh display name / avatar from the provider                                                                              |
| `DELETE` | `/api/connections/:id`             | Disconnect                                                                                                                   |

Social-login state expires after 10 minutes. The begin endpoint allows 20
attempts per client IP in a five-minute window and returns `429` with
`Retry-After` when exceeded; the bounded global in-flight-state pool returns
`503` if full. For linking, pass the token returned by `/intent` as
`?mode=connect&intent=<token>`; it must match the live session on the begin
request and callback.

OAuth-scoped equivalents:

| Method   | Path                                   | Scope          |
| -------- | -------------------------------------- | -------------- |
| `GET`    | `/api/oauth/me/social-connections`     | `social:read`  |
| `DELETE` | `/api/oauth/me/social-connections/:id` | `social:write` |

## OAuth 2.0 / OIDC

See the [OAuth / OIDC Guide](oauth.md) for the full walkthrough.

| Method               | Path                                      | Notes                                                      |
| -------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| `GET`                | `/api/oauth/authorize`                    | Returns app info + requested scopes for the consent screen |
| `POST`               | `/api/oauth/authorize`                    | Approve / deny                                             |
| `POST`               | `/api/oauth/par`                          | Pushed Authorization Requests (RFC 9126)                   |
| `POST`               | `/api/oauth/register`                     | Dynamic Client Registration (RFC 7591)                     |
| `GET`/`PUT`/`DELETE` | `/api/oauth/register/:client_id`          | Client config management (RFC 7592)                        |
| `POST`               | `/api/oauth/token`                        | code, refresh, device, and token-exchange grants           |
| `POST`               | `/api/oauth/device_authorization`         | Device Authorization Grant (RFC 8628)                      |
| `GET`                | `/api/oauth/device`                       | Device verification-screen data for a `user_code`          |
| `POST`               | `/api/oauth/device/decision`              | Approve / deny a device request (session auth)             |
| `GET` / `POST`       | `/api/oauth/userinfo`                     | OIDC UserInfo (OIDC Core §5.3.1)                           |
| `POST`               | `/api/oauth/introspect`                   | RFC 7662                                                   |
| `POST`               | `/api/oauth/revoke`                       | RFC 7009                                                   |
| `GET` / `POST`       | `/api/oauth/end_session`                  | OIDC RP-Initiated Logout                                   |
| `GET`                | `/.well-known/openid-configuration`       | OpenID Connect Discovery 1.0                               |
| `GET`                | `/.well-known/oauth-authorization-server` | RFC 8414 Authorization Server Metadata                     |
| `GET`                | `/.well-known/oauth-protected-resource`   | RFC 9728 Protected Resource Metadata                       |
| `GET`                | `/.well-known/webfinger`                  | RFC 7033 issuer discovery                                  |
| `GET`                | `/.well-known/jwks.json`                  | RSA public keys for ID token + JWT access tokens           |
| `GET`                | `/.well-known/security.txt`               | RFC 9116 (when a security contact is configured)           |
| `GET`                | `/.well-known/change-password`            | Redirects to the change-password page                      |

### Step-up 2FA

| Method | Path                         | Auth                                                                     |
| ------ | ---------------------------- | ------------------------------------------------------------------------ |
| `POST` | `/api/oauth/2fa/challenges`  | App credentials (HTTP Basic) or PKCE                                     |
| `GET`  | `/api/oauth/2fa/info`        | Optional user session — drives the SPA                                   |
| `POST` | `/api/oauth/2fa/authorize`   | User session — submit TOTP/passkey/backup or sudo bypass                 |
| `POST` | `/api/oauth/2fa/sudo/revoke` | User session — drop a sudo grace window                                  |
| `POST` | `/api/oauth/2fa/verify`      | App credentials — exchange the redirect code for the verification result |

### `/api/oauth/me/*` (token-authenticated user APIs)

These endpoints accept either an OAuth access token from the standard flow or a
PAT. The required scopes are listed in [OAuth → Scopes](oauth.md#scopes) and
[Admin → OAuth Scope Reference](admin.md#oauth-scope-reference).

| Path                                                                            | Scope                                                                                                                                                                                        |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /me/profile`                                                               | `profile`                                                                                                                                                                                    |
| `PATCH /me/profile`                                                             | `profile:write`                                                                                                                                                                              |
| `GET /me/apps` / `POST /me/apps` / `PATCH /me/apps/:id` / `DELETE /me/apps/:id` | `apps:read` / `apps:write`                                                                                                                                                                   |
| `GET /me/team-apps`                                                             | `apps:read`                                                                                                                                                                                  |
| `GET /me/teams` / `POST` / `PATCH /me/teams/:id` / `DELETE`                     | `teams:read` / `teams:write` / `teams:create` / `teams:delete` — listing includes inherited sub-teams (`inherited_from`). Effective-role auth (inherited admin/owner counts) on PATCH/DELETE |
| `POST /me/teams/:id/members` / `DELETE`                                         | `teams:write` — effective-role auth (inherited admin/owner counts)                                                                                                                           |
| `GET /me/domains` / `POST` / `POST :domain/verify` / `DELETE`                   | `domains:read` / `domains:write`                                                                                                                                                             |
| `GET /me/gpg-keys` / `POST` / `DELETE`                                          | `gpg:read` / `gpg:write`                                                                                                                                                                     |
| `GET /me/social-connections` / `DELETE`                                         | `social:read` / `social:write`                                                                                                                                                               |
| `GET /me/admin/users` / `PATCH` / `DELETE`                                      | `admin:users:read` / `admin:users:write` / `admin:users:delete`                                                                                                                              |
| `GET /me/admin/config` / `PATCH`                                                | `admin:config:read` / `admin:config:write`                                                                                                                                                   |
| `POST /me/invites` / `GET` / `DELETE`                                           | `admin:invites:create` / `admin:invites:read` / `admin:invites:delete`                                                                                                                       |
| `GET /me/site/users[/:id]`                                                      | `admin:users:read`                                                                                                                                                                           |
| `GET /me/team/:teamId/info` / `PATCH`                                           | `teams:read` / `teams:write`                                                                                                                                                                 |
| `GET /me/team/:teamId/members` / `POST` / `DELETE` / `PATCH …/role`             | `teams:read` / `teams:write`                                                                                                                                                                 |
| `GET /me/team/:teamId/members/:userId/profile`                                  | `teams:read`                                                                                                                                                                                 |

### `GET /api/oauth/consents` / `DELETE /api/oauth/consents/:client_id`

Manage which apps the current user has authorized. `DELETE` revokes the consent
and all outstanding tokens for that app. `GET` accepts `?page=`, `?limit=`,
`?q=` app-name search and returns `total`.

## Public profiles

### `GET /api/users/:username`

Returns the user profile filtered by visibility flags, or `404` if the username
is unknown, private, or `enable_public_profiles` is off. The 404 body is
identical for all three to avoid leaking which usernames exist. Accepts an
optional Bearer — a token belonging to the profile's owner returns the data
even when private. See [Public Profiles](public-profile.md).

### `GET /api/public/teams/:id`

Returns the team profile. Same 404 semantics. A token from any _member_ of the
team returns the data even when private.

When sub-teams are enabled and the team owner opted into the section
(`profile_show_sub_teams`, or the site default
`default_team_profile_show_sub_teams`), the response includes a
`sub_teams[]` array with only those children that have themselves opted
into a public profile — privacy-preserving (a private sub-team's name
isn't leaked just because the parent is public). If the team's parent is
itself public, the response also includes a `parent_team` breadcrumb
`{id, name, avatar_url}`.

## Image proxy

### `GET /api/proxy/image/:id`

Streams an image registered in `image_proxy_mappings`. SVG bodies are
sanitized. `:id` is the opaque ID returned by `POST /api/proxy/image/register`
(authenticated) — there is no URL passthrough, so the proxy cannot be used as
an open SSRF relay. Before every upstream request and redirect, Prism rejects
local/reserved IPv4 and IPv6 literals and DNS names whose A or AAAA answers are
not public unicast addresses. Cross-origin headers are set so the response is
safely embeddable.

### `POST /api/proxy/image/register`

Register a new mapping for a remote HTTPS image URL the SPA needs to load
(markdown preview, ImageUrlInput preview). Requires auth. Local and reserved IP
literals are rejected during registration; DNS is checked immediately before
the registered URL is fetched. Returns
`{ "id": "...", "url": "/api/proxy/image/<id>" }`.

## Admin

All admin endpoints require auth with `role = admin`.

### Config

| Method  | Path                | Notes                                                                                  |
| ------- | ------------------- | -------------------------------------------------------------------------------------- |
| `GET`   | `/api/admin/config` | All config keys (sensitive values redacted)                                            |
| `PATCH` | `/api/admin/config` | Update one or more keys; sensitive keys are auto-encrypted with `SECRETS_KEY` if bound |

### Stats / dashboard

`GET /api/admin/stats` → `{ users, apps, verified_domains, active_tokens }`.

### Users

| Method   | Path                               | Notes                                                         |
| -------- | ---------------------------------- | ------------------------------------------------------------- |
| `GET`    | `/api/admin/users?page=…&search=…` | Paginated user list                                           |
| `GET`    | `/api/admin/users/:id`             | Detail (sessions, apps, connections)                          |
| `PATCH`  | `/api/admin/users/:id`             | `role`, `is_active`, `email_verified`, per-user TTL overrides |
| `DELETE` | `/api/admin/users/:id`             | Permanently delete                                            |
| `DELETE` | `/api/admin/users/:id/sessions`    | Revoke all sessions                                           |

### Apps / OAuth Sources / Invites / Webhooks / Teams

| Path                                                         | Notes                                                                                           |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `GET / PATCH /api/admin/apps[/:id]`                          | Verify or deactivate                                                                            |
| `GET / POST / PATCH / DELETE /api/admin/oauth-sources[/:id]` | Source CRUD. `GET` accepts `?page=`, `?limit=`, `?q=` name/slug search, returns `total`         |
| `GET /api/admin/oauth-sources/discover`                      | Auto-fetch OIDC discovery for a candidate issuer                                                |
| `POST /api/admin/oauth-sources/migrate`                      | One-time: import the legacy site_config social keys                                             |
| `GET / POST / DELETE /api/admin/invites[/:id]`               | Site-invite tokens. `GET` accepts `?page=`, `?limit=`, `?q=` email/note search, returns `total` |
| `GET /api/admin/teams` / `DELETE /:id`                       | List / disband teams                                                                            |
| `POST /api/admin/test-email`                                 | Send a test outbound email                                                                      |
| `POST /api/admin/test-email-receiving`                       | Generate a test verify-by-email code                                                            |

### Per-account control

The `/api/user/me/*` surface, addressed by user id. Every call is admin-only,
session-only, and audited into **both** the platform log and the target's own
user-scope log (marked `site_admin: true`). See
[Admin → The account detail page](admin.md#the-account-detail-page).

| Method           | Path                                               | Notes                                                                                                                                                                                               |
| ---------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PATCH`          | `/api/admin/users/:id`                             | Now also accepts `username`, `email`, `display_name`, `avatar_url`. Changing `email` clears its verified state unless `email_verified` is sent in the same request. `409` on a taken username/email |
| `POST`           | `/api/admin/users/:id/password`                    | `{ password, revoke_sessions? }`. `password: null` clears it — refused when no linked provider remains                                                                                              |
| `GET`            | `/api/admin/users/:id/security`                    | Authenticators, passkeys, recovery-code count, whether a password is set                                                                                                                            |
| `DELETE`         | `/api/admin/users/:id/2fa`                         | Remove every factor and recovery code — the account-recovery button                                                                                                                                 |
| `DELETE`         | `/api/admin/users/:id/totp/:totpId`                | Remove one authenticator                                                                                                                                                                            |
| `DELETE`         | `/api/admin/users/:id/passkeys/:passkeyId`         | Remove one passkey                                                                                                                                                                                  |
| `GET` / `DELETE` | `/api/admin/users/:id/tokens[/:tokenId]`           | Personal access tokens. The token value is never returned                                                                                                                                           |
| `GET` / `DELETE` | `/api/admin/users/:id/connections[/:connId]`       | Linked providers. Unlinking the last sign-in method is refused                                                                                                                                      |
| `GET` / `DELETE` | `/api/admin/users/:id/gpg-keys[/:keyId]`           | GPG keys                                                                                                                                                                                            |
| `GET`            | `/api/admin/users/:id/emails`                      | Primary address plus alternates                                                                                                                                                                     |
| `POST`           | `/api/admin/users/:id/emails/:emailId/verify`      | Mark verified. `:emailId` is `primary` for the address on the users row                                                                                                                             |
| `POST`           | `/api/admin/users/:id/emails/:emailId/set-primary` | Promote an alternate, demoting the current primary into the alternates list                                                                                                                         |
| `DELETE`         | `/api/admin/users/:id/emails/:emailId`             | Remove an alternate                                                                                                                                                                                 |
| `GET` / `DELETE` | `/api/admin/users/:id/domains[/:domainId]`         | The account's personal domains                                                                                                                                                                      |
| `GET` / `DELETE` | `/api/admin/users/:id/authorizations[/:consentId]` | OAuth grants. Revoking also deletes the tokens and codes issued under the grant                                                                                                                     |
| `GET`            | `/api/admin/users/:id/teams`                       | Team memberships (read-only — change them on the team)                                                                                                                                              |
| `GET`            | `/api/admin/users/:id/lockdown`                    | Whether `LOCKDOWN_USERS` protects this account from deletion                                                                                                                                        |

### Key–value browser

Same gating as the database console, via `KV_CONSOLE` (which follows
`D1_CONSOLE` when unset). See [Admin → Key–value browser](admin.md#keyvalue-browser).

| Method   | Path                              | Notes                                                                                      |
| -------- | --------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET`    | `/api/admin/kv/status`            | Mode, writability, available namespaces                                                    |
| `GET`    | `/api/admin/kv/:ns/keys`          | List keys. `?prefix=`, `?cursor=`, `?limit=` (max 1000). Returns KV's opaque `cursor`      |
| `GET`    | `/api/admin/kv/:ns/keys/:key`     | Read one value (key URL-encoded). Key material returns `protected: true` and `value: null` |
| `PUT`    | `/api/admin/kv/:ns/keys/:key`     | Write. `{ value, expiration_ttl? }`; TTL floor is 60s. Refused for key material            |
| `DELETE` | `/api/admin/kv/:ns/keys/:key`     | Delete. Allowed for key material — that is rotation                                        |
| `POST`   | `/api/admin/kv/:ns/purge?prefix=` | Delete every key under a prefix, one page per call. Skips key material                     |

`:ns` is `sessions` or `cache`.

### Instance-wide operations

| Method   | Path                                         | Notes                                                                                                                                                                  |
| -------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/admin/revoke/preview`                  | What a mass revocation would destroy, without destroying it                                                                                                            |
| `POST`   | `/api/admin/revoke/sessions`                 | Delete every session. `{ include_self? }` — the caller's is kept by default                                                                                            |
| `POST`   | `/api/admin/revoke/app/:appId`               | Delete an app's tokens, codes and consents. `{ deactivate? }`                                                                                                          |
| `POST`   | `/api/admin/revoke/user/:userId/grants`      | The same for one account across every application                                                                                                                      |
| `GET`    | `/api/admin/domains`                         | Every domain. `?page=`, `?limit=`, `?q=`, `?verified=0\|1`                                                                                                             |
| `POST`   | `/api/admin/domains/:id/verify`              | `{ verified }` — an override, logged as `admin_override` rather than a check                                                                                           |
| `DELETE` | `/api/admin/domains/:id`                     | Delete a domain                                                                                                                                                        |
| `POST`   | `/api/admin/apps/:id/transfer`               | `{ owner_id }` or `{ team_id }`. Client ID and secret unchanged                                                                                                        |
| `POST`   | `/api/admin/users/:id/convert`               | Lift an invite-registration restriction. `{ require_verified_email? }`                                                                                                 |
| `GET`    | `/api/admin/scope-grants/site`               | Elevated site-level OAuth grants                                                                                                                                       |
| `GET`    | `/api/admin/scope-grants/team`               | Team-level grants. `?team_id=` filters                                                                                                                                 |
| `DELETE` | `/api/admin/scope-grants/:kind/:id`          | Withdraw one grant (`:kind` is `site` or `team`). Existing tokens are untouched — revoke the app for those                                                             |
| `GET`    | `/api/admin/users/:id/sessions`              | Live sessions with the IP/geo history behind each                                                                                                                      |
| `DELETE` | `/api/admin/users/:id/sessions/:sessionId`   | End one session (`DELETE …/sessions` still ends all)                                                                                                                   |
| `GET`    | `/api/admin/maintenance/jobs`                | The runnable scheduled jobs, and the cron they normally run on                                                                                                         |
| `POST`   | `/api/admin/maintenance/jobs/:key/run`       | Run one now. Awaited — returns `processed` (or `null` where the task keeps no count) and `duration_ms`                                                                 |
| `POST`   | `/api/admin/users/bulk`                      | `{ user_ids, action }` where action is `activate` \| `deactivate` \| `delete`. Max 50 ids; the caller and `LOCKDOWN_USERS` accounts are skipped and named in `skipped` |
| `GET`    | `/api/admin/team-invites`                    | Every outstanding team invite. `?page=`, `?limit=`, `?q=` team/email, `?registration=1`                                                                                |
| `DELETE` | `/api/admin/team-invites/:token`             | Revoke one invite link                                                                                                                                                 |
| `GET`    | `/api/admin/users/:id/notifications`         | Ruleset names, active flag and rule counts — not their contents                                                                                                        |
| `DELETE` | `/api/admin/users/:id/notification-rulesets` | Reset routing to the per-event defaults                                                                                                                                |

### Notice board

Reading takes optional auth — public notices exist for people who cannot sign
in. Writing is admin-only. See [Admin → Notice board](admin.md#notice-board).

| Method   | Path                       | Notes                                                                                                                                                     |
| -------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/notices`             | Notices for the current viewer: published, in window, matching their audience, not already dismissed. Signed out returns the `public` ones                |
| `POST`   | `/api/notices/:id/dismiss` | Dismiss for the calling user. 401 signed out, 403 when the notice is not dismissible                                                                      |
| `GET`    | `/api/admin/notices`       | Every notice, drafts included, with dismissal counts                                                                                                      |
| `POST`   | `/api/admin/notices`       | Create. `{ title, body, level?, audience?, team_id?, is_published?, starts_at?, ends_at?, is_dismissible?, pinned? }` — a draft unless `is_published`     |
| `PATCH`  | `/api/admin/notices/:id`   | Update. Validated against the merged row, so moving one bound still checks the other. `{ reset_dismissals: true }` brings it back for everyone who hid it |
| `DELETE` | `/api/admin/notices/:id`   | Delete, cascading to dismissals. Unpublish instead to keep it as a draft                                                                                  |

### Database

Direct D1 access. Admin-only, session-only, and every call is audited.
**Off unless `D1_CONSOLE` is set** — every endpoint below 404s by default.
See [Admin → Database](admin.md#database).

| Method   | Path                               | Notes                                                                                                                                                         |
| -------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/admin/db/status`             | Mode, writability, and the `append_only` table list. Answers even when the console is off, so the UI can decide whether to render the tab                     |
| `GET`    | `/api/admin/db/tables`             | Every table with row counts, columns and its `CREATE TABLE` statement                                                                                         |
| `GET`    | `/api/admin/db/tables/:table/rows` | Page rows. `?page=`, `?limit=` (max 500), `?order_by=`, `?dir=`, `?where=` raw SQL fragment                                                                   |
| `POST`   | `/api/admin/db/tables/:table/rows` | Insert. Body `{ values }` — unknown columns are dropped                                                                                                       |
| `PATCH`  | `/api/admin/db/tables/:table/rows` | Update one row. Body `{ key, values }`, keyed on the primary key or `rowid`                                                                                   |
| `DELETE` | `/api/admin/db/tables/:table/rows` | Delete one row. Body `{ key }`                                                                                                                                |
| `POST`   | `/api/admin/db/query`              | Run SQL. Body `{ sql, params?, allow_write? }`. Anything that isn't a plain read is refused without `allow_write`; multiple statements run in one transaction |

Writes to `audit_events`, `audit_log` and `sqlite_master` are refused with
`403 { append_only: true }` at every setting, on both the row endpoints and
the console — reads are unaffected. See
[Admin → The audit log is append-only here](admin.md#the-audit-log-is-append-only-here).

### Audit / request logs / login errors

| Method   | Path                                  | Notes                                                                                                       |
| -------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/admin/audit-log?page=…`         | Audit events                                                                                                |
| `GET`    | `/api/audit/:scope/export`            | Export any scope the caller can read. `?format=csv\|json` plus the table's filters. Capped at 10,000 events |
| `GET`    | `/api/admin/login-errors`             | Failed-login table                                                                                          |
| `GET`    | `/api/admin/request-logs`             | Filterable per-request log                                                                                  |
| `GET`    | `/api/admin/request-logs/export`      | CSV export of the current filter                                                                            |
| `GET`    | `/api/admin/request-logs/:id/details` | Single request detail                                                                                       |
| `DELETE` | `/api/admin/request-logs`             | Purge all                                                                                                   |
| `DELETE` | `/api/admin/request-logs/spectate`    | Clear the live spectate buffer                                                                              |

### Secrets migration / Danger Zone

| Method         | Path                                                            | Notes                                                                                   |
| -------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET`          | `/api/admin/secrets/status`                                     | Whether the `SECRETS_KEY` binding is wired and how many config rows are still plaintext |
| `POST`         | `/api/admin/secrets/migrate`                                    | Encrypt remaining site_config / oauth source / oauth app secrets                        |
| `GET`          | `/api/admin/d1-secrets/status`                                  | Same for bearer-style D1 fields                                                         |
| `POST`         | `/api/admin/d1-secrets/migrate`                                 | Hash remaining tokens / codes                                                           |
| `GET / POST`   | `/api/admin/teams-as-users-status` & `/migrate-teams-as-users`  | Backfill `kind = 'team'` user rows for every team                                       |
| `GET / POST`   | `/api/admin/image-proxy-status` & `/migrate-image-proxy`        | Backfill image-proxy mappings for legacy avatars/icons                                  |
| `POST`         | `/api/admin/sweep-image-proxy`                                  | Drop orphan mappings now (also runs on cron)                                            |
| `GET / DELETE` | `/api/admin/image-proxy[/:id]`                                  | Browse / clear proxy entries                                                            |
| `POST`         | `/api/admin/migrate-recovery-codes`                             | Re-hash legacy plaintext backup codes                                                   |
| `GET / POST`   | `/api/admin/reset/status` & `/request` & `/cancel` & `/confirm` | Site-reset workflow (email-signed)                                                      |
| `GET / POST`   | `/api/admin/debug`                                              | Internal toggles for diagnosing deploys                                                 |

## Health

### `GET /api/health`

Always returns `{ "ok": true }`. No authentication.
