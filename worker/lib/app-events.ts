// App-level event delivery — fires webhooks and writes to the SSE/WS queue.
//
// Events:
//   user.token_granted  — a user authorised this app
//   user.token_revoked  — a user revoked access to this app
//   user.updated        — a user with an active token updated their profile

import { randomId } from "./crypto";
import { deliverOnce } from "./webhooks";

export const APP_EVENT_TYPES = new Set([
  "user.token_granted",
  "user.token_revoked",
  "user.updated",
]);

/**
 * Enqueue an event for SSE/WS streaming and deliver it to any matching
 * app webhooks.  Call with `.catch(() => {})` at the call site so failures
 * never surface to users.
 */
export async function deliverAppEvent(
  db: D1Database,
  appId: string,
  event: string,
  data: unknown,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ event, timestamp: now, data });

  // 1. Store in SSE/WS queue (rowid auto-increments — used as cursor).
  await db
    .prepare(
      "INSERT INTO app_event_queue (app_id, event_type, payload, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(appId, event, payload, now)
    .run();

  // 2. Deliver to matching app webhooks.
  const { results } = await db
    .prepare(
      "SELECT id, url, secret, events FROM app_webhooks WHERE app_id = ? AND is_active = 1",
    )
    .bind(appId)
    .all<{ id: string; url: string; secret: string; events: string }>();

  const matching = results.filter((wh) => {
    const evts: string[] = JSON.parse(wh.events);
    return evts.includes("*") || evts.includes(event);
  });

  await Promise.all(
    matching.map(async (wh) => {
      const deliveryId = randomId();
      const result = await deliverOnce(
        wh.url,
        wh.secret,
        deliveryId,
        event,
        payload,
      );
      await db
        .prepare(
          `INSERT INTO app_webhook_deliveries
             (id, webhook_id, event_type, payload, response_status, response_body, success, delivered_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          deliveryId,
          wh.id,
          event,
          payload,
          result.status,
          result.response,
          result.success ? 1 : 0,
          now,
        )
        .run();
    }),
  );
}

/**
 * Purge queue entries older than `maxAgeSeconds` (default 24 h).
 * Called from the scheduled handler.
 */
export async function purgeAppEventQueue(
  db: D1Database,
  maxAgeSeconds = 86_400,
): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
  await db
    .prepare("DELETE FROM app_event_queue WHERE created_at < ?")
    .bind(cutoff)
    .run();
}
