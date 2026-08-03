---
title: API Reference
description: REST API for Prism — auth, OAuth, apps, teams, domains, GPG, public profiles, and admin endpoints.
---

# API Reference

Base path: `/api`

All endpoints return JSON. Authenticated endpoints accept either a session JWT
(`Authorization: Bearer <token>`) issued at login, an OAuth access token from
the standard authorization code flow, or a personal access token prefixed
`prism_pat_`. Endpoints that take an OAuth token are usually exposed under
`/api/oauth/me/*`.

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

**Response** — `{ "token": "...", "user": { ... } }`

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

**Response** — `{ "token": "...", "user": { ... } }`

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

**Response** — `{ "token": "...", "user": { ... } }`

If TOTP is enrolled but no code was provided:

```json
{ "totp_required": true, "available_methods": ["totp", "passkey", "backup"] }
```

### `POST /api/auth/logout`

Revokes the current session. Requires auth.

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

**Response** — `{ "token": "...", "user": { ... } }`

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

### `GET /api/auth/sessions` / `DELETE /api/auth/sessions/:id`

List and revoke active sessions for the authenticated user.

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
response. See [Personal Access Tokens](personal-access-tokens.md).

### `DELETE /api/user/me`

Deletes the account permanently. `{ "password": "...", "confirm": "DELETE" }`.

## OAuth Apps

All endpoints require authentication. See [OAuth / OIDC Guide](oauth.md) and
[Cross-App Permissions](app-permissions.md) for the full integration story.

| Method                              | Path                                         | Notes                                                                                                                |
| ----------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET`                               | `/api/apps`                                  | List apps owned by the current user                                                                                  |
| `POST`                              | `/api/apps`                                  | Create app                                                                                                           |
| `GET`                               | `/api/apps/:id`                              | Read app                                                                                                             |
| `PATCH`                             | `/api/apps/:id`                              | Update fields including `oidc_fields`, `optional_scopes`, `use_jwt_tokens`, `allow_self_manage_exported_permissions` |
| `POST`                              | `/api/apps/:id/rotate-secret`                | Rotate `client_secret`                                                                                               |
| `DELETE`                            | `/api/apps/:id`                              | Delete app                                                                                                           |
| `GET`                               | `/api/apps/:id/scope-definitions`            | List exported scopes                                                                                                 |
| `POST` / `PATCH` / `DELETE`         | `/api/apps/:id/scope-definitions[/:scope]`   | Manage exported scopes (HTTP Basic from the app itself works when `allow_self_manage_exported_permissions` is on)    |
| `GET` / `POST` / `DELETE`           | `/api/apps/:id/scope-access-rules[/:ruleId]` | Owner-allow / owner-deny / app-allow / app-deny rules                                                                |
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/apps/:appId/webhooks[/:id]`            | App notification webhooks; see [App Notifications](app-notifications.md)                                             |

App-event streaming (SSE / WebSocket) is also under `/api/apps/:appId/events/*`
— see [App Notifications](app-notifications.md).

## Teams

See [Teams](teams.md) for the full guide. Endpoint summary:

| Method                    | Path                                                 | Notes                                                                                                                                                                                                                                               |
| ------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`                     | `/api/teams`                                         | List teams the user can reach (direct + inherited via sub-team nesting; each entry carries `parent_team_id` + `inherited_from`)                                                                                                                     |
| `POST`                    | `/api/teams`                                         | Create team. Optional `parent_team_id` makes it a sub-team — caller must be admin+ (direct or inherited) of the parent, depth ≤ `max_team_depth`                                                                                                    |
| `GET`                     | `/api/teams/:id`                                     | Team details + `my_role` (effective), `inherited_from`, `ancestors[]` (parent → root), `sub_teams[]` (immediate children with member counts), direct members                                                                                        |
| `PATCH`                   | `/api/teams/:id`                                     | Update name, description, avatar, public-profile flags (incl. `profile_show_sub_teams`), `parent_team_id` (owner-only, cycle/depth-checked), `require_2fa`, `require_verified_email`, `enable_groups` (owner-only), `role_permissions` (owner-only) |
| `DELETE`                  | `/api/teams/:id`                                     | Disband (owner — direct or inherited). Cascades to every sub-team; each level's apps fall back to that level's own owner                                                                                                                            |
| `GET`                     | `/api/teams/:id/sub-teams`                           | List immediate sub-teams. Members of an ancestor team (direct or inherited) may list                                                                                                                                                                |
| `POST`                    | `/api/teams/:id/sub-teams`                           | Create a sub-team under `:id` — convenience alias for `POST /api/teams` with `parent_team_id`                                                                                                                                                       |
| `POST`                    | `/api/teams/:id/members`                             | Add member by username/id (admins+)                                                                                                                                                                                                                 |
| `PATCH`                   | `/api/teams/:id/members/:userId`                     | Change role                                                                                                                                                                                                                                         |
| `DELETE`                  | `/api/teams/:id/members/:userId`                     | Remove member (or leave the team if `:userId = self`)                                                                                                                                                                                               |
| `PATCH`                   | `/api/teams/:id/membership/show-on-profile`          | Per-member opt-in to appear in the team's public member list                                                                                                                                                                                        |
| `GET`                     | `/api/teams/:id/groups`                              | List [member group](teams.md#member-groups) definitions plus the resolved admin capabilities (any member)                                                                                                                                           |
| `POST`                    | `/api/teams/:id/groups`                              | Create a group. Requires the `groups:manage` capability; `admin_assignable` is owner-only                                                                                                                                                           |
| `PATCH`                   | `/api/teams/:id/groups/:groupId`                     | Update name/description/colour. `slug` is immutable; `admin_assignable` is owner-only                                                                                                                                                               |
| `DELETE`                  | `/api/teams/:id/groups/:groupId`                     | Delete a group — cascades to every assignment                                                                                                                                                                                                       |
| `PUT`                     | `/api/teams/:id/members/:userId/groups`              | Replace a member's group set (`{ group_ids: [...] }`). Only the groups that change are permission-checked                                                                                                                                           |
| `POST`                    | `/api/teams/:id/transfer-ownership`                  | Transfer ownership to another member                                                                                                                                                                                                                |
| `GET`                     | `/api/teams/:id/invites`                             | List active invite tokens                                                                                                                                                                                                                           |
| `POST`                    | `/api/teams/:id/invites`                             | Mint an invite token (optional email lock + max uses + expiry)                                                                                                                                                                                      |
| `DELETE`                  | `/api/teams/:id/invites/:token`                      | Revoke an invite                                                                                                                                                                                                                                    |
| `GET`                     | `/api/teams/join/:token` (auth optional)             | Inspect an invite — returns the team, requirements, unmet flags                                                                                                                                                                                     |
| `POST`                    | `/api/teams/join/:token`                             | Accept an invite                                                                                                                                                                                                                                    |
| `GET` / `POST` / `DELETE` | `/api/teams/:id/domains[/:domainId]`                 | Team-owned domains. `GET` also returns ancestor-owned domains as read-only entries tagged `inherited_from` (subject to `inherit_team_domains`)                                                                                                      |
| `POST`                    | `/api/teams/:id/domains/:domainId/verify`            | Trigger re-verification                                                                                                                                                                                                                             |
| `POST`                    | `/api/teams/:id/domains/:domainId/to-personal`       | Move a verified domain to the user's personal namespace                                                                                                                                                                                             |
| `POST`                    | `/api/teams/:id/domains/:domainId/share-to-team`     | Share a personal domain with the team                                                                                                                                                                                                               |
| `POST`                    | `/api/teams/:id/domains/:domainId/share-to-personal` | Reverse the above                                                                                                                                                                                                                                   |
| `GET` / `POST`            | `/api/teams/:id/apps`                                | Team-owned OAuth apps                                                                                                                                                                                                                               |
| `POST`                    | `/api/teams/:id/apps/transfer`                       | Transfer a personal app into the team                                                                                                                                                                                                               |
| `DELETE`                  | `/api/teams/:id/apps/:appId/transfer`                | Move a team-owned app back to the original owner                                                                                                                                                                                                    |

## Domains

| Method   | Path                      | Notes                                                                                                               |
| -------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/domains`            | List the current user's domains                                                                                     |
| `POST`   | `/api/domains`            | Add domain. Returns `verification_method` options + the per-method instructions (DNS TXT, HTML meta, `.well-known`) |
| `POST`   | `/api/domains/:id/verify` | Trigger a re-verification check using the chosen method                                                             |
| `DELETE` | `/api/domains/:id`        | Remove                                                                                                              |

## Social Connections

| Method   | Path                                 | Notes                                                                                  |
| -------- | ------------------------------------ | -------------------------------------------------------------------------------------- |
| `GET`    | `/api/connections`                   | List the user's linked accounts                                                        |
| `GET`    | `/api/connections/:slug/begin`       | Redirect to the source's authorization URL. `?mode=login` (default) or `?mode=connect` |
| `GET`    | `/api/connections/:slug/callback`    | OAuth callback (auto-handled by the provider redirect)                                 |
| `GET`    | `/api/connections/telegram/callback` | Telegram widget callback (no `:slug` because Telegram uses a different flow)           |
| `POST`   | `/api/connections/:id/refresh`       | Refresh display name / avatar from the provider                                        |
| `DELETE` | `/api/connections/:id`               | Disconnect                                                                             |

OAuth-scoped equivalents:

| Method   | Path                                   | Scope          |
| -------- | -------------------------------------- | -------------- |
| `GET`    | `/api/oauth/me/social-connections`     | `social:read`  |
| `DELETE` | `/api/oauth/me/social-connections/:id` | `social:write` |

## OAuth 2.0 / OIDC

See the [OAuth / OIDC Guide](oauth.md) for the full walkthrough.

| Method | Path                                | Notes                                                      |
| ------ | ----------------------------------- | ---------------------------------------------------------- |
| `GET`  | `/api/oauth/authorize`              | Returns app info + requested scopes for the consent screen |
| `POST` | `/api/oauth/authorize`              | Approve / deny                                             |
| `POST` | `/api/oauth/token`                  | `authorization_code` and `refresh_token` grants            |
| `GET`  | `/api/oauth/userinfo`               | OIDC UserInfo                                              |
| `POST` | `/api/oauth/introspect`             | RFC 7662                                                   |
| `POST` | `/api/oauth/revoke`                 | RFC 7009                                                   |
| `GET`  | `/.well-known/openid-configuration` | Discovery                                                  |
| `GET`  | `/.well-known/jwks.json`            | RSA public keys for ID token + JWT access tokens           |

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
and all outstanding tokens for that app.

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
an open SSRF relay. Cross-origin headers are set so the response is safely
embeddable.

### `POST /api/proxy/image/register`

Register a new mapping for a remote image URL the SPA needs to load (markdown
preview, ImageUrlInput preview). Requires auth. Returns
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

| Path                                                         | Notes                                               |
| ------------------------------------------------------------ | --------------------------------------------------- |
| `GET / PATCH /api/admin/apps[/:id]`                          | Verify or deactivate                                |
| `GET / POST / PATCH / DELETE /api/admin/oauth-sources[/:id]` | Source CRUD                                         |
| `GET /api/admin/oauth-sources/discover`                      | Auto-fetch OIDC discovery for a candidate issuer    |
| `POST /api/admin/oauth-sources/migrate`                      | One-time: import the legacy site_config social keys |
| `GET / POST / DELETE /api/admin/invites[/:id]`               | Site-invite tokens                                  |
| `GET /api/admin/teams` / `DELETE /:id`                       | List / disband teams                                |
| `POST /api/admin/test-email`                                 | Send a test outbound email                          |
| `POST /api/admin/test-email-receiving`                       | Generate a test verify-by-email code                |

### Audit / request logs / login errors

| Method   | Path                                  | Notes                            |
| -------- | ------------------------------------- | -------------------------------- |
| `GET`    | `/api/admin/audit-log?page=…`         | Audit events                     |
| `GET`    | `/api/admin/login-errors`             | Failed-login table               |
| `GET`    | `/api/admin/request-logs`             | Filterable per-request log       |
| `GET`    | `/api/admin/request-logs/export`      | CSV export of the current filter |
| `GET`    | `/api/admin/request-logs/:id/details` | Single request detail            |
| `DELETE` | `/api/admin/request-logs`             | Purge all                        |
| `DELETE` | `/api/admin/request-logs/spectate`    | Clear the live spectate buffer   |

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
