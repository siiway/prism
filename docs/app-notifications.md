---
title: App Notifications
description: Real-time event delivery to OAuth applications via webhooks, SSE, and WebSocket.
---

# App Notifications

Prism can notify your OAuth application whenever certain events occur — for example, when
a user grants or revokes your app's access, or when a user's profile changes.

Three delivery channels are available:

| Channel   | Best for                                              |
|-----------|-------------------------------------------------------|
| Webhook   | Server-to-server push; fire-and-forget per event      |
| SSE       | Server-side streaming (Node.js, Bun, Workers)         |
| WebSocket | Bidirectional; works in browsers too                  |

All channels share the same event types and payload format.

## Authentication

SSE and WebSocket connections authenticate with your app's credentials using
**HTTP Basic auth** (`client_id:client_secret`).

For browser WebSocket (where setting headers is not possible), pass the credentials
as query parameters instead:

```
?client_id=<clientId>&client_secret=<clientSecret>
```

Webhook management endpoints require a **user Bearer token** with write access to the app.

## Events

| Event type           | Triggered when                                                  |
|----------------------|-----------------------------------------------------------------|
| `user.token_granted` | A user completes the OAuth consent flow and grants your app access |
| `user.token_revoked` | A user revokes your app's access from their settings           |
| `user.updated`       | A user who has granted your app access updates their profile    |
| `*`                  | Wildcard — subscribe to all of the above                        |

### Payload format

Every event (webhook body, SSE `data:` line, or WebSocket message) is a JSON object:

```json
{
  "event": "user.token_granted",
  "timestamp": 1741564800,
  "data": { ... }
}
```

#### `user.token_granted`

```json
{
  "event": "user.token_granted",
  "timestamp": 1741564800,
  "data": {
    "user_id": "usr_abc123",
    "scopes": ["openid", "profile", "email"],
    "granted_at": 1741564800
  }
}
```

#### `user.token_revoked`

```json
{
  "event": "user.token_revoked",
  "timestamp": 1741564800,
  "data": {
    "user_id": "usr_abc123"
  }
}
```

#### `user.updated`

```json
{
  "event": "user.updated",
  "timestamp": 1741564800,
  "data": {
    "user_id": "usr_abc123",
    "username": "alice",
    "display_name": "Alice"
  }
}
```

---

## Webhooks

Webhooks are registered on a per-app basis. When an event fires, Prism sends a signed
`POST` request to each active webhook URL subscribed to that event type.

### API endpoints

```
GET    /api/apps/:appId/webhooks
POST   /api/apps/:appId/webhooks
PATCH  /api/apps/:appId/webhooks/:webhookId
DELETE /api/apps/:appId/webhooks/:webhookId
POST   /api/apps/:appId/webhooks/:webhookId/test
GET    /api/apps/:appId/webhooks/:webhookId/deliveries
```

All endpoints require `Authorization: Bearer <user-token>` where the token owner has
write access to the app.

### Create a webhook

**POST `/api/apps/:appId/webhooks`**

```json
{
  "url": "https://example.com/hooks/prism",
  "events": ["user.token_granted", "user.token_revoked"],
  "secret": "optional-custom-secret"
}
```

If `secret` is omitted, Prism auto-generates a 32-byte random hex string. The secret
is returned **only in the creation response** — store it securely.

Response:

```json
{
  "id": "wh_xyz789",
  "app_id": "app_abc123",
  "url": "https://example.com/hooks/prism",
  "secret": "prism-generated-or-supplied-secret",
  "events": ["user.token_granted", "user.token_revoked"],
  "is_active": true,
  "created_at": 1741564800,
  "updated_at": 1741564800
}
```

### Verifying the signature

Every webhook request includes an `X-Prism-Signature` header:

```
X-Prism-Signature: sha256=<hex-digest>
X-Prism-Event: user.token_granted
X-Prism-Delivery: <uuid>
```

The digest is HMAC-SHA256 of the raw request body using your webhook secret.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verifySignature(secret, rawBody, signatureHeader) {
  const expected = "sha256=" + createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}
```

Always use a **timing-safe comparison** to prevent timing attacks. Return `2xx` to
acknowledge receipt; any other status is logged as a failure.

### Delivery history

`GET /api/apps/:appId/webhooks/:webhookId/deliveries` returns the last 50 deliveries:

```json
{
  "deliveries": [
    {
      "id": "del_001",
      "webhook_id": "wh_xyz789",
      "event_type": "user.token_granted",
      "response_status": 200,
      "success": true,
      "delivered_at": 1741564800
    }
  ]
}
```

### Test ping

**POST `/api/apps/:appId/webhooks/:webhookId/test`**

Sends a synthetic `ping` event immediately.

```json
{ "success": true, "status": 200 }
```

---

## Server-Sent Events (SSE)

```
GET /api/apps/:appId/events/sse
```

Opens a persistent SSE stream. The server polls for new events every 2 seconds and
flushes them as they arrive.

**Authentication** — HTTP Basic header:

```
Authorization: Basic <base64(clientId:clientSecret)>
```

Or as query parameters (useful when browser `EventSource` cannot set headers):

```
?client_id=<clientId>&client_secret=<clientSecret>
```

**Resuming** — pass the `Last-Event-ID` header (or `?lastEventId=`) to resume from
a known event ID and avoid missing events after reconnection.

Each SSE frame:

```
id: 42
event: user.token_granted
data: {"event":"user.token_granted","timestamp":1741564800,"data":{"user_id":"usr_abc123","scopes":["openid","profile"],"granted_at":1741564800}}

```

---

## WebSocket

```
GET /api/apps/:appId/events/ws
```

Upgrade to a WebSocket connection. The server pushes events as JSON text frames.

**Authentication** — HTTP Basic header or query parameters (same as SSE).

Each message frame:

```json
{
  "event": "user.token_granted",
  "timestamp": 1741564800,
  "data": {
    "user_id": "usr_abc123",
    "scopes": ["openid", "profile"],
    "granted_at": 1741564800
  }
}
```

### Browser example

```js
const ws = new WebSocket(
  `wss://your-prism.example/api/apps/${appId}/events/ws` +
  `?client_id=${clientId}&client_secret=${clientSecret}`
);

ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  console.log(msg.event, msg.data);
});
```

---

## Security recommendations

- Keep your `client_secret` server-side. Never expose it in browser JavaScript or
  mobile app binaries.
- Always verify webhook signatures before processing payloads.
- Respond to webhooks within 10 seconds; Prism times out after 10 s.
- Use `Last-Event-ID` / `lastEventId` when reconnecting SSE to avoid missing events.
- Rotate your `client_secret` if it is ever exposed.
