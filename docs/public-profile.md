---
title: Public Profiles
description: Let users and teams opt into public-facing pages that expose the fields they choose — display name, avatar, GPG keys, owned apps, verified domains, and more.
---

# Public Profiles

Prism users can opt into a public profile at `/u/<username>`, and team owners can opt their teams into a public page at `/t/<team-id>`. Both are visible to anyone without logging in. Each user / team owner picks which sections to share, and admins set sensible site-wide defaults.

Profiles are private by default. Nothing becomes visible until the user (or team owner) explicitly opts in.

## How it works

Visibility is layered:

1. **Master site switch** — admins can disable the feature for the entire instance. With it off, `/u/<username>` and `/api/users/<username>` always return 404, regardless of any user's preference.
2. **Per-user opt-in** — each user toggles "Make my profile public" in **Profile → Public profile**. With it off, the same 404 response.
3. **Per-field flags** — when public, the user picks which fields to share (display name, avatar, email, join date, GPG keys, authorized apps, owned apps). Fields the user hasn't explicitly customized follow the site default for that field.

The 404 response is identical for non-existent users and private users, so the endpoint doesn't leak which usernames exist on the instance.

## Available fields — user profile

| Field | What it shows | Default |
| - | - | - |
| Display name | The user's display name | Public |
| Avatar | The user's avatar image | Public |
| Email | The user's primary email address | **Private** |
| Join date | When the account was created | Public |
| GPG public keys | Fingerprint, key ID, and label of each registered GPG key | Public |
| Authorized apps | Apps the user has granted OAuth access to (name, icon, website) | **Private** |
| User-owned apps | OAuth apps the user has registered (name, icon, description) | Public |
| Verified domains | Domains the user owns and has verified | Public |

The "default" column is the out-of-the-box site default — admins can flip any of them.

::: tip Why authorized apps default to private
The list of services a user has connected is sensitive (it reveals what they use). It defaults to private even when the rest of the profile is public.
:::

## Available fields — team profile

Teams have their own visibility flags, controlled by **team owners and admins** (not site admins). The same per-section opt-in model applies; teams are private by default.

| Field | What it shows | Default |
| - | - | - |
| Description | The team's description | Public |
| Avatar | The team avatar | Public |
| Owner | The team owner's username (linked to their public profile if also public) | **Private** |
| Member count | Number of team members (a number, not the list) | Public |
| Team-owned apps | OAuth apps registered to this team | Public |
| Verified domains | Domains owned by the team | Public |

::: tip Why owner defaults to private
A team's owner is a specific user. Showing their username on a public team page would surface that person even when their own user profile is private. The team owner has to explicitly opt in.
:::

The team page at `/t/<team-id>` will only link to the owner's `/u/<username>` page if the owner has also made *their* profile public. If they haven't, the team page shows just the owner's display name with no link.

## User settings

Users manage visibility in **Profile → Public profile**.

1. Toggle **Make my profile public**. Until this is on, no one else can view the profile.
2. Use the per-field switches to choose what to share. Switches you haven't touched show "(site default)" so it's clear when the value is inherited.
3. Click **View public profile** to open `/u/<username>` in a new tab and see exactly what others will see.

Switches save immediately on toggle — there's no separate "save" step.

## Team settings

Team owners and admins manage visibility in **Teams → \<team\> → Settings → Public profile**. The flow is the same as user settings:

1. **Make this team public** — master switch. Off = the team page returns 404 to outsiders.
2. Per-section switches with "(site default)" labels for inherited values.
3. **View public profile** opens `/t/<team-id>` in a new tab.

Members can always see the team's own public-profile page even when private — useful for previewing.

## Admin settings

Admins configure the feature in **Admin → Settings → Public profiles** (in the General tab).

- **Enable public profiles** — master kill switch. Off = the feature is unavailable site-wide for both users *and* teams.
- **Default visibility for each field** (user profiles) — applies to every user who hasn't set their own preference for that field.
- **Default visibility for each section** (team profiles) — applies to every team that hasn't set its own preference. Edited by team owners/admins, not site admins.

Updating a default propagates immediately to anyone using the inherited value.

Changing a default does **not** flip the master `profile_is_public` flag for any user or team — that's always an explicit per-user (or per-team-owner) opt-in. Admins cannot make any profile public against the owner's will.

## Public API

Public profile data is available via JSON endpoints that require no authentication.

### `GET /api/users/:username`

Returns the user profile (filtered by visibility flags) or `404` if the username is unknown, private, or the feature is disabled.

```bash
curl https://your-prism-domain/api/users/alice
```

```json
{
  "profile": {
    "username": "alice",
    "display_name": "Alice",
    "avatar_url": "/api/proxy/image?...",
    "unproxied_avatar_url": "https://example.com/alice.png",
    "email": null,
    "joined_at": 1730000000,
    "gpg_keys": [
      {
        "fingerprint": "abcd1234...",
        "key_id": "abcdef0123456789",
        "name": "laptop",
        "created_at": 1730000000
      }
    ],
    "authorized_apps": null,
    "owned_apps": [
      {
        "id": "app_...",
        "client_id": "abc123",
        "name": "My Tool",
        "description": "A small utility",
        "icon_url": null,
        "website_url": "https://mytool.example",
        "created_at": 1730000000
      }
    ],
    "domains": [
      { "domain": "alice.example", "verified_at": 1730000000 }
    ]
  }
}
```

A field that the user has hidden is returned as `null` (or the entire array is `null` for collections like `gpg_keys`, `domains`).

### `GET /api/public/teams/:id`

Returns the team profile or `404` under the same rules.

```bash
curl https://your-prism-domain/api/public/teams/team_abc123
```

```json
{
  "team": {
    "id": "team_abc123",
    "name": "Acme",
    "description": "We make stuff.",
    "avatar_url": "/api/proxy/image?...",
    "unproxied_avatar_url": "https://example.com/acme.png",
    "created_at": 1730000000,
    "owner": {
      "username": "alice",
      "display_name": "Alice",
      "avatar_url": "/api/proxy/image?..."
    },
    "member_count": 12,
    "apps": [
      {
        "id": "app_...",
        "client_id": "...",
        "name": "Acme Cloud",
        "description": "",
        "icon_url": null,
        "website_url": "https://acme.example",
        "created_at": 1730000000
      }
    ],
    "domains": [
      { "domain": "acme.example", "verified_at": 1730000000 }
    ]
  }
}
```

When the team owner has opted into showing themselves but their *own* user profile is private, `owner.username` and `owner.avatar_url` are `null` — only `display_name` is exposed, with no link out.

### Behavior

- Both endpoints accept an optional Bearer token. For user profiles, a token belonging to the profile's owner returns the profile even when private. For team profiles, **any team member's** token (not just the owner) returns the team page when private — useful for previewing.
- All `404` responses share the same body (`{"error":"Not found"}`), so callers can't distinguish "doesn't exist" from "opted out."
- Image URLs go through Prism's image proxy (`/api/proxy/image?...`); the original is also returned as `unproxied_avatar_url` for direct use.

### GPG keys

The public profile includes only metadata for each registered GPG key (fingerprint, key ID, label). The full ASCII-armored public key blocks remain at the existing `/users/:username.gpg` endpoint, which is independent of these visibility flags — it has always been public for federated lookups.

## SDK usage

The [`@siiway/prism`](https://www.npmjs.com/package/@siiway/prism) TypeScript SDK exposes both endpoints:

```ts
import { PrismClient } from "@siiway/prism";

const client = new PrismClient({
  baseUrl: "https://your-prism-domain",
  clientId: "your-client-id",
  redirectUri: "https://yourapp.example/callback",
});

const profile = await client.getPublicProfile("alice");
const team = await client.getPublicTeamProfile("team_abc123");

console.log(profile?.display_name, team?.member_count);
```

Both calls return `null` (instead of throwing) when the profile is missing or private, so a single null-check covers all the "no public data" cases. No token is needed.

## Database schema

### `users`

| Column | Type | Meaning |
| - | - | - |
| `profile_is_public` | `INTEGER NOT NULL DEFAULT 0` | `1` = the user has opted in. No NULL state — admins can never silently flip this. |
| `profile_show_display_name` | `INTEGER` (nullable) | `NULL` = follow site default; `0`/`1` = explicit user choice. |
| `profile_show_avatar` | `INTEGER` (nullable) | Same. |
| `profile_show_email` | `INTEGER` (nullable) | Same. |
| `profile_show_joined_at` | `INTEGER` (nullable) | Same. |
| `profile_show_gpg_keys` | `INTEGER` (nullable) | Same. |
| `profile_show_authorized_apps` | `INTEGER` (nullable) | Same. |
| `profile_show_owned_apps` | `INTEGER` (nullable) | Same. |
| `profile_show_domains` | `INTEGER` (nullable) | Same. |

### `teams`

| Column | Type | Meaning |
| - | - | - |
| `profile_is_public` | `INTEGER NOT NULL DEFAULT 0` | Set by team owner/admin. Same no-NULL guarantee. |
| `profile_show_description` | `INTEGER` (nullable) | `NULL` = follow site default; `0`/`1` = explicit team choice. |
| `profile_show_avatar` | `INTEGER` (nullable) | Same. |
| `profile_show_owner` | `INTEGER` (nullable) | Same. |
| `profile_show_member_count` | `INTEGER` (nullable) | Same. |
| `profile_show_apps` | `INTEGER` (nullable) | Same. |
| `profile_show_domains` | `INTEGER` (nullable) | Same. |

### `site_config`

| Key | Meaning |
| - | - |
| `enable_public_profiles` | Master kill switch covering both users and teams. |
| `default_profile_show_*` | Per-field defaults for user profiles. |
| `default_team_profile_show_*` | Per-section defaults for team profiles. |
