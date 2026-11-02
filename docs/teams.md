---
title: Teams
description: Collaborate on OAuth apps and verified domains. Roles, invites, join requirements, sub-teams and member groups.
---

# Teams

A team is a shared owner for OAuth applications and verified domains. Members
manage the team's apps and domains in the same UI as their personal ones, and
ownership survives any single member leaving.

## Roles

| Role       | Manage members     | Edit team settings | Manage apps/domains                    | Transfer ownership  | Disband |
| ---------- | ------------------ | ------------------ | -------------------------------------- | ------------------- | ------- |
| `owner`    | yes                | yes                | yes                                    | yes (to a co-owner) | yes     |
| `co-owner` | yes (except owner) | yes                | yes                                    | no                  | no      |
| `admin`    | yes (members only) | no                 | yes                                    | no                  | no      |
| `member`   | no                 | no                 | read; write apps if the team allows it | no                  | no      |

Each team has one owner. Transferring ownership demotes the previous owner to
co-owner.

Site administrators have owner-level authority on every team. See
[Admin → Teams](admin.md#teams).

## Joining a team

1. **Direct add** by an admin, co-owner or owner, from **Teams → \<team\> →
   Members → Add member**.
2. **Invite link** from **Members → Generate invite**, optionally locked to an
   email address, limited in uses, and given an expiry. The link opens
   `/teams/join/:token`, which shows the team and any unmet
   [requirements](#join-requirements) before the person accepts.
3. **API** — `POST /api/teams/join/:token`.

Admins can edit, disable or revoke invites they created; co-owners and owners
can manage all of the team's invites. A usage limit can't be lowered below the
current number of uses. An invite can also carry one [member group](#member-groups),
which is assigned when the person joins.

## Join requirements

Team owners can require members to have:

- at least one TOTP authenticator or passkey, and/or
- a verified primary email.

Site admins can set a minimum that applies to every team; owners can require
more but never less. The team settings page greys out anything the site forces.

::: warning Retroactive enforcement
Turning a requirement on applies to existing members immediately. Anyone who
hasn't enrolled is locked out of team operations until they do. Tell members
before you turn one on.
:::

## Sub-teams

A team can be created under another team to mirror an organisation's structure.
Nesting is limited by the site's maximum depth (default 5), and teams can't be
moved in a way that creates a cycle.

Two things pass down from a team to everything beneath it, and each can be
turned off by the site admin:

- **Membership** — a member of a team has at least the same role on every
  sub-team. A direct role on a sub-team stacks on top; the higher one wins.
- **Verified domains** — a sub-team sees its ancestors' domains as read-only
  entries, and a sub-domain of an ancestor's verified domain is verified
  automatically.

Apps stay with the team that created them.

Manage sub-teams from **Teams → \<team\> → Sub-teams**. You need to be an admin
or higher on the parent (direct or inherited) to create one. Moving a team to a
new parent needs the owner of that team and an admin on the new parent. Deleting
a team deletes every sub-team under it; each level's apps go to that level's
own owner.

### Member list visibility

Under **Settings → Member list visibility**, owners and co-owners can limit what
plain members see: only owners, co-owners, admins and themselves. This also
applies to the public team profile and to apps reading the member list.

## Member groups

Member groups are labels you attach to members, and a member can hold several.
They never change what anyone can do in Prism. They ride along with member
information to the apps your team connects, so those apps can make decisions on
them.

They're off by default; the team owner turns them on under **Settings → Member
groups**.

### Groups or sub-teams?

Use a **sub-team** for a separate unit with its own page, apps, domains and
roles. Use a **group** to label an attribute of the same set of people (say,
`oncall`). Using sub-teams as labels adds a team to the claims for every label,
and because membership passes down, the person you only meant to tag also gets a
role there.

### Defining and assigning

Define groups under **Teams → \<team\> → Groups**:

| Field       | Notes                                                             |
| ----------- | ----------------------------------------------------------------- |
| Slug        | What apps check. Can't be changed later, so policies don't break. |
| Name        | Display label; editable.                                          |
| Description | Optional.                                                         |
| Colour      | Optional `#rrggbb` for the badge.                                 |

Limits: 50 groups per team, 20 per member, slugs up to 32 lowercase letters,
digits and single hyphens.

Assign groups from the tag button on a member row. Owners and co-owners can
always define and assign. For admins, the owner chooses whether they can
**manage** groups (default off) and **assign** them (default on), and can
reserve a particular group for owners. Only the owner can change these settings.

Groups pass down to sub-teams the same way roles do, and are managed at the team
they come from.

Switching groups off hides them rather than erasing them: connected apps stop
seeing them from the next token refresh, and turning them back on restores every
assignment. Removing a group, or turning the feature off, only ever makes
downstream access stricter.

### Where apps see them

Groups appear on team member information the app is already allowed to read
(`team:<id>:member:read`, `team:<id>:member:profile:read`), and as a
`groups_in_team_<id>` array of slugs in ID tokens. No extra scope or consent is
needed; management is dashboard-only.

## Invite-link registration

Normally a team invite only admits people who already have a Prism account. A
team that a site admin has authorised can also hand out links that create
accounts, from a page at `/join/<team-id>`. The accounts are **restricted** (see
below), so a large single-purpose group can sign in without each person being
able to create teams, apps and domains.

To use it, a site admin grants the team the ability on its **Moderation** tab.
A team owner can't grant it to themselves. Then tick **Usable for creating new
accounts** when generating an invite. Such an invite:

- must have a finite usage limit, below the site's cap (default 1000);
- always grants the `member` role;
- is rate-limited per hour (default 200), on top of the usual per-IP limit,
  captcha and proof-of-work.

A registrant's account starts pending. It can manage its own security (to
enrol 2FA or verify an email), but can't sign in to any application until it
satisfies the team's requirements and joins. Unfinished registrations are
deleted after 72 hours by default. A seat is used when the account is created,
so an abandoned registration still counts against the limit.

If the site admin exempts the team from email verification, the form doesn't ask
for an address. The account gets a placeholder, and the person must add a real
one before converting to a full account.

## Restricted accounts

Accounts created through invite links are restricted. By default they **can't**
create teams or apps, verify domains, make personal access tokens or GPG keys,
publish a public profile, or convert to a full account. Team features and their
own account security always work. Site admins can lift individual capabilities
(see [Configuration](configuration.md#invite-link-registration)).

A restricted account is confined to its **origin team and that team's
sub-teams**: it can only join those, and can only sign in to apps owned by them.
Joining another team doesn't widen this.

**Converting** — where allowed, the person converts from **Security → Account
type**. It needs a verified real email, keeps their team membership, lifts all
restrictions, and can't be undone. The site default can be overridden per team
on its Moderation tab.

**Dissolving** a team that created accounts deletes those accounts, so only a
site admin can do it, through a staged flow with a grace period (see
[Admin → Invite-link registration](admin.md#invite-link-registration)). The team
is protected from ordinary deletion for as long as it has live restricted
accounts, even if the grant is switched off. Accounts that converted, and
members who joined with their own accounts, are not deleted.

## Team-owned apps and domains

Create an app under a team from **Teams → \<team\> → Apps → New**, or move one in
from your personal apps (**Apps → \<app\> → Settings → Transfer**). A transferred
app keeps its client ID and secret, so integrations don't break.

Only team admins or higher can create an app or rotate its secret. The secret is
shown once, when it's created or rotated.

A personal domain can be shared with a team and later moved back, or fully
transferred to the team.

## Public team profiles

Teams are private by default. The owner or an admin opts the team in at
**Settings → Public profile** and picks which sections to show. See
[Public Profiles](public-profile.md).

## OAuth scopes

Three scope families cover teams. Pick the narrowest one that fits.

| Family        | Example          | Reach                                  | Who can grant it                         |
| ------------- | ---------------- | -------------------------------------- | ---------------------------------------- |
| `teams:*`     | `teams:read`     | Every team the user belongs to         | The user                                 |
| `team:*`      | `team:read`      | One team, chosen on the consent screen | An owner, co-owner or admin of that team |
| `site:team:*` | `site:team:read` | Every team on the instance             | A site admin, after a 2FA confirmation   |

- **`teams:*`** (`read`, `write`, `create`, `delete`) suits workspace pickers,
  membership sync, and ID-token claims for tools like Cloudflare Access.
- **`team:*`** (`read`, `write`, `delete`, `member:read`, `member:write`,
  `member:profile:read`) is bound to the team the user picks, so the token can
  only touch that team. `team:delete` needs an owner or co-owner, and
  `team:member:write` can't promote anyone beyond what the granting user could.
- **`site:team:*`** is for site-administration tools only. See
  [OAuth → Site scopes](oauth.md#site-scopes-admin-only).

Don't request `teams:*` and `team:*` together; the consent screen then shows both
an all-teams notice and a team picker, which confuses users.

The ID token carries `in_team_<id>`, `role_in_team_<id>` and
`groups_in_team_<id>` claims for use in policies. See
[OAuth → ID token](oauth.md#id-token) and the
[Cloudflare Access integration](oauth.md#cloudflare-access).

## API

See [API → Teams](api.md#teams) for the endpoints.
