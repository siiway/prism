---
title: Personal Access Tokens
description: Create and manage long-lived API tokens with specific scopes for scripting and automation.
---

# Personal Access Tokens

Personal access tokens (PATs) let you authenticate API requests without going through the OAuth authorization flow. They are ideal for scripts, CI pipelines, and integrations where an interactive login is not possible.

PATs are managed at **Profile → Access Tokens** (`/tokens`).

## Creating a token

1. Click **New token**.
2. Enter a descriptive **name** (e.g. `CI deploy script`, `Home automation`).
3. Select an **expiration**: 7, 30, 90, or 365 days — or leave blank for no expiry.
4. Check the **scopes** the token needs. Grant the minimum required for your use case.
5. Click **Generate token**.
6. **Copy the token immediately** — it is shown only once and cannot be retrieved again.

## Using a token

PATs use the same `Authorization: Bearer` header as OAuth access tokens:

```http
Authorization: Bearer prism_pat_<token>
```

Example with `curl`:

```bash
curl https://your-prism-domain/api/oauth/me/profile \
  -H "Authorization: Bearer prism_pat_<token>"
```

Prism identifies PATs by the `prism_pat_` prefix and validates them against the `personal_access_tokens` table instead of the OAuth token table.

## Scope reference

See [Admin Guide → OAuth Scope Reference](admin.md#oauth-scope-reference) for the full list of available scopes and what each one allows.

Note: admin scopes (`admin:*`) are available to PATs but only work if the token owner has `role = admin`.

## Revoking a token

Click **Revoke** next to any token in the list. Revocation is immediate — any in-flight request using that token will fail with `403`.

## Security recommendations

- Use the narrowest set of scopes that satisfies your use case.
- Set an expiration whenever possible. Tokens without expiry remain valid indefinitely until manually revoked.
- Store tokens in environment variables or secrets managers, not in source code.
- Rotate tokens periodically, especially for shared CI environments.
- If a token is leaked, revoke it immediately from **Profile → Access Tokens**.

## Differences from OAuth access tokens

| | Personal Access Token | OAuth Access Token |
| - | - | - |
| Created by | User (UI or API) | OAuth authorization flow |
| Prefix | `prism_pat_` | (none) |
| Scopes | User-selected at creation | Granted by user at consent screen |
| Refresh | No — revoke and create a new one | Yes, via `offline_access` scope |
| Revocation | Profile → Access Tokens page | Profile → Connected Apps page |
| Use case | Scripts, CI, automation | Third-party apps |
