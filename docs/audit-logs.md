# Audit Logs (Transparent Control)

> This document was written by AI and has been manually reviewed.

Prism records security-relevant actions in an append-only audit log split across three scopes. Each scope is visible only to the people responsible for it, and each has its own real-time webhooks.

| Scope                            | Who can view                           | What it records                                                                                       |
| -------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Transparent User Control**     | the user, and site admins              | their own sign-ins, authorizations, revokes and account changes, plus authorizations of apps they own |
| **Transparent Team Control**     | team owner / co-owner, and site admins | every edit and membership change in the team, plus authorizations of apps the team owns               |
| **Transparent Platform Control** | platform admins                        | every admin operation                                                                                 |

## Where to find it

- **User** — Dashboard → **Notifications → Audit log**.
- **Team** — the team page → **Audit log** tab.
- **Platform** — Admin panel → **Audit log**.
- **Any user, as an admin** — Admin → Users → Manage → **Audit**.

A site administrator can read every scope. When an admin acts on a team or an account, the entry is written into _that_ scope's log, marked `site_admin: true`, so the people affected can see what was done.

## Export

Every scope can be exported, in CSV or JSON, with the same filters as the table you're looking at: `GET /api/audit/<scope>/export?format=csv|json`. Exports are capped at 10,000 events.

## What each event shows

- **Time** — when it happened.
- **Actor** — who did it. Hover to see the ID.
- **Action** — a stable identifier such as `user.login` or `team.member.add`.
- **Resource** — what it affected, by name. Hover for the type and ID.
- **Request IP** — a shortened prefix; hover for the full address.
- **Client** — the client type; hover for the full User-Agent.
- **Inspect** — opens the full event, including its raw metadata.

## Filtering

Every audit panel has a **time-range** filter and an **action** filter. Clicking the actor, action or resource in a row sets that filter. **Clear filters** resets them.

## Webhooks

Each panel has an **Edit webhooks** button that opens the webhook manager. Webhooks push that scope's events to an outside destination in real time. Each has an **Events** field: a comma-separated list of action names, or `*` for everything in the scope.

### Discord

Fill in a **Webhook URL**. Events arrive as embed cards.

### Telegram

Fill in a **Bot Token**, and optionally a **Chat ID** and **Thread ID**. Messages are sent as formatted HTML.

### General Webhook

Fill in a **URL**, **Method** (`GET` or `POST`), **Headers** (a JSON object) and a **Body** (for `POST`). Any of them can include these placeholders:

| Placeholder       | Value                      |
| ----------------- | -------------------------- |
| `{id}`            | event ID                   |
| `{action}`        | action identifier          |
| `{actor_id}`      | acting user ID             |
| `{actor_name}`    | acting user's display name |
| `{resource_type}` | resource type              |
| `{resource_id}`   | resource ID                |
| `{resource_name}` | resource name              |
| `{ip}`            | full request IP            |
| `{user_agent}`    | full request User-Agent    |
| `{timestamp}`     | Unix timestamp             |
| `{metadata}`      | JSON-encoded metadata      |
| `{summary}`       | a one-line summary         |

## Moving from the old webhook system

The earlier instance and user webhooks were replaced by this system. Admins can import them from **Admin → Maintenance → Danger zone → Migrate legacy webhooks**; each becomes a General Webhook in the matching scope. It's safe to run more than once.
