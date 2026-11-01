// Minting a browser session: the signed JWT, its sessions row, the first
// IP-history entry, the HttpOnly cookie and the user's own audit entry. Every
// sign-in path (password, passkey, GPG, 2FA, social, invite registration,
// first-run setup) goes through issueSession so none of them can skip a step.

import type { Context } from "hono";
import { auditRequestMeta, recordAudit } from "./audit";
import { getIp } from "./clientIp";
import { getJwtSecret } from "./config";
import { setSessionCookie } from "./cookies";
import { randomId, sha256Hex } from "./crypto";
import { geoJson, recordSessionIp } from "./geo";
import { signJWT } from "./jwt";
import { proxyImageUrl } from "./proxyImage";
import type { UserRow, Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };

/** `amr` lists RFC 8176 authentication methods (e.g. `["pwd"]`, `["ext"]`). */
export async function issueSession(
  c: Context<AppEnv>,
  user: UserRow,
  ttlSeconds: number,
  amr?: string[],
): Promise<void> {
  const db = c.env.DB;
  const secret = await getJwtSecret(c.env.KV_SESSIONS);
  const sessionId = randomId(32);
  const now = Math.floor(Date.now() / 1000);
  const token = await signJWT(
    {
      sub: user.id,
      role: user.role,
      email: user.email,
      username: user.username,
      display_name: user.display_name,
      avatar_url: await proxyImageUrl(c.env.APP_URL, db, user.avatar_url),
      unproxied_avatar_url: user.avatar_url,
      email_verified: user.email_verified === 1,
      sessionId,
    },
    secret,
    ttlSeconds,
  );
  const hash = await sha256Hex(token);
  await db
    .prepare(
      "INSERT INTO sessions (id, user_id, token_hash, user_agent, ip_address, expires_at, created_at, amr) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      sessionId,
      user.id,
      hash,
      c.req.header("User-Agent") ?? null,
      getIp(c),
      now + ttlSeconds,
      now,
      amr && amr.length ? JSON.stringify(amr) : null,
    )
    .run();
  // Seed the session's IP history with the login IP + geolocation so the
  // security page has a location for a session the moment it is created,
  // rather than only after the next authenticated request.
  c.executionCtx.waitUntil(
    recordSessionIp(c.env.DB, sessionId, getIp(c), geoJson(c), now).catch(
      () => undefined,
    ),
  );
  // The browser session credential is only ever delivered in the HttpOnly
  // cookie; API response bodies never expose it to JavaScript.
  setSessionCookie(c, token, ttlSeconds);

  // Transparent User Control: record every session issuance (login, social
  // login, 2FA completion, GPG login, registration) in the user's own log.
  const meta = auditRequestMeta(c);
  c.executionCtx.waitUntil(
    recordAudit(c.env, c.executionCtx, {
      scope: "user",
      scopeId: user.id,
      action: "user.login",
      actorId: user.id,
      actorName: user.username,
      resourceType: "session",
      resourceId: sessionId,
      resourceName: `@${user.username}`,
      ip: meta.ip,
      userAgent: meta.userAgent,
      geo: meta.geo,
      metadata: {},
    }),
  );
}
