---
title: Webhooks
description: Receive real-time HTTP notifications when events occur in Prism.
---

# Webhooks

Prism can send an HTTP POST request to a URL of your choice whenever a significant event
occurs. Webhooks come in two scopes:

- **User webhooks** — configured by any user; fire when _that user_ triggers events
  (app created/updated/deleted, domain added/verified/deleted, profile updated).
- **Admin webhooks** — configured by admins only; fire on audit log events such as
  user deletions, configuration changes, and so on.

Both share the same payload format, signing mechanism, and delivery behaviour.

## How it works

1. A webhook is created with an endpoint URL, a secret, and a list of subscribed events.
2. When a matching event is triggered, Prism sends a signed JSON payload to the URL.
3. Prism records the HTTP response and stores it in the delivery history for that webhook.

Deliveries are **best-effort** and **non-blocking** — the originating request is not
delayed. If your endpoint is unreachable, the failure is logged in the delivery history
but not retried automatically.

## User webhooks

Any authenticated user can manage personal webhooks from **Settings → Webhooks** in
the dashboard.

| Field    | Description                                                                                |
|----------|--------------------------------------------------------------------------------------------|
| Name     | A human-readable label for this webhook                                                    |
| Endpoint | The HTTPS URL that will receive the POST requests                                          |
| Secret   | Used to sign the payload. Leave blank to have Prism auto-generate a 32-byte random secret. |
| Events   | One or more event types to subscribe to, or `*` to receive every event                     |

The secret is shown only once at creation time — store it somewhere safe.

### User events

| Event             | Triggered when                                |
|-------------------|-----------------------------------------------|
| `*`               | Wildcard — matches every user event below     |
| `app.created`     | You created an OAuth application              |
| `app.updated`     | You updated an OAuth application              |
| `app.deleted`     | You deleted an OAuth application              |
| `domain.added`    | You added a domain for verification           |
| `domain.verified` | A domain you own was successfully verified    |
| `domain.deleted`  | You deleted a domain                          |
| `profile.updated` | You updated your profile (name, avatar, etc.) |

### User webhook API

User webhooks can also be managed programmatically using OAuth Bearer tokens or Personal
Access Tokens with the appropriate scopes:

| Scope            | Grants                                                       |
|------------------|--------------------------------------------------------------|
| `webhooks:read`  | List webhooks and view delivery history                      |
| `webhooks:write` | Create, update, delete, and send test pings to your webhooks |

#### Endpoints

```
GET    /api/oauth/me/webhooks
POST   /api/oauth/me/webhooks
PATCH  /api/oauth/me/webhooks/:id
DELETE /api/oauth/me/webhooks/:id
POST   /api/oauth/me/webhooks/:id/test
GET    /api/oauth/me/webhooks/:id/deliveries
```

#### Example: Create a user webhook

```bash
curl -X POST https://your-prism.example/api/oauth/me/webhooks \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My App Monitor",
    "url": "https://example.com/hooks/prism",
    "events": ["app.created", "app.deleted"]
  }'
```

Response:

```json
{
  "webhook": {
    "id": "abc123",
    "name": "My App Monitor",
    "url": "https://example.com/hooks/prism",
    "secret": "prism-generated-secret",
    "events": ["app.created", "app.deleted"],
    "is_active": 1,
    "created_at": 1741564800
  }
}
```

The `secret` is returned only on creation. Store it securely.

## Admin webhooks

Admins can manage site-wide webhooks from **Admin → Webhooks** in the admin panel.
These fire on audit log events and are not visible to regular users.

### Admin events

| Event                 | Triggered when                                    |
|-----------------------|---------------------------------------------------|
| `*`                   | Wildcard — matches every admin event below        |
| `admin.config.update` | Site configuration was changed                    |
| `admin.user.update`   | An admin updated a user account                   |
| `admin.user.delete`   | An admin deleted a user account                   |
| `admin.app.update`    | An admin updated an OAuth app (verify/deactivate) |
| `admin.team.delete`   | An admin deleted a team                           |
| `invite.create`       | A site invite was created                         |
| `invite.revoke`       | A site invite was revoked                         |
| `oauth_source.create` | An OAuth provider source was added                |
| `oauth_source.update` | An OAuth provider source was updated              |
| `oauth_source.delete` | An OAuth provider source was deleted              |
| `webhook.create`      | A webhook was created                             |
| `webhook.update`      | A webhook was updated                             |
| `webhook.delete`      | A webhook was deleted                             |

### Admin webhook API

| Scope                   | Grants                                          |
|-------------------------|-------------------------------------------------|
| `admin:webhooks:read`   | List webhooks and view delivery history         |
| `admin:webhooks:write`  | Create, update, and send test pings to webhooks |
| `admin:webhooks:delete` | Permanently delete webhooks                     |

#### Endpoints

```
GET    /api/oauth/me/admin/webhooks
POST   /api/oauth/me/admin/webhooks
GET    /api/oauth/me/admin/webhooks/:id
PATCH  /api/oauth/me/admin/webhooks/:id
DELETE /api/oauth/me/admin/webhooks/:id
POST   /api/oauth/me/admin/webhooks/:id/test
GET    /api/oauth/me/admin/webhooks/:id/deliveries
```

All endpoints require a Bearer token whose owner has `role = admin`.

#### Example: Create an admin webhook

```bash
curl -X POST https://your-prism.example/api/oauth/me/admin/webhooks \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Webhook",
    "url": "https://example.com/hooks/prism",
    "events": ["admin.user.delete", "admin.user.update"]
  }'
```

## Payload format

Both user and admin webhooks send the same JSON structure:

```json
{
  "event": "app.created",
  "timestamp": 1741564800,
  "data": {
    "app_id": "xyz789"
  }
}
```

| Field       | Type   | Description                                         |
|-------------|--------|-----------------------------------------------------|
| `event`     | string | The event type that triggered this delivery         |
| `timestamp` | number | Unix timestamp (seconds) of when the event occurred |
| `data`      | object | Event context — IDs, names, and other metadata      |

## Verifying the signature

Every request includes an `X-Prism-Signature` header containing an HMAC-SHA256 hex
digest of the raw request body, signed with your webhook's secret.

```
X-Prism-Signature: sha256=<hex-digest>
X-Prism-Event: app.created
X-Prism-Delivery: <uuid>
```

To verify in Node.js:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verifySignature(secret, rawBody, signatureHeader) {
  const expected = "sha256=" + createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}
```

Always use a **timing-safe comparison** (`timingSafeEqual`) to prevent timing attacks.
Your endpoint should return a `2xx` status to acknowledge receipt; any other status is
recorded as a failure.

## Sending a test ping

From the webhooks list, click the refresh icon on any webhook row to send a
`webhook.test` event immediately. The result (HTTP status and response body) is shown
inline and recorded in the delivery history.

## Delivery history

Expand any webhook row to see its last 50 deliveries. Each entry shows:

- Whether the delivery succeeded (green) or failed (red)
- The HTTP response status code
- The event type
- The time of delivery

## Security recommendations

- **Always verify the signature** before processing a delivery.
- Use **HTTPS** endpoints only — plain HTTP is accepted by Prism but your payload will be visible in transit.
- Respond quickly (within 10 seconds). Prism times out the delivery after 10 s and records a failure.
- Rotate the secret periodically via `PATCH` with a new `secret` value.
- Treat the secret like a password — do not log it or commit it to source control.
