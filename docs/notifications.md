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
top-to-bottom, applies actions for every match, and returns the deduped
delivery list to actually send to.

### Rule shape

```json
{
  "id": "rule_xyz",
  "name": "Mute domain noise on burner email",
  "enabled": true,
  "match": {
    "event": "domain.*",
    "accounts": ["email:burner-id"]
  },
  "action": {
    "type": "drop"
  },
  "stop": false
}
```

| Field                         | Meaning                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                          | Stable rule identifier (server-generated)                                                                                                         |
| `name`                        | Human-readable label (≤ 64 chars, optional)                                                                                                       |
| `enabled`                     | `false` skips the rule without affecting state                                                                                                    |
| `match.event`                 | Glob: `*` matches everything, `?` matches one character, otherwise literal. Anchored — `app` matches `app`, not `appx`                            |
| `match.accounts`              | Optional. Each entry is `email:<email_id>`, `tg:<connection_id>`, or `discord:<connection_id>`. Limits the rule's _effect_ to those accounts only |
| `action.type`                 | `send` (append channels) or `drop` (clear delivery so far)                                                                                        |
| `action.channels` (send only) | Array of `{ kind: "email", email_id, level }`, `{ kind: "tg", connection_id, level }`, or `{ kind: "discord", connection_id, level }`             |
| `stop`                        | `true` halts evaluation after this rule fires                                                                                                     |

### Evaluation rules

- Multiple `send` rules accumulate. Encountering the same channel at a higher
  level upgrades it (`full > brief`).
- `drop` clears the delivery set built up so far. Combined with a more
  permissive rule above, this lets you say "everything to my main email,
  except domain events to the burner."
- `match.accounts` filters the _effect_ of the rule, not its match condition.
  A `send` rule with scoped accounts silently skips channels that don't belong
  to those accounts. A `drop` rule with scoped accounts only clears the listed
  accounts — others pass through as if the rule hadn't fired.
- `stop: true` halts evaluation. Useful as a tail-anchor to keep more general
  rules below from undoing the current one.

### Worked example

```json
[
  {
    "id": "1",
    "name": "All events to primary email",
    "match": { "event": "*" },
    "action": {
      "type": "send",
      "channels": [{ "kind": "email", "email_id": "primary", "level": "full" }]
    }
  },
  {
    "id": "2",
    "name": "App events also to Telegram, brief",
    "match": { "event": "app.*" },
    "action": {
      "type": "send",
      "channels": [
        { "kind": "tg", "connection_id": "tg_abc", "level": "brief" }
      ]
    }
  },
  {
    "id": "3",
    "name": "Mute domain noise everywhere",
    "match": { "event": "domain.*" },
    "action": { "type": "drop" }
  }
]
```

`security.totp_enabled` → primary email (full). `app.created` → primary email
(full) + Telegram (brief). `domain.verified` → nothing (rule 3 cleared what
rule 1 added).

### Endpoints

```
GET    /api/user/me/notification-rulesets
POST   /api/user/me/notification-rulesets
PUT    /api/user/me/notification-rulesets/:id
DELETE /api/user/me/notification-rulesets/:id
```

`POST` validates the rules array via `sanitizeRulesArray`:

- Max 200 rules.
- Unknown action types or malformed channels return `400`.
- Unknown event names also return `400`. (Any event in `USER_NOTIFICATION_EVENTS`
  is accepted, plus the `*` and `?` glob forms.)

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
