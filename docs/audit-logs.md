# Audit Logs (Transparent Control)

> This document was written by AI and has been manually reviewed.

Prism records security-relevant actions in an append-only audit log split
across three scopes. Each scope is visible only to the people responsible for
it, and each has its own real-time webhooks.

| Scope                            | Who can view                           | What it records                                                                                           |
| -------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Transparent User Control**     | the user, and site admins              | their own login / authorization / revoke / rebind / account changes, plus authorizations of apps they own |
| **Transparent Team Control**     | team owner / co-owner, and site admins | every edit and membership change in the team, plus authorizations of apps the team owns                   |
| **Transparent Platform Control** | platform admins                        | every admin operation                                                                                     |

## Where to find it

- **User** — Dashboard → **Notifications → Audit log** tab.
- **Team** — the team page → **Audit log** tab (between _Invites_ and _Settings_).
- **Platform** — Admin panel → **Audit log** tab.
- **Any user, as an admin** — Admin → Users → Manage → **Audit** tab
  (`GET /api/audit/user/:userId/events`).

### Admin visibility

A site administrator can read every scope. That is not a hole in the model, it
is the other half of it: when an admin acts on a team or an account, the entry
is written into _that_ scope's log — marked `site_admin: true` — so the people
responsible for it can see what was done to them. An operator who could act
without being able to read would produce records nobody ever reconciles.

The one thing that is not offered is signing in as another user. Every admin
action carries the operator's name; a session minted for someone else would
launder those actions into the user's own history.

## Export

Every scope has an export, not just the platform one: a team asked to account
for something needs its own log in a form it can hand over, and a user asking
what an instance holds about them is the same request.

`GET /api/audit/<scope>/export?format=csv|json` takes the same filters as the
table, so what you export is what you were looking at. Capped at 10,000 events
— a truncated export that arrives beats a complete one that times out. CSV
timestamps are ISO strings; the JSON export keeps the raw unix seconds.

## What each event captures

Every event stores and displays:

- **Time** — when it happened.
- **Actor** — the acting user. The resolved name is shown; hover to see the id.
- **Action** — a stable action identifier such as `user.login` or `team.member.add`.
- **Resource** — the affected object, shown resolved (e.g. `user @wyf9`). Hover
  to see the resource type slug and id (e.g. `user / 36b3…`).
- **Request IP** — only the prefix is shown (IPv4 `111.111.*`, IPv6
  `2400:0000:*`); hover to see the full address.
- **Client** — only the parsed client type is shown; hover to see the full
  User-Agent.
- **Inspect** — the button on the right opens a popup with the full event,
  including its raw metadata.

## Filtering

Every audit panel has a **time-range** filter and an **action** filter at the
top. Clicking the actor, action, or resource cell in any row sets the
corresponding filter, and a **Clear filters** button resets them.

## Webhooks

Each audit panel has an **Edit webhooks** button (top-right) that opens the
scoped webhook manager. Webhooks push audit events for that scope to an
external destination in real time. Three presets are available:

### Discord

Fill in a **Webhook URL**. Events are delivered as embed cards.

### Telegram

Fill in a **Bot Token** (required), and optionally a **Chat ID** and a
**Thread ID**. Messages are sent as formatted HTML.

### General Webhook

Fill in a **URL**, **Method** (`GET` / `POST`), **Headers** (a JSON object),
and a **Body** (for `POST`). Every part supports `{placeholder}` interpolation
of dynamic values:

| Placeholder       | Value                             |
| ----------------- | --------------------------------- |
| `{id}`            | event id                          |
| `{action}`        | action identifier                 |
| `{actor_id}`      | acting user id                    |
| `{actor_name}`    | acting user display name          |
| `{resource_type}` | resource type slug                |
| `{resource_id}`   | resource id                       |
| `{resource_name}` | resolved resource name            |
| `{ip}`            | full request IP                   |
| `{user_agent}`    | full request User-Agent           |
| `{timestamp}`     | unix timestamp                    |
| `{metadata}`      | JSON-encoded metadata             |
| `{summary}`       | a one-line human-readable summary |

Each webhook has an **Events** field: a comma-separated list of action names to
deliver, or `*` for every event in the scope.

## Migrating from the old webhook system

The previous instance/user webhook feature has been removed in favour of this
system. Admins can import old webhooks into the new one from **Admin panel →
Settings → Danger Zone → Migrate legacy webhooks** — each legacy webhook becomes
a General Webhook in the matching scope. The action is idempotent and safe to
run more than once.
