---
title: Notifications
description: Email, Telegram, and Discord notifications fired on user-account events. Per-event preferences, named rulesets, and the rule engine.
---

# Notifications

Prism notifies users about security-relevant events — app changes, domain
changes, security factor changes, OAuth consent grants and revokes, team
membership and more — by email, Telegram and Discord. Each user chooses which
events fire and where. For a full record of events, with webhooks to other
destinations, see [Audit Logs](audit-logs.md).

There are two ways to configure delivery:

- **Preferences** — pick `brief` or `full` for each event. Simple and quick.
- **Rulesets** — ordered rules with conditions. Use these to mute one event for
  one address, route events by country or time of day, or send different levels
  to different channels.

While a ruleset is active it replaces the preferences.

## Events

| Event                                   | Triggered when                                      |
| --------------------------------------- | --------------------------------------------------- |
| `app.created` / `updated` / `deleted`   | Your OAuth app changed                              |
| `domain.added` / `verified` / `deleted` | Your domain changed                                 |
| `connection.added` / `removed`          | Social connection added or removed                  |
| `connection.login`                      | A sign-in completed through a linked social account |
| `profile.updated`                       | Display name, avatar, etc. changed                  |
| `security.passkey_added` / `_removed`   | Passkey added or removed                            |
| `security.totp_enabled` / `_disabled`   | TOTP authenticator added or removed                 |
| `token.created` / `revoked`             | Personal access token created or revoked            |
| `team.member_added` / `_removed`        | You were added to or removed from a team            |
| `oauth.consent_granted` / `_revoked`    | You granted or revoked an app's access              |

## Levels

- **`brief`** — the event, when it happened, and what it was about (app name,
  domain, and so on).
- **`full`** — adds a link, plus IP, user agent and related details (for
  `connection.login`, the source, the provider username and whether it's a new
  device).

`full` deliberately includes the IP address and user agent on security events so
you can spot sign-ins you don't recognise. Choose `brief` if you'd rather not
have that in your inbox or chat. Telegram messages pass through Telegram's
servers, so use `brief` for anything you wouldn't put in a Telegram chat.

## Channels

| Channel  | Delivered to                                                                       |
| -------- | ---------------------------------------------------------------------------------- |
| Email    | The user's verified primary email and any verified secondary emails                |
| Telegram | The user's linked Telegram account, through the site's Telegram bot                |
| Discord  | The user's linked Discord account, as a direct message from the site's Discord bot |

Email needs an email provider configured. Telegram is off for everyone until an
admin picks a Telegram source, and Discord until an admin picks a source and
sets a bot token (both under **Admin → Settings → Email & notifications → Chat
notifications**).

## Rulesets

A ruleset is an ordered list of rules. When an event fires, Prism goes through
the rules from top to bottom, applies every rule that matches, and sends to the
resulting list of destinations. Only one ruleset can be active.

Each ruleset and each rule has its own page under **Notifications → Rulesets**.
A rule can be built visually or written as an expression, and can be tested
against a made-up event. The ruleset's **Trace** runs every rule against a
made-up event and shows which matched and where the notification would go.

### Rule

| Field              | Meaning                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| `name`             | Label (up to 64 characters, optional)                                                                |
| `enabled`          | `false` skips the rule                                                                               |
| `match.expression` | When the rule applies. Empty matches every event                                                     |
| `match.accounts`   | Optional. Limits the rule's _effect_ to these destinations (`email:<id>`, `tg:<id>`, `discord:<id>`) |
| `action.type`      | `send` adds channels; `drop` clears what was collected so far                                        |
| `action.channels`  | For `send`: the destinations and a level (`brief` or `full`) for each                                |
| `stop`             | `true` ends evaluation after this rule matches                                                       |

### Expressions

The syntax follows Cloudflare's Rules language:

```
event.category eq "security" and not ip.src in {10.0.0.0/8 192.168.0.0/16}
(resource.name wildcard "prod-*" or http.user_agent contains "curl")
time.hour in {0..6 22..23} and starts_with(event, "connection.")
```

| Field                    | Type   | Value                                                                  |
| ------------------------ | ------ | ---------------------------------------------------------------------- |
| `event`                  | string | Event name, e.g. `security.passkey_added`                              |
| `event.category`         | string | Part before the dot: `app`, `domain`, `connection`, `security`, …      |
| `ip.src`                 | IP     | IP address of whoever caused the event                                 |
| `ip.src.country`         | string | Two-letter country of that address; empty when unknown                 |
| `http.user_agent`        | string | Their User-Agent                                                       |
| `resource.name`          | string | What the event is about: app, domain, team, token, passkey or provider |
| `oauth.scopes`           | array  | Scopes granted (`oauth.consent_granted`)                               |
| `profile.changed_fields` | array  | Fields changed (`profile.updated`)                                     |
| `time.hour`              | int    | Hour of the event, 0–23, UTC                                           |
| `time.weekday`           | int    | Day of the event, 1 (Monday) – 7 (Sunday), UTC                         |

| Type   | Comparisons                                                                                 |
| ------ | ------------------------------------------------------------------------------------------- |
| string | `eq` `ne` `contains` `wildcard`, `in {"a" "b"}`, `starts_with(f, "x")`, `ends_with(f, "x")` |
| IP     | `eq` `ne`, `in {203.0.113.7 10.0.0.0/8 2001:db8::/32}`                                      |
| int    | `eq` `ne` `lt` `le` `gt` `ge`, `in {1 2 9..17}`                                             |
| array  | `contains "x"`, `in {"a" "b"}`                                                              |

- Combine with `and` / `&&`, `or` / `||`, `not` / `!` and parentheses. `not`
  binds tightest, then `and`, then `or`. `==`, `!=`, `<`, `<=`, `>`, `>=` work
  as `eq`, `ne`, `lt`, `le`, `gt`, `ge`.
- Strings are double-quoted. Comparisons are case-sensitive except `wildcard`,
  which is case-insensitive and supports `*` only.
- A field with no value (no country, no scopes) only satisfies `ne`.
- Expressions are limited to 4096 characters, with at most 200 conditions.
- The visual builder handles OR-ed groups of AND-ed conditions; anything more
  complex, like `not (a or b)`, is edited as text.

### How rules combine

- Several `send` rules add up. If a channel appears at two levels, the higher
  (`full`) wins.
- `drop` clears everything collected so far. Combined with a broad rule above it,
  that lets you say "everything to my main email, except domain events."
- `match.accounts` limits the rule's effect, not whether it matches. A scoped
  `send` skips channels outside those accounts; a scoped `drop` clears only the
  listed accounts. The UI's "Mute only these destinations" sets this.
- `stop: true` keeps rules below from undoing this one.
- Disabled rules, and rules whose expression doesn't parse, are skipped.

### Example

```json
[
  {
    "name": "Everything to primary email",
    "match": {},
    "action": {
      "type": "send",
      "channels": [{ "kind": "email", "email_id": "primary", "level": "full" }]
    }
  },
  {
    "name": "Sign-ins from abroad also to Telegram",
    "match": {
      "expression": "event eq \"connection.login\" and ip.src.country ne \"DE\""
    },
    "action": {
      "type": "send",
      "channels": [{ "kind": "tg", "connection_id": "tg_abc", "level": "full" }]
    }
  },
  {
    "name": "Quiet nights, except security",
    "match": {
      "expression": "time.hour in {0..6} and event.category ne \"security\""
    },
    "action": { "type": "drop" },
    "stop": true
  }
]
```

A `connection.login` from the US at 14:00 UTC goes to the primary email and
Telegram. An `app.created` at 03:00 UTC goes nowhere. A `security.totp_disabled`
at 03:00 UTC goes to the primary email.

### API

Rulesets are managed with `GET`, `POST`, `PUT` and `DELETE` on
`/api/user/me/notification-rulesets[/:id]`; preferences with `GET` and `PUT` on
`/api/user/me/notifications`. A ruleset can have at most 200 rules. An invalid
rule or expression returns `400` with an error code such as
`rule_expression_unknown_field` and `params` saying where.

## Telegram setup

Telegram login and Telegram notifications use the same bot.

1. In Telegram, chat with `@BotFather`, run `/newbot`, and copy the HTTP API token.
2. Run `/setdomain`, select the bot, and enter your Prism domain, e.g.
   `prism.example.com`. Telegram rejects logins from unregistered domains.
3. In Prism, go to **Admin → OAuth Sources → Add Source**, choose **Telegram**,
   set a slug such as `telegram`, and paste the bot token.
4. Go to **Admin → Settings → Email & notifications → Chat notifications** and
   pick that source under **Telegram**.
5. Each user connects Telegram under **Linked Accounts**, then turns on Telegram
   channels under **Notifications**.

Users need to have signed in with the Telegram widget for Prism before the bot
can message them. Messages are plain text with a link back to Prism.

## Discord setup

Discord login and Discord notifications use two different credentials from the
same Discord application: the OAuth client ID and secret (to link accounts) and
a bot token (to send DMs). The bot token is not the OAuth client secret.

1. In the [Discord Developer Portal](https://discord.com/developers/applications),
   create or open the application. Under **OAuth2 → General**, copy the **Client
   ID** and **Client Secret** and add the redirect URL
   `https://your-domain/api/connections/<slug>/callback`.
2. In Prism, go to **Admin → OAuth Sources → Add Source**, choose **Discord**,
   set a slug such as `discord`, and paste the client ID and secret.
3. In the Developer Portal, open **Bot**, create the bot if needed, and copy its
   token (use **Reset Token** if you can't see it).
4. In Prism, go to **Admin → Settings → Email & notifications → Chat
   notifications**, pick the Discord source, paste the bot token, and save.
5. Each user connects Discord under **Linked Accounts**, then turns on Discord
   channels under **Notifications**.

Discord can refuse a DM if the user has blocked the bot or turned off DMs from
shared servers. Prism skips a failed DM silently.
