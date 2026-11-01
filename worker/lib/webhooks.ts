// Low-level webhook delivery primitives.
//
// These helpers back the per-OAuth-app developer webhooks (see app-events.ts)
// and the app-webhook test endpoints. The former instance-wide "audit" webhook
// system has been replaced by the scoped audit-log webhooks (see audit.ts).

import { hmacSha256Hex } from "./crypto";
import { safeFetch } from "./safeFetch";

const DELIVERY_TIMEOUT_MS = 10_000;

export interface DeliveryResult {
  status: number | null;
  response: string | null;
  success: boolean;
}

export async function deliverOnce(
  env: Env,
  url: string,
  secret: string,
  deliveryId: string,
  event: string,
  body: string,
): Promise<DeliveryResult> {
  const sig = await hmacSha256Hex(secret, body);
  let status: number | null = null;
  let response: string | null;

  try {
    const res = await safeFetch(url, {
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
