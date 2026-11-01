---
title: Notifications
description: Email, Telegram, and Discord notifications fired on user-account events. Per-event preferences, named rulesets, and the rule engine.
---

# Notifications

Prism delivers notifications to users on security-relevant events — app
changes, domain lifecycle, security factor changes, OAuth consent
grants/revokes, team membership, and more — to end-user channels (email,
Telegram, Discord). Every user picks which events fire and where. For the
full record of these events (with scoped webhooks to arbitrary destinations),
see [Audit Logs](audit-logs.md).

Two ways to configure exist side-by-side:

- **Preferences** — a flat per-event `brief|full` map. Simple, fast to set up.
- **Rulesets** — named, ordered match/action arrays with account filtering and
  `stop` semantics. More expressive when you want to mute a single event for
  one address while keeping the rest of the firehose, or split brief vs. full
  delivery between channels.

The rule engine evaluates rulesets first; the flat preferences map is preserved
for backwards compatibility and read in the absence of a ruleset.

## Events

| Event                                   | Triggered when                                   |
| --------------------------------------- | ------------------------------------------------ |
| `app.created` / `updated` / `deleted`   | Your OAuth app changed                           |
| `domain.added` / `verified` / `deleted` | Your domain changed                              |
| `connection.added` / `removed`          | Social connection added or removed               |
| `connection.login`                      | A login completed via a linked social connection |
| `profile.updated`                       | Display name, avatar, etc. changed               |
| `security.passkey_added` / `_removed`   | Passkey added/removed                            |
| `security.totp_enabled` / `_disabled`   | TOTP authenticator enrolled/removed              |
| `token.created` / `revoked`             | Personal access token created/revoked            |
| `team.member_added` / `_removed`        | You were added to or removed from a team         |
| `oauth.consent_granted` / `_revoked`    | OAuth consent granted to or revoked from an app  |

The set is mirrored in `worker/lib/notifications.ts → USER_NOTIFICATION_EVENTS`.
Webhooks subscribe to the same names — this catalogue is the single source of
truth for "things you can be notified about."

## Levels

Each delivery has a level:

- **`brief`** — minimum: event name + when it happened + the resource label
  (app name, domain, etc.).
- **`full`** — includes the same context + a permalink + IP, user agent, and
  related metadata (e.g. for `connection.login`, the source slug + provider
  username + new-device flag).

## Channels

| Channel  | Configured via                                                                                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email    | The user's verified primary email plus any verified secondary emails on `user_emails`. The HTML body is XSS-safe by construction (every interpolated string is HTML-escaped). |
| Telegram | A linked Telegram social connection. Prism sends with the bot token from the enabled Telegram OAuth source selected by `tg_notify_source_slug`.                               |
| Discord  | A linked Discord social connection. Prism uses the Discord OAuth source selected by `discord_notify_source_slug` for user IDs, and sends DMs with `discord_bot_token`.        |

If `tg_notify_source_slug` is empty, Telegram delivery is disabled site-wide
even when users have Telegram channels in their rules. If either
`discord_notify_source_slug` or `discord_bot_token` is empty, Discord delivery
is disabled site-wide. The site's email provider must be configured for email
delivery to function.

## Flat preferences

The legacy / simple form. Stored on `user_notification_prefs.events` (and the
Telegram-only mirror `tg_events`) as a `Record<string, "brief"|"full">`. Any
event not listed is "off."

`GET /api/user/me/notifications`:

```json
{
  "email_events": {
    "app.created": "full",
    "security.totp_enabled": "brief"
  },
  "tg_events": {
    "connection.login": "full"
  }
}
```

`PUT /api/user/me/notifications` accepts the same shape and replaces the
stored preferences atomically.

The legacy `string[]` shape (every event treated as `"full"`) is still
parsed by `parsePrefsEvents` for forward-compat with old data.

## Rulesets

A ruleset is an ordered array of rules. When an event fires the engine walks
top-to-bottom, applies the action of every rule that matches, and returns the
deduped delivery list to actually send to. Only one ruleset can be active; while
one is, it replaces the flat preferences.

In the UI each ruleset has its own page (**Notifications → Rulesets**), and
each rule has its own page with a visual expression builder, a raw expression
editor, the action, its place in the order, and a live test against a made-up
event. The ruleset page's **Trace** runs every rule against a made-up event and
shows which matched and where the notification would go; it uses the same
evaluator as dispatch (`shared/notificationRules.ts`).

### Rule shape

```json
{
  "id": "rule_xyz",
  "name": "Security events from outside the office",
  "enabled": true,
  "match": {
    "expression": "event.category eq \"security\" and not ip.src in {10.0.0.0/8}"
  },
  "action": {
    "type": "send",
    "channels": [{ "kind": "tg", "connection_id": "tg_abc", "level": "full" }]
  },
  "stop": false
}
```

| Field                         | Meaning                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                          | Stable rule identifier                                                                                                                                  |
| `name`                        | Human-readable label (≤ 64 chars, optional)                                                                                                             |
| `enabled`                     | `false` skips the rule without affecting state                                                                                                          |
| `match.expression`            | Rule expression (below). Empty or missing matches every event. Stored in canonical form                                                                 |
| `match.event`                 | Legacy glob, still honoured: `*` matches everything, `?` one character, otherwise literal and anchored. ANDed with `match.expression` when both are set |
| `match.accounts`              | Optional. Each entry is `email:<email_id>`, `tg:<connection_id>`, or `discord:<connection_id>`. Limits the rule's _effect_ to those accounts only       |
| `action.type`                 | `send` (append channels) or `drop` (clear delivery so far)                                                                                              |
| `action.channels` (send only) | Array of `{ kind: "email", email_id, level }`, `{ kind: "tg", connection_id, level }`, or `{ kind: "discord", connection_id, level }`                   |
| `stop`                        | `true` halts evaluation after this rule matches                                                                                                         |

### Rule expressions

The syntax follows Cloudflare's Rules language, cut down to what a notification
carries. The parser, type checks and evaluator are in
`shared/ruleExpression.ts`, shared by the Worker and the frontend.

```
event.category eq "security" and not ip.src in {10.0.0.0/8 192.168.0.0/16}
(resource.name wildcard "prod-*" or http.user_agent contains "curl")
time.hour in {0..6 22..23} and starts_with(event, "connection.")
```

| Field                    | Type   | Value                                                                                 |
| ------------------------ | ------ | ------------------------------------------------------------------------------------- |
| `event`                  | string | Event name, e.g. `security.passkey_added`                                             |
| `event.category`         | string | Part before the dot: `app`, `domain`, `connection`, `profile`, `security`, `token`, … |
| `ip.src`                 | IP     | IP address of whoever caused the event (`CF-Connecting-IP`)                           |
| `ip.src.country`         | string | Two-letter country of that address (`CF-IPCountry`); empty when unknown               |
| `http.user_agent`        | string | Their User-Agent                                                                      |
| `resource.name`          | string | What the event is about: app, domain, team, token, passkey or provider name           |
| `oauth.scopes`           | array  | Scopes granted (`oauth.consent_granted`)                                              |
| `profile.changed_fields` | array  | Fields changed (`profile.updated`)                                                    |
| `time.hour`              | int    | Hour of the event, 0–23, UTC                                                          |
| `time.weekday`           | int    | Day of the event, 1 (Monday) – 7 (Sunday), UTC                                        |

| Type   | Comparisons                                                                                 |
| ------ | ------------------------------------------------------------------------------------------- |
| string | `eq` `ne` `contains` `wildcard`, `in {"a" "b"}`, `starts_with(f, "x")`, `ends_with(f, "x")` |
| IP     | `eq` `ne`, `in {203.0.113.7 10.0.0.0/8 2001:db8::/32}` (IPv4 and IPv6, CIDR in sets)        |
| int    | `eq` `ne` `lt` `le` `gt` `ge`, `in {1 2 9..17}` (ranges in sets)                            |
| array  | `contains "x"` (any element equals), `in {"a" "b"}` (any element in the set)                |

- Logic: `and` / `&&`, `or` / `||`, `not` / `!`, parentheses. `not` binds
  tighter than `and`, which binds tighter than `or`. `==`, `!=`, `<`, `<=`, `>`,
  `>=` mean `eq`, `ne`, `lt`, `le`, `gt`, `ge`.
- Strings are double-quoted; `\"` and `\\` escape. Comparisons are
  case-sensitive except `wildcard`, which is case-insensitive and supports `*`
  only.
- A field with no value (no country, an event without scopes) only satisfies
  `ne`.
- Limits: 4096 characters, 200 conditions, 100 values per set, 512 characters
  per string, nesting depth 32. No user input is compiled into a regular
  expression; wildcard matching is linear.

The builder edits expressions that are OR-ed groups of AND-ed conditions (each
condition one comparison, optionally `not contains` / `not … in`); anything
else, such as `not (a or b)`, is edited as text.

### Evaluation rules

- Multiple `send` rules accumulate. Encountering the same channel at a higher
  level upgrades it (`full > brief`).
- `drop` clears the delivery set built up so far. Combined with a more
  permissive rule above, this lets you say "everything to my main email,
  except domain events to the burner."
- `match.accounts` filters the _effect_ of the rule, not its match condition.
  A `send` rule with scoped accounts silently skips channels that don't belong
  to those accounts. A `drop` rule with scoped accounts only clears the listed
  accounts — others pass through as if the rule hadn't fired. The UI's "Mute
  only these destinations" writes this.
- `stop: true` halts evaluation. Useful as a tail-anchor to keep more general
  rules below from undoing the current one.
- Disabled rules, and rules whose expression no longer parses, are skipped.

### Worked example

```json
[
  {
    "id": "1",
    "name": "Everything to primary email",
    "match": {},
    "action": {
      "type": "send",
      "channels": [{ "kind": "email", "email_id": "primary", "level": "full" }]
    }
  },
  {
    "id": "2",
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
    "id": "3",
    "name": "Quiet nights, except security",
    "match": {
      "expression": "time.hour in {0..6} and event.category ne \"security\""
    },
    "action": { "type": "drop" },
    "stop": true
  }
]
```

`connection.login` from the US at 14:00 UTC → primary email + Telegram.
`app.created` at 03:00 UTC → nothing (rule 3 cleared what rule 1 added).
`security.totp_disabled` at 03:00 UTC → primary email.

### Endpoints

```
GET    /api/user/me/notification-rulesets
POST   /api/user/me/notification-rulesets
PUT    /api/user/me/notification-rulesets/:id
DELETE /api/user/me/notification-rulesets/:id
```

`POST` and `PUT` validate the rules array via `sanitizeRulesArray`:

- Max 200 rules.
- Unknown action types or malformed channels return `400`.
- Unknown event names in `match.event` return `400` (any event in
  `USER_NOTIFICATION_EVENTS` is accepted, plus the `*` and `?` glob forms).
- An expression that doesn't parse returns `400` with
  `rule_expression_<reason>` (`unexpected_end`, `unexpected_token`,
  `unterminated_string`, `unknown_field`, `bad_operator`, `bad_value`,
  `too_long`, `too_deep`, `too_many_items`) and `params: { field, at, token }`.

## Telegram setup

Telegram login and Telegram notification delivery use the same bot token. The
token lives in the Telegram OAuth source as its `client_secret`.

1. Open Telegram and chat with `@BotFather`.
2. Run `/newbot`, choose a display name and username, then copy the HTTP API token.
3. Run `/setdomain`, select the bot, and enter the public Prism domain, for example `prism.example.com`. Telegram Login will reject callbacks from domains not registered here.
4. In Prism, go to **Admin → OAuth Sources → Add Source**.
5. Select **Telegram**, set a slug such as `telegram`, paste the bot token into the secret/token field, and keep the source enabled.
6. Go to **Admin → Settings → Email & notifications → Chat notifications**.
7. Pick the Telegram OAuth source under **Telegram** and save. This sets `tg_notify_source_slug`.
8. Each user who wants Telegram delivery opens **Linked Accounts**, connects Telegram through the same bot/domain, then enables Telegram channels on **Notifications**.

Delivery details:

- Prism sends with `https://api.telegram.org/bot<TOKEN>/sendMessage`.
- The linked Telegram connection's `provider_user_id` is used as `chat_id`.
- Users usually need to have authorized the Telegram Login widget for Prism before Prism can message them.

Telegram messages are plain text with an inline link back to the relevant page
in Prism.

## Discord setup

Discord OAuth login and Discord bot delivery are separate Discord credentials.
The OAuth source stores the OAuth client ID/secret used to link accounts. The
notification sender must use a bot token from the same Discord application, set
as `discord_bot_token` in Prism.

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create or select the application used for Prism Discord login.
2. Under **OAuth2 → General**, copy the **Client ID** and **Client Secret**. Add this redirect URL: `https://your-domain/api/connections/<slug>/callback`.
3. In Prism, go to **Admin → OAuth Sources → Add Source**, select **Discord**, set a slug such as `discord`, paste the OAuth Client ID/Secret, and keep the source enabled.
4. Back in Discord Developer Portal, open **Bot** for the same application.
5. Create a bot if one does not exist, click **Reset Token** if needed, and copy the bot token. This token is not the OAuth client secret.
6. In Prism, go to **Admin → Settings → Email & notifications → Chat notifications**, pick the Discord OAuth source under **Discord**, paste the bot token into **Discord bot token**, and save. This sets `discord_notify_source_slug` and `discord_bot_token`.
7. Each user who wants Discord delivery opens **Linked Accounts**, connects Discord, then enables Discord channels on **Notifications**.

Delivery details:

- Prism first calls `POST /users/@me/channels` with `Authorization: Bot <token>` and the linked user's Discord ID.
- Prism then posts the notification to the returned DM channel.
- Discord can reject DMs if the user blocks the bot, disables DMs from shared servers, or if Discord's platform policy/rate limits prevent opening a DM. Prism silently skips failed DM attempts because notifications run asynchronously.

## Email rendering

Email bodies are HTML with a small inline header and a `<table>` of context
rows. Every dynamic value goes through `esc()` (escapes `& < > " '`) before
interpolation, and every link is filtered through `safeHref()` (only `http:` /
`https:` URLs survive). The plaintext alternative is generated automatically
from the same data.

## Privacy notes

- The full level deliberately includes IP and user agent on security-relevant
  events (`security.*`, `connection.login`, `token.*`) so users can spot
  unfamiliar logins. Choose `brief` if you don't want that information landing
  in your inbox.
- Telegram messages travel via Telegram's servers. Anything you wouldn't put
  in a Telegram chat shouldn't be in a `full`-level Telegram delivery — pick
  `brief` for those events instead.
