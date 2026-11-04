---
title: Public Profiles
description: Let users and teams opt into public-facing pages that expose the fields they choose — display name, avatar, GPG keys, owned apps, verified domains, and more.
---

# Public Profiles

Users can opt into a public profile at `/u/<username>`, and team owners can opt their teams into a public page at `/t/<team-id>`. Both are visible to anyone without signing in. Each user or team owner picks which sections to share, and admins set site-wide defaults.

Profiles are private by default. Nothing becomes visible until the user (or team owner) opts in.

## How visibility works

1. **Site switch** — admins can turn the feature off for the whole instance. With it off, profile pages and endpoints always return 404.
2. **Opt-in** — each user turns on "Make my profile public" in **Profile → Public profile**. Until then, the profile returns 404.
3. **Per-field choices** — once public, the user picks which fields to share. Fields they haven't touched follow the site default.

A missing user and a private user give the same 404, so nobody can use it to find out which usernames exist.

## User profile fields

| Field            | What it shows                                             | Default     |
| ---------------- | --------------------------------------------------------- | ----------- |
| Display name     | The user's display name                                   | Public      |
| Avatar           | The user's avatar image                                   | Public      |
| Email            | The primary email address                                 | **Private** |
| Join date        | When the account was created                              | Public      |
| GPG public keys  | Fingerprint, key ID and label of each GPG key             | Public      |
| Authorized apps  | Apps the user has granted access to (name, icon, website) | **Private** |
| User-owned apps  | Apps the user registered (name, icon, description)        | Public      |
| Verified domains | Domains the user owns and has verified                    | Public      |

These are the out-of-the-box site defaults; admins can change any of them. Authorized apps default to private because the list reveals which services someone uses.

## Team profile fields

Team owners and admins (not site admins) control a team's visibility. Teams are private by default.

| Field            | What it shows                                                            | Default     |
| ---------------- | ------------------------------------------------------------------------ | ----------- |
| Description      | The team's description                                                   | Public      |
| Avatar           | The team avatar                                                          | Public      |
| Owner            | The owner's username, linked to their profile if that is also public     | **Private** |
| Member count     | The number of members                                                    | Public      |
| Team-owned apps  | Apps registered to the team                                              | Public      |
| Verified domains | Domains owned by the team                                                | Public      |
| Member list      | Each member (each member's own "show joined teams" setting also applies) | **Private** |
| Sub-teams        | Immediate sub-teams that have themselves opted into a public profile     | Public      |

A sub-team's page shows a "Sub-team of `<parent>`" link, but only when the parent is public too. The owner is private by default because showing their username would surface that person even if their own profile is private. If the owner's profile is private, the team page shows their display name without a link.

## User settings

In **Profile → Public profile**:

1. Turn on **Make my profile public**.
2. Use the switches to choose what to share. Untouched ones are labelled "(site default)".
3. Click **View public profile** to see exactly what others see.

Switches save as soon as you change them.

## Team settings

Team owners and admins use **Teams → \<team\> → Settings → Public profile**, which works the same way: a **Make this team public** switch, per-section switches, and **View public profile**. Team members can always preview the page, even when it's private.

## Admin settings

In **Admin → Settings → Public profiles**:

- **Users can publish a profile** — the master switch. **Not allowed** turns the feature off for users and teams.
- **Defaults** for each user field and each team section. They apply to everyone who hasn't chosen for themselves, and take effect immediately.

Changing a default never makes a profile public. That is always the user's or team owner's own opt-in.

## Public API

No authentication is needed for either endpoint.

### `GET /api/users/:username`

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
    "domains": [{ "domain": "alice.example", "verified_at": 1730000000 }]
  }
}
```

A field the user hid comes back as `null`.

### `GET /api/public/teams/:id`

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
    "created_at": 1730000000,
    "owner": {
      "username": "alice",
      "display_name": "Alice",
      "avatar_url": "/api/proxy/image?..."
    },
    "member_count": 12,
    "apps": [],
    "domains": [{ "domain": "acme.example", "verified_at": 1730000000 }]
  }
}
```

If the owner's own profile is private, `owner.username` and `owner.avatar_url` are `null` and only `display_name` is shown.

### Notes

- Both endpoints accept an optional Bearer token. The owner of a private profile can still read it; for a private team, any member can.
- Every `404` has the same body (`{"error":"not_found"}`).
- Image URLs go through Prism's avatar proxy. The original is also returned as `unproxied_avatar_url`.
- Profiles list only GPG key metadata. The full public keys are at `/users/:username.gpg`, which is always public and not affected by these settings.

## SDK

The [`@siiway/prism`](https://www.npmjs.com/package/@siiway/prism) TypeScript SDK wraps both endpoints:

```ts
import { PrismClient } from "@siiway/prism";

const client = new PrismClient({
  baseUrl: "https://your-prism-domain",
  clientId: "your-client-id",
  redirectUri: "https://yourapp.example/callback",
});

const profile = await client.getPublicProfile("alice");
const team = await client.getPublicTeamProfile("team_abc123");
```

Both return `null` instead of throwing when the profile is missing or private.
