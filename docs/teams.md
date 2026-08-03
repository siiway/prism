---
title: Teams
description: Collaborate on OAuth apps and verified domains. Roles, invites, requirement gates, and team-as-user storage.
---

# Teams

A team is a shared owner for OAuth applications and verified domains. Members
can manage the team's apps and domains in the same UI as their personal
resources, while ownership of those resources cleanly survives any single
member leaving the team.

## Roles

| Role       | Can manage members | Can edit team settings | Can manage apps/domains                | Can transfer ownership | Can disband |
| ---------- | ------------------ | ---------------------- | -------------------------------------- | ---------------------- | ----------- |
| `owner`    | yes                | yes                    | yes                                    | yes (to a co-owner)    | yes         |
| `co-owner` | yes (except owner) | yes                    | yes                                    | no                     | no          |
| `admin`    | yes (member only)  | no                     | yes                                    | no                     | no          |
| `member`   | no                 | no                     | yes (read; write apps the team allows) | no                     | no          |

There is exactly one owner per team. Transferring ownership is a single,
audited operation; the previous owner is demoted to co-owner.

## Joining a team

There are three ways to join:

1. **Direct add** by an admin/co-owner/owner from **Teams → \<team\> → Members → Add member**.
2. **Invite link** generated from **Members → Generate invite**. Optional email
   lock, max-uses cap, and expiry. Visiting `/teams/join/:token` shows the team
   profile and any unmet [requirements](#join-requirements) before accepting.
3. **API** — `POST /api/teams/join/:token` with a session bearer.

## Join requirements

Team owners can require members to satisfy security factors before joining (and
again whenever a member tries to drop below the bar). Admins can also enforce a
**site floor** — a minimum every team is forced to require, regardless of the
team-level flag.

| Requirement                                | Team flag                      | Site floor key                        |
| ------------------------------------------ | ------------------------------ | ------------------------------------- |
| At least one TOTP authenticator or passkey | `teams.require_2fa`            | `default_team_require_2fa`            |
| Verified primary email                     | `teams.require_verified_email` | `default_team_require_verified_email` |

Effective requirement = team flag **OR** site floor. Owners can opt their team
in further than the floor but cannot opt out below it. The team-settings UI
greys out the toggle for any factor forced by the site.

::: warning Retroactive enforcement
Turning a requirement on flips it for every existing member immediately. Any
member who hasn't enrolled the factor is locked out of team operations until
they do. The `unmetRequirements` helper surfaces this on the join confirmation
screen and on the user-side mutation paths (e.g. removing the last TOTP
authenticator) so members get a clear error before data is changed. Notify
members before flipping a requirement on a populated team.
:::

The user-facing join flow at `/teams/join/:token` shows the requirements first
and links to **Profile → Security** / **Profile → Email** to satisfy them. The
endpoint payload includes:

```json
{
  "team": { "id": "...", "name": "Acme", "avatar_url": "..." },
  "requirements": {
    "require_2fa": true,
    "require_verified_email": true,
    "forced_by_site": { "require_2fa": false, "require_verified_email": true }
  },
  "unmet": ["2fa"]
}
```

## Sub-teams (nested teams)

A team can be created **under another team** to mirror an organisation's
internal structure. Sub-teams nest recursively up to the operator-configured
`max_team_depth` (default **5 levels**); the server rejects cycles and
over-depth re-parents on both create and move.

The entire feature is gated behind site config — operators can turn it off,
tighten the depth cap, or toggle the inheritance semantics independently.
See [Configurability](#configurability) below.

### Inheritance — what flows down

Sub-teams are not isolated copies. Two things automatically flow from an
ancestor to every team underneath it (each can be turned off independently
in site config):

1. **Membership** (`inherit_team_membership`, default on) — a member of team
   **A** has _at least_ their A-role on every descendant of A. A direct
   membership on a sub-team stacks on top: the effective role is
   `max(direct, inherited)`. Useful for "department head is an admin of
   every project sub-team" without duplicating rows. When the toggle is off,
   `getEffectiveMember` degenerates to a direct-only lookup and listings
   stop expanding into sub-team subtrees.
2. **Verified domains** (`inherit_team_domains`, default on) — every domain
   owned by an ancestor is visible to sub-teams as a read-only entry tagged
   with `inherited_from`. This lets a sub-team auto-verify a sub-domain when
   the parent already owns the apex domain. When the toggle is off, both
   the listing and the auto-verify lookup are restricted to the team's own
   domains.

Everything else stays independent. Apps belong to whatever team created them;
the existing `share-to-team` flow still works for explicit copies.

### Configurability

All sub-team behavior is driven by site config (admin → **Settings → Sub-teams**). Each value is also surfaced on the unauthenticated
`/api/site` payload so SDK clients can mirror the gates in their UIs.

| Key                                   | Type | Default | Effect                                                                                                       |
| ------------------------------------- | ---- | ------- | ------------------------------------------------------------------------------------------------------------ |
| `enable_sub_teams`                    | bool | `true`  | Master switch — when `false` the sub-team endpoints reject every request and the UI hides the Sub-teams tab. |
| `max_team_depth`                      | int  | `5`     | Server-enforced cap on nesting depth. Validated 1–20 on the admin API.                                       |
| `inherit_team_membership`             | bool | `true`  | Cascade member roles to descendants.                                                                         |
| `inherit_team_domains`                | bool | `true`  | Surface ancestor-owned domains on sub-team listings + auto-verify.                                           |
| `default_team_profile_show_sub_teams` | bool | `true`  | Public-profile default for the sub-team listing section.                                                     |

The per-team override `profile_show_sub_teams` (column on `teams`) follows
the same `null`/`0`/`1` convention as every other `profile_show_*` flag:
`null` follows the site default, `0`/`1` override.

### Managing sub-teams

- **Create**: `POST /api/teams/:parentId/sub-teams` (admin+ on the parent —
  direct _or_ inherited counts) or the equivalent **Teams → \<team\> →
  Sub-teams → New sub-team** button. The creator becomes the new sub-team's
  owner.
- **List**: `GET /api/teams/:id/sub-teams` returns the immediate children with
  member counts and the caller's effective role. Members of an ancestor team
  can list.
- **Move / re-parent**: `PATCH /api/teams/:id { "parent_team_id": "..." }`
  with `null` to promote back to top-level. **Owner-only** on the team being
  moved, and the caller must be admin+ on the new parent. The server walks
  both subtrees to reject moves that would create a cycle or exceed
  `MAX_TEAM_DEPTH`.
- **Delete**: `DELETE /api/teams/:id` cascades through every descendant. For
  each level (deepest first) `dissolveTeam` reassigns that level's apps to
  that level's own owner — sub-team owners keep their apps, with the
  deleting user as the final fallback. The DB schema has
  `parent_team_id REFERENCES teams(id) ON DELETE CASCADE` as a belt to the
  application-level braces.

### Inherited memberships in listings

- `GET /api/teams` (session) and `GET /api/oauth/me/teams` both expand each
  direct membership to its full subtree. Entries carry an `inherited_from`
  ancestor id (or `null` for direct memberships).
- `GET /api/teams/:id` returns:
  - `team.ancestors` — `[{id, name, avatar_url}]` from immediate parent to
    root, useful for breadcrumbs.
  - `team.sub_teams` — immediate children with member counts.
  - `team.my_role` — the _effective_ role; `team.inherited_from` carries the
    ancestor id when the role came from inheritance.
  - `members` — the **first page** of direct members (50), plus
    `member_count` for the whole team. Page and filter through
    `GET /api/teams/:id/members`; the detail response carries page one so the
    initial render needs a single request. Inherited members are not listed —
    they are visible by inspecting ancestor teams, and surfacing them here
    would multiply listings.

## Member groups

Member groups are team-defined labels you attach to members — a member can hold
several at once. They are **pure labels**: they never enter the role ladder, so
nothing about what anyone can do inside Prism changes when you hand one out.
Their entire purpose is to ride along with member information to the apps your
team connects, so those apps can authorize on them.

Off by default. Only the team owner can turn them on, under
**Teams → \<team\> → Settings → Member groups**.

### Groups vs. sub-teams

Both can drive group-based authorization downstream, so it's worth being
explicit about which one fits:

|                                     | Sub-team                          | Member group                     |
| ----------------------------------- | --------------------------------- | -------------------------------- |
| Independent entity (own page, id)   | yes                               | no — a label inside one team     |
| Can own apps and domains            | yes                               | no                               |
| Cardinality                         | tree, depth-capped                | flat, many-per-member            |
| Affects Prism's own authorization   | **yes** — roles cascade with it   | **no**                           |
| Shape in claims                     | its own `in_team_<sub-team-id>`   | `groups_in_team_<team-id>` array |
| Can be granted to an app on its own | yes, it has its own `team:` scope | no, rides with member info       |
| Membership vs. the parent team      | may be a different set of people  | always a subset of the members   |

Split **organisation and resources** with a sub-team; label **attributes of the
same set of people** with a group. Using sub-teams as labels is the trap worth
naming: every "label" becomes another team id in the claims, and because
membership cascades downward the person you only meant to tag ends up holding a
role there too.

### Defining and assigning

Definitions live under **Teams → \<team\> → Groups**. Each has:

| Field       | Notes                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| `slug`      | The stable identifier apps authorize on. **Immutable** — renaming would silently break downstream policies. |
| `name`      | Display label, freely editable.                                                                             |
| description | Optional, for humans.                                                                                       |
| colour      | Optional `#rrggbb`, used for the badge.                                                                     |

Limits: 50 groups per team, 20 groups per member, slug ≤ 32 characters of
lowercase alphanumerics and single hyphens.

Assign from the members table — the tag button on a member row. The dialog
sends the full desired set and the server reconciles it, permission-checking
only the groups that actually change.

### Who can manage and assign

Owners and co-owners always can. What **admins** may do is configurable by the
owner, resolved through a chain where each level only contributes the keys it
explicitly sets:

```
per-group admin_assignable   →  team role_permissions  →  site default  →  built-in
(assignment only)               (Groups → Admin           (default_team_    (manage: off
                                 permissions)              role_permissions)  assign: on)
```

| Capability      | What it covers                      | Built-in default |
| --------------- | ----------------------------------- | ---------------- |
| `groups:manage` | Create, edit and delete definitions | off              |
| `groups:assign` | Attach and detach groups on members | on               |

The per-group `admin_assignable` override exists so a team that generally lets
admins hand out labels can still reserve a sensitive one for owners.

::: warning The switches themselves are owner-only
Toggling the feature, editing `role_permissions`, and setting a per-group
`admin_assignable` are all restricted to the owner — deliberately, and not
merely to "admin and above". A capability set that the constrained role could
edit would be no constraint at all: an admin would simply grant themselves
whatever the owner withheld.
:::

### Inheritance

Groups flow down the sub-team tree the same way roles do: a member of an
ancestor team carries that team's labels on every descendant, flagged with
`inherited_from` so the UI can render them read-only. Inherited labels are
managed at the team they come from.

This rides on the same `inherit_team_membership` switch as role inheritance —
when ancestors and descendants are decoupled for membership, labels stop
crossing that boundary too.

### Turning them off

Switching the feature off **hides, it does not erase**. Definitions and
assignments stay in the database; every read surface simply stops emitting
them, so connected apps see no groups from the next token refresh onward.
Turning it back on restores every assignment exactly as it was.

The same holds along the inheritance chain: an ancestor with groups switched
off contributes nothing to its descendants, so a disabled team's labels can't
leak out through its children.

::: tip Downstream effect
Because apps authorize on these labels, disabling the feature (or deleting a
group) makes downstream authorization **stricter**, not looser — the affected
users simply stop presenting the label.
:::

### Where they show up

| Surface                              | Shape                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `GET /api/teams/:id` (session)       | `members[].groups` — `{slug, name, color, inherited_from}`                 |
| `GET /api/oauth/me/team/:id/members` | same, under `team:<id>:member:read`                                        |
| `.../members/:userId/profile`        | same, under `team:<id>:member:profile:read`                                |
| ID token / userinfo                  | `groups_in_team_<id>` — array of slugs; `teams[].groups` via `oidc_fields` |

No new OAuth scope: groups ride along with the member information an app is
already trusted to read. An app already holding `team:<id>:member:read` starts
seeing groups on its next call without re-consent — the trade-off accepted
because these are team-authored labels, not personal data. Management and
assignment are dashboard-only; `team:<id>:member:write` does **not** grant them.

Team `role_permissions` never leave the dashboard API — downstream apps see
which labels a member holds, not how the team configured who may hand them out.

## Team-owned apps and domains

OAuth apps can be created directly under a team (**Teams → \<team\> → Apps → New**)
or transferred in from a member's personal apps (**Apps → \<app\> → Settings →
Transfer**). Personal apps that are transferred in are reassigned in-place —
the `client_id` and `client_secret` remain valid, so partner integrations don't
break.

Domains work the same way. A domain verified on a personal account can be
shared with a team (`POST /api/teams/:id/domains/:domainId/share-to-team`) and
later moved back (`/share-to-personal`), or fully transferred (`/to-personal`)
to remove the team's edit access.

## Team-as-user storage

Every team has a synthetic `users` row with `kind = 'team'` and `id` matching
`teams.id`. This row exists only so `oauth_apps.owner_id` joins to a single
table for both personal and team apps — it has no password, no sessions, no
social connections, and cannot log in. The synthetic email and username
(`team-<id>@teams.invalid` / `team:<id>`) are colon-prefixed to guarantee they
can never collide with a real registration.

When a team is disbanded, `dissolveTeam` first reassigns any remaining
team-owned apps to the team's owner (or, if there's no owner row, to the
deleting admin). This survives the cascading delete on `oauth_apps.owner_id`.

## Public team profiles

Like users, teams are private by default. The team owner (or admin) explicitly
opts the team in at **Teams → \<team\> → Settings → Public profile**, then picks
which sections to expose. Site-wide defaults and the master `enable_public_profiles`
kill switch live in [Configuration](configuration.md#public-profiles). See
[Public Profiles](public-profile.md) for the full per-section breakdown.

A team's public page links to the owner's `/u/<username>` page only when _both_
profiles are public. If the owner's profile is private, the team page shows the
display name without a link.

## OAuth scopes

Three scope families touch teams, with very different blast radius. The full
table with consent rules and worked examples is in
[OAuth → Team scopes — three tiers](oauth.md#team-scopes-three-tiers); the
short version:

### Aggregate `teams:*`

Acts on **every team the user is a member of** at once. One consent covers all
of them. Endpoints under `/api/oauth/me/teams[/...]`.

| Scope          | Grants                                                               |
| -------------- | -------------------------------------------------------------------- |
| `teams:read`   | List team memberships and roles                                      |
| `teams:create` | Create a new team                                                    |
| `teams:write`  | Update team settings; add and remove members across the user's teams |
| `teams:delete` | Delete a team (owner only — checked at request time)                 |

Right shape for: "what teams is this user in?" use cases — workspace pickers,
syncing membership lists, OIDC IdP claims for Cloudflare Access policies.

### Single-team `team:*`

Acts on **exactly one team**, picked by the user at consent time. Prism
rewrites `team:read` → `team:<team-id>:read` (via `bindTeamScopes()`) before
issuing the token, so the token can only ever touch that team. Endpoints
under `/api/oauth/me/team/:teamId/...`.

| Requested                  | Bound form                      | Grants                                         |
| -------------------------- | ------------------------------- | ---------------------------------------------- |
| `team:read`                | `team:<id>:read`                | Read the team's settings                       |
| `team:write`               | `team:<id>:write`               | Update the team's settings                     |
| `team:delete`              | `team:<id>:delete`              | Disband the team                               |
| `team:member:read`         | `team:<id>:member:read`         | List members and their roles                   |
| `team:member:write`        | `team:<id>:member:write`        | Add/remove members and change roles            |
| `team:member:profile:read` | `team:<id>:member:profile:read` | Read a member's profile through the team scope |

Two extra rules at consent time (see `worker/routes/oauth.ts:830-859`):

- The user must be `owner`, `co-owner`, or `admin` of the chosen team.
- `team:delete` additionally requires `owner` or `co-owner` — admins can grant
  reads/writes but only the people who could actually disband the team can
  grant deletion.

`team:member:write` also can't escalate beyond what the granting user could do
themselves: an admin granting it cannot give the app the ability to promote
past `admin` — the cap is enforced on every member mutation.

Each grant is audited in `team_scope_grants` (team id + permissions),
independent of the OAuth consent record.

Right shape for: an integration scoped to a single team — a deploy bot for one
workspace, a chatbot for one team's channel, etc.

### Cross-instance `site:team:*`

Cross-team admin access without a per-team consent. Granting requires the
user to be a site admin and goes through the
[site-scope confirmation flow](oauth.md#site-scopes-admin-only) (2FA + the
exact phrase `grant site access`). Use only for site-administration tools.

### `oidc_fields` claim

The same `oidc_fields` mechanism that surfaces user role in ID tokens also
emits per-team claims when an app declares them — useful for Cloudflare Access
policies that depend on team membership. The `teams:read` scope unlocks the
flat `teams` claim plus the `in_team_<id>` / `role_in_team_<id>` per-team
markers, and `groups_in_team_<id>` for teams using
[member groups](#member-groups). See the
[Cloudflare Access integration](oauth.md#cloudflare-access) for details.

### Picking a tier

- Use **`teams:*`** when the integration cares about the user's whole team
  graph (membership sync, claim mapping).
- Use **`team:*`** when the integration scopes to one workspace at a time —
  the smaller blast radius is worth the team-id picker on the consent screen.
- Don't request `teams:*` and `team:*` together: you'll get the union, but the
  consent UX shows both an all-teams notice and a team-id picker on the same
  screen, which confuses users.
- Reserve **`site:team:*`** for site-administration tooling — anything granted
  there bypasses individual team owners' consent.

## Endpoint summary

See [API → Teams](api.md#teams) for the full table. The most-used endpoints:

```
GET    /api/teams                            list memberships (expanded with inherited)
POST   /api/teams                            create (optionally with parent_team_id)
PATCH  /api/teams/:id                        update settings, requirements, parent_team_id
GET    /api/teams/:id                        team + ancestors + sub_teams summary
GET    /api/teams/:id/sub-teams              list immediate children
POST   /api/teams/:id/sub-teams              create a sub-team under :id
GET    /api/teams/:id/members                list members (direct only) — paginated, ?q= and ?group=
POST   /api/teams/:id/members                add by username/id
PATCH  /api/teams/:id/members/:userId        change role
DELETE /api/teams/:id/members/:userId        remove (or leave with self)
GET    /api/teams/:id/groups                 list group definitions + capabilities
POST   /api/teams/:id/groups                 create a group
PATCH  /api/teams/:id/groups/:groupId        rename / recolour (slug immutable)
DELETE /api/teams/:id/groups/:groupId        delete (unassigns everywhere)
PUT    /api/teams/:id/members/:userId/groups replace a member's group set
POST   /api/teams/:id/transfer-ownership     transfer to a co-owner (direct owner only)
GET    /api/teams/join/:token                preview an invite (auth optional)
POST   /api/teams/join/:token                accept
```
