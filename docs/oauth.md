---
title: OAuth / OIDC Guide
description: Integrate Prism as your OAuth 2.0 / OpenID Connect provider — authorization code flow, PKCE, scopes, token exchange, and introspection.
---

# OAuth 2.0 / OIDC Integration Guide

Prism is a standards-compliant OAuth 2.0 authorization server and OpenID Connect provider. Any application that supports OAuth 2.0 authorization code flow can use Prism as its identity provider.

## Discovery

The OpenID Connect discovery document is available at:

```
https://your-prism-domain/.well-known/openid-configuration
```

Most OAuth/OIDC libraries can auto-configure from this URL.

## Registering an application

1. Log in to Prism and go to **Apps → New Application**
2. Fill in the name, description, and redirect URIs
3. Copy the **Client ID** and **Client Secret** — the secret is shown only once

If your app runs entirely in the browser (no server to keep the secret), enable
**Public client**. Public clients must use PKCE and do not have a client secret.

## Authorization code flow (with PKCE)

### Step 1 — Redirect the user

```
GET https://your-prism-domain/api/oauth/authorize
  ?response_type=code
  &client_id=<CLIENT_ID>
  &redirect_uri=https://yourapp.com/callback
  &scope=openid profile email
  &state=<RANDOM_STATE>
  &code_challenge=<CODE_CHALLENGE>
  &code_challenge_method=S256
```

**PKCE** — generate a `code_verifier` (43–128 random URL-safe characters), then:

```
code_challenge = BASE64URL(SHA-256(ASCII(code_verifier)))
```

**Scopes**

| Scope            | Claims / access granted                               |
|------------------|-------------------------------------------------------|
| `openid`         | `sub`, `iss`, `aud`, `iat`, `exp` (required for OIDC) |
| `profile`        | `name`, `preferred_username`, `picture`               |
| `email`          | `email`, `email_verified`                             |
| `apps:read`      | List of apps the user owns                            |
| `gpg:read`       | List the user's registered GPG public keys            |
| `gpg:write`      | Add and remove GPG public keys                        |
| `social:read`    | List the user's linked social provider accounts       |
| `social:write`   | Disconnect social provider accounts                   |
| `offline_access` | Enables refresh token issuance                        |

### Step 2 — User consents

Prism shows a consent screen listing your app name and the requested scopes.
If the user has already consented to the same scopes, the consent screen is
skipped automatically.

### Step 3 — Receive the code

Prism redirects to your `redirect_uri`:

```
https://yourapp.com/callback?code=<AUTH_CODE>&state=<STATE>
```

Always verify that `state` matches what you sent.

### Step 4 — Exchange for tokens

```http
POST /api/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=<AUTH_CODE>
&redirect_uri=https://yourapp.com/callback
&client_id=<CLIENT_ID>
&client_secret=<CLIENT_SECRET>
&code_verifier=<CODE_VERIFIER>
```

Public clients omit `client_secret` and must include `code_verifier`.

**Response**

```json
{
  "access_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "...",
  "id_token": "...",
  "scope": "openid profile email"
}
```

### Step 5 — Call UserInfo

```http
GET /api/oauth/userinfo
Authorization: Bearer <ACCESS_TOKEN>
```

**Response**

```json
{
  "sub": "user-id",
  "name": "Alice",
  "preferred_username": "alice",
  "email": "alice@example.com",
  "email_verified": true,
  "picture": "https://your-prism-domain/api/assets/avatars/..."
}
```

## Refreshing tokens

```http
POST /api/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token=<REFRESH_TOKEN>
&client_id=<CLIENT_ID>
&client_secret=<CLIENT_SECRET>
```

## Token introspection (RFC 7662)

For server-to-server verification without parsing JWTs:

```http
POST /api/oauth/introspect
Content-Type: application/x-www-form-urlencoded
Authorization: Basic <base64(client_id:client_secret)>

token=<ACCESS_TOKEN>
```

**Response (active token)**

```json
{
  "active": true,
  "sub": "user-id",
  "scope": "openid profile",
  "client_id": "...",
  "exp": 1234567890,
  "iat": 1234564290
}
```

## Token revocation (RFC 7009)

```http
POST /api/oauth/revoke
Content-Type: application/x-www-form-urlencoded

token=<ACCESS_OR_REFRESH_TOKEN>
&client_id=<CLIENT_ID>
&client_secret=<CLIENT_SECRET>
```

## ID token

The ID token is a signed JWT (HS256). Validate it by fetching the JWKS at
`/.well-known/jwks.json` or by calling the introspection endpoint.

Standard claims:

| Claim   | Value                             |
|---------|-----------------------------------|
| `iss`   | Your Prism instance URL           |
| `sub`   | Stable user ID                    |
| `aud`   | Your `client_id`                  |
| `iat`   | Issued-at timestamp               |
| `exp`   | Expiry timestamp                  |
| `nonce` | Echoed from authorization request |

## Error responses

Authorization errors redirect to your `redirect_uri` with:

```
?error=access_denied&error_description=User+denied+access
```

Token endpoint errors return HTTP 400:

```json
{ "error": "invalid_grant", "error_description": "Code expired or invalid" }
```

Common error codes: `invalid_request`, `invalid_client`, `invalid_grant`,
`unauthorized_client`, `unsupported_grant_type`, `access_denied`.
