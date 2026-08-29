// OpenID Connect Back-Channel Logout.
//
// When a user's session ends, notify every client the user has authorized that
// registered a backchannel_logout_uri by POSTing a signed logout_token. The RP
// verifies the token (via the OP's JWKS) and terminates its own session.

import { getRsaKeyPair } from "./config";
import { signLogoutTokenRS256 } from "./jwt";
import { randomId } from "./crypto";
import { safeFetch } from "./safeFetch";
import type { WaitUntilCtx } from "../types";

const BACKCHANNEL_LOGOUT_EVENT =
  "http://schemas.openid.net/event/backchannel-logout";

/**
 * Deliver a logout_token to each client the user has consented to that has a
 * backchannel_logout_uri. `sessionId`, when known, is sent as `sid` so an RP
 * can log out just that session; otherwise the token logs the user out by
 * `sub`. Delivery is best-effort and fired via waitUntil.
 */
export async function deliverBackChannelLogout(
  env: Env,
  ctx: WaitUntilCtx,
  userId: string,
  sessionId: string | null,
): Promise<void> {
  const clients = await env.DB.prepare(
    `SELECT DISTINCT a.client_id AS client_id, a.backchannel_logout_uri AS uri
       FROM oauth_apps a
       JOIN oauth_consents c ON c.client_id = a.client_id
      WHERE c.user_id = ?
        AND a.is_active = 1
        AND a.backchannel_logout_uri IS NOT NULL
        AND a.backchannel_logout_uri != ''`,
  )
    .bind(userId)
    .all<{ client_id: string; uri: string }>();
  if (!clients.results.length) return;

  const rsa = await getRsaKeyPair(env.KV_SESSIONS);
  for (const client of clients.results) {
    const claims: Record<string, unknown> = {
      iss: env.APP_URL,
      sub: userId,
      aud: client.client_id,
      jti: randomId(),
      events: { [BACKCHANNEL_LOGOUT_EVENT]: {} },
    };
    // A logout_token MUST NOT contain a nonce; sid is included when known.
    if (sessionId) claims.sid = sessionId;
    const token = await signLogoutTokenRS256(
      claims,
      rsa.privateKey,
      rsa.kid,
      120,
    );
    ctx.waitUntil(
      safeFetch(client.uri, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `logout_token=${encodeURIComponent(token)}`,
      })
        .then(() => undefined)
        .catch(() => undefined),
    );
  }
}
