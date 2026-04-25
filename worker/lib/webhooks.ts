// Webhook delivery — HMAC-signed HTTP POST to registered endpoints

const DELIVERY_TIMEOUT_MS = 10_000;

function randomHex(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export async function hmacSign(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface DeliveryResult {
  status: number | null;
  response: string | null;
  success: boolean;
}

export async function deliverOnce(
  url: string,
  secret: string,
  deliveryId: string,
  event: string,
  body: string,
): Promise<DeliveryResult> {
  const sig = await hmacSign(secret, body);
  let status: number | null = null;
  let response: string | null;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Prism-Event": event,
        "X-Prism-Signature": `sha256=${sig}`,
        "X-Prism-Delivery": deliveryId,
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    status = res.status;
    response = (await res.text()).slice(0, 512);
  } catch (err) {
    response = String(err).slice(0, 512);
  }

  return {
    status,
    response,
    success: status !== null && status >= 200 && status < 300,
  };
}

async function deliverToMatching(
  db: D1Database,
  rows: Array<{ id: string; url: string; secret: string; events: string }>,
  event: string,
  data: unknown,
): Promise<void> {
  const matching = rows.filter((wh) => {
    const evts: string[] = JSON.parse(wh.events);
    return evts.includes("*") || evts.includes(event);
  });

  if (!matching.length) return;

  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ event, timestamp: now, data });

  await Promise.all(
    matching.map(async (wh) => {
      const deliveryId = randomHex();
      const result = await deliverOnce(
        wh.url,
        wh.secret,
        deliveryId,
        event,
        payload,
      );
      await db
        .prepare(
          "INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload, response_status, response_body, success, delivered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
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

// Fire-and-forget delivery to admin-scope webhooks (user_id IS NULL).
// Call with .catch(() => {}) at the call site.
export async function deliverAdminWebhooks(
  db: D1Database,
  event: string,
  data: unknown,
): Promise<void> {
  const { results } = await db
    .prepare(
      "SELECT id, url, secret, events FROM webhooks WHERE is_active = 1 AND user_id IS NULL",
    )
    .all<{ id: string; url: string; secret: string; events: string }>();

  await deliverToMatching(db, results, event, data);
}

// Fire-and-forget delivery to user-scope webhooks for a specific user.
// Call with .catch(() => {}) at the call site.
export async function deliverUserWebhooks(
  db: D1Database,
  userId: string,
  event: string,
  data: unknown,
): Promise<void> {
  const { results } = await db
    .prepare(
      "SELECT id, url, secret, events FROM webhooks WHERE is_active = 1 AND user_id = ?",
    )
    .bind(userId)
    .all<{ id: string; url: string; secret: string; events: string }>();

  await deliverToMatching(db, results, event, data);
}
