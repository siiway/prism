# API Reference

Base path: `/api`

All endpoints return JSON. Authenticated endpoints require an `Authorization: Bearer <token>` header. Tokens are JWTs issued on login or social callback.

## Init

### `GET /api/init/status`

Returns whether the instance has been set up.

**Response**

```json
{ "initialized": false }
```

### `POST /api/init`

Creates the first admin account. Only works when `initialized = false`.

**Body**

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

Public site configuration for the frontend. No authentication required.

**Response**

```json
{
  "site_name": "Prism",
  "site_description": "...",
  "site_icon_url": null,
  "allow_registration": true,
  "captcha_provider": "none",
  "captcha_site_key": "",
  "pow_difficulty": 20,
  "accent_color": "#0078d4",
  "custom_css": "",
  "initialized": true,
  "require_email_verification": false,
  "email_verify_methods": "both",
  "enabled_providers": ["github", "google"]
}
```

## Auth

### `POST /api/auth/register`

**Body**

```json
{
  "email": "user@example.com",
  "username": "alice",
  "password": "hunter2",
  "display_name": "Alice",
  "captcha_token": "...",
  "pow_challenge": "...",
  "pow_nonce": 12345
}
```

Include whichever bot-protection fields match the active captcha provider.

**Response** — `{ "token": "...", "user": { ... } }`

### `POST /api/auth/login`

**Body**

```json
{
  "identifier": "alice",
  "password": "hunter2",
  "totp_code": "123456",
  "captcha_token": "..."
}
```

`identifier` accepts username or email. `totp_code` is required only if TOTP is enabled.

**Response**

```json
{ "token": "...", "user": { ... } }
```

If TOTP is enabled but no code was provided:

```json
{ "totp_required": true }
```

### `POST /api/auth/logout`

Revokes the current session. Requires auth.

### `GET /api/auth/verify-email?token=<token>`

Verifies an email address using the token sent by email.

### `POST /api/auth/resend-verify-email`

Resends the email verification link. Requires auth. Accepts optional captcha fields.

**Body** — `{ "captcha_token": "...", "pow_challenge": "...", "pow_nonce": 12345 }`

**Response** — `{ "message": "Verification email sent" }`

### `POST /api/auth/email-verify-code`

Returns a verification address the user can send an email to in order to verify their email. Format: `verify-<code>@<domain>`. Requires auth. Accepts optional captcha fields.

**Body** — `{ "captcha_token": "...", "pow_challenge": "...", "pow_nonce": 12345 }`

**Response** — `{ "address": "verify-abc123@example.com", "code": "abc123" }`

### `GET /api/auth/pow-challenge`

Returns a PoW challenge for the proof-of-work captcha provider.

**Response** — `{ "challenge": "...", "difficulty": 20 }`

## TOTP (2FA)

All endpoints require authentication.

### `POST /api/auth/totp/setup`

Generates a new TOTP secret. Returns the secret and `otpauth://` URI for QR codes.

**Response** — `{ "secret": "...", "uri": "otpauth://totp/..." }`

### `POST /api/auth/totp/verify`

Confirms TOTP setup by verifying the first code. Returns backup codes.

**Body** — `{ "code": "123456" }`

**Response** — `{ "message": "TOTP enabled", "backup_codes": ["XXXX-YYYY", ...] }`

### `DELETE /api/auth/totp`

Disables TOTP. Requires a valid current TOTP code or backup code.

**Body** — `{ "code": "123456" }`

### `POST /api/auth/totp/backup-codes`

Regenerates backup codes. Requires a valid TOTP code.

**Body** — `{ "code": "123456" }`

**Response** — `{ "backup_codes": ["XXXX-YYYY", ...] }`

## Passkeys (WebAuthn)

### `POST /api/auth/passkey/register/begin`

Starts passkey registration for the authenticated user. Returns WebAuthn
`PublicKeyCredentialCreationOptions`.

### `POST /api/auth/passkey/register/finish`

**Body** — `{ "response": <AuthenticatorAttestationResponse>, "name": "My YubiKey" }`

### `POST /api/auth/passkey/auth/begin`

Starts passkey authentication (unauthenticated).

**Body** — `{ "username": "alice" }` (optional — omit for discoverable credentials)

### `POST /api/auth/passkey/auth/finish`

**Body** — `{ "challenge": "...", "response": <AuthenticatorAssertionResponse> }`

**Response** — `{ "token": "...", "user": { ... } }`

### `GET /api/auth/passkeys`

Lists the authenticated user's registered passkeys.

### `DELETE /api/auth/passkeys/:id`

Deletes a passkey by ID.

## GPG Keys

### `POST /api/auth/gpg-challenge`

Request a login challenge for GPG-based authentication. Rate-limited to 30 requests per minute per IP.

**Body**

```json
{ "identifier": "alice" }
```

**Response**

```json
{
  "challenge": "a3f8...",
  "text": "Prism login\nUser: alice\nChallenge: a3f8...\nTimestamp: 1710000000"
}
```

Sign the returned `text` using `gpg --clearsign`, then pass the output to `/api/auth/gpg-login`.

### `POST /api/auth/gpg-login`

Complete GPG login by submitting a signed challenge. Rate-limited to 10 requests per minute per IP.

**Body**

```json
{
  "identifier": "alice",
  "signed_message": "-----BEGIN PGP SIGNED MESSAGE-----\n..."
}
```

**Response** — `{ "token": "...", "user": { ... } }`

The challenge is single-use and expires after 5 minutes.

### `GET /api/user/gpg`

List the authenticated user's registered GPG keys. Requires session auth.

**Response**

```json
{
  "keys": [
    {
      "id": "...",
      "fingerprint": "abc123...",
      "key_id": "...",
      "name": "My laptop key",
      "created_at": 1710000000,
      "last_used_at": 1710100000
    }
  ]
}
```

### `POST /api/user/gpg`

Add a GPG public key. Requires session auth.

**Body**

```json
{
  "public_key": "-----BEGIN PGP PUBLIC KEY BLOCK-----\n...",
  "name": "My laptop key"
}
```

If `name` is omitted, the first user ID from the key is used as the label.

### `DELETE /api/user/gpg/:id`

Remove a GPG key by ID. Requires session auth.

### `GET /users/:username.gpg`

Public endpoint — returns all of the user's registered GPG public keys in ASCII armor format, one block per line (separated by blank lines). `Content-Type: application/pgp-keys`. Returns `404` if the user has no keys.

```
curl https://your-prism-domain/users/alice.gpg
```

### OAuth-scoped GPG endpoints

These endpoints accept an OAuth access token or PAT with the appropriate scope instead of a session cookie.

| Method   | Path                         | Scope required |
|----------|------------------------------|----------------|
| `GET`    | `/api/oauth/me/gpg-keys`     | `gpg:read`     |
| `POST`   | `/api/oauth/me/gpg-keys`     | `gpg:write`    |
| `DELETE` | `/api/oauth/me/gpg-keys/:id` | `gpg:write`    |

Request/response shapes match the session-auth equivalents above.

### OAuth-scoped social connection endpoints

These endpoints accept an OAuth access token or PAT with the appropriate scope instead of a session cookie.

| Method   | Path                                   | Scope required |
|----------|----------------------------------------|----------------|
| `GET`    | `/api/oauth/me/social-connections`     | `social:read`  |
| `DELETE` | `/api/oauth/me/social-connections/:id` | `social:write` |

Request/response shapes match the session-auth equivalents above.

## Sessions

### `GET /api/auth/sessions`

Lists active sessions for the authenticated user.

### `DELETE /api/auth/sessions/:id`

Revokes a session by ID.

## User

All endpoints require authentication.

### `GET /api/user/me`

**Response**

```json
{
  "user": {
    "id": "...",
    "email": "...",
    "username": "...",
    "display_name": "...",
    "avatar_url": null,
    "role": "user",
    "email_verified": true
  },
  "totp_enabled": false,
  "passkey_count": 1
}
```

### `PATCH /api/user/me`

**Body** — `{ "display_name": "Alice", "avatar_url": "https://..." }`

### `POST /api/user/me/change-password`

**Body** — `{ "current_password": "...", "new_password": "..." }`

### `POST /api/user/me/avatar`

`multipart/form-data` with field `avatar`. Max 2 MB. Accepted types: JPEG, PNG, WebP, GIF.

**Response** — `{ "avatar_url": "/api/assets/avatars/..." }`

### `DELETE /api/user/me`

Deletes the account permanently.

**Body** — `{ "password": "...", "confirm": "DELETE" }`

## OAuth Apps

All endpoints require authentication.

### `GET /api/apps`

Lists apps owned by the current user.

### `POST /api/apps`

**Body**

```json
{
  "name": "My App",
  "description": "...",
  "website_url": "https://myapp.com",
  "redirect_uris": ["https://myapp.com/callback"],
  "allowed_scopes": ["openid", "profile", "email"],
  "is_public": false
}
```

### `GET /api/apps/:id`

### `PATCH /api/apps/:id`

Partial update — same fields as create.

### `POST /api/apps/:id/rotate-secret`

Generates a new `client_secret`. The old one is immediately invalid.

**Response** — `{ "client_secret": "..." }`

### `DELETE /api/apps/:id`

## Domains

All endpoints require authentication.

### `GET /api/domains`

Lists verified and unverified domains for the current user.

### `POST /api/domains`

**Body** — `{ "domain": "example.com", "app_id": "optional-app-id" }`

**Response** — includes `txt_record` (hostname) and `txt_value` (the token to add as a DNS TXT record).

### `POST /api/domains/:id/verify`

Triggers a DNS verification check. Queries `_prism-verify.domain` for the TXT record.

**Response** — `{ "verified": true, "next_reverify_at": 1234567890 }`

### `DELETE /api/domains/:id`

## Social Connections

### `GET /api/connections`

Lists connected social providers for the authenticated user.

### `GET /api/connections/:provider/begin`

Redirects to the OAuth authorization URL for `provider` (`github`, `google`, `microsoft`, `discord`).

Query params:

- `mode=login` (default) — log in or register with this provider
- `mode=connect` — attach the provider to an existing logged-in account

### `GET /api/connections/:provider/callback`

OAuth callback handled automatically. Redirects to `/auth/callback?token=...` on success or `/connections?error=...` on failure.

### `DELETE /api/connections/:provider`

Disconnects the provider from the current account. Requires auth.

## OAuth 2.0 / OIDC

See the [OAuth / OIDC Guide](oauth.md) for the full integration walkthrough.

### `GET /api/oauth/authorize`

Returns the app info and requested scopes for the consent screen.

### `POST /api/oauth/authorize`

Approves or denies an authorization request.

**Body**

```json
{
  "client_id": "...",
  "redirect_uri": "https://app.example.com/callback",
  "scope": "openid profile email",
  "state": "random-state",
  "code_challenge": "...",
  "code_challenge_method": "S256",
  "action": "approve"
}
```

### `POST /api/oauth/token`

Token endpoint. Supports `authorization_code` and `refresh_token` grant types.

### `GET /api/oauth/userinfo`

Returns the authenticated user's profile in OpenID Connect format.

### `POST /api/oauth/introspect`

RFC 7662 token introspection.

### `POST /api/oauth/revoke`

RFC 7009 token revocation.

### `GET /.well-known/openid-configuration`

OpenID Connect Discovery document.

## Admin

All admin endpoints require authentication with `role = admin`.

### Config

- `GET /api/admin/config` — all config key/value pairs
- `PATCH /api/admin/config` — update one or more keys

### Stats

- `GET /api/admin/stats` — `{ users, apps, verified_domains, active_tokens }`

### Users

- `GET /api/admin/users?page=1&limit=20&search=alice`
- `GET /api/admin/users/:id`
- `PATCH /api/admin/users/:id` — update `role`, `is_active`, `email_verified`
- `DELETE /api/admin/users/:id`

### Apps

- `GET /api/admin/apps?page=1`
- `PATCH /api/admin/apps/:id` — update `is_verified`, `is_active`

### Audit log

- `GET /api/admin/audit-log?page=1`

## Health

### `GET /api/health`

Always returns `{ "ok": true }`. No authentication.
