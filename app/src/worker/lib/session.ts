// Minting a browser session: the signed JWT, its sessions row, the first
// IP-history entry, the HttpOnly cookie and the user's own audit entry. Every
// sign-in path (password, passkey, GPG, 2FA, social, invite registration,
// first-run setup) goes through issueSession so none of them can skip a step.
// Ending one in the browser (sign-out, OIDC end_session, SAML single logout)
// goes through endBrowserSession, likewise. A password change ends all of the
// user's sign-ins, apps included, through signOutEverywhere.

import type { Context } from "hono";
import { auditRequestMeta, recordAudit } from "./audit";
import { getIp } from "./clientIp";
import { getJwtSecret } from "./config";
import { deliverBackChannelLogout } from "./backchannelLogout";
import {
  clearSessionCookie,
  setSamlLogoutCookie,
  setSessionCookie,
} from "./cookies";
import { randomId, sha256Hex } from "./crypto";
import { geoJson, recordSessionIp } from "./geo";
import { signJWT } from "./jwt";
import { proxyImageUrl } from "./proxyImage";
import { startIdpLogout } from "./saml/logout";
import type { UserRow, Variables, WaitUntilCtx } from "../types";

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

/**
 * End the browser's Prism session, as signing out does. Before the row (and
 * its SAML sign-ins) goes: OIDC Back-Channel Logout tells the user's
 * clients, and, given `finishUrl`, a SAML Single Logout is started that this
 * browser (the cookie) carries to the session's SPs. Then the row and the
 * cookie go. Returns where the browser goes next: /logout when there are
 * SPs to visit, else `finishUrl`. Without `finishUrl` (a logout already
 * under way that visits the SPs) no new one starts.
 */
export async function endBrowserSession(
  c: Context<AppEnv>,
  finishUrl: string,
): Promise<string>;
export async function endBrowserSession(c: Context<AppEnv>): Promise<void>;
export async function endBrowserSession(
  c: Context<AppEnv>,
  finishUrl?: string,
): Promise<string | void> {
  const sessionId = c.get("sessionId");
  const user = c.get("user");
  const [, samlLogout] = await Promise.all([
    user && deliverBackChannelLogout(c.env, c.executionCtx, user.id, sessionId),
    sessionId && finishUrl !== undefined
      ? startIdpLogout(c.env.DB, sessionId, finishUrl)
      : null,
  ]);
  if (samlLogout) setSamlLogoutCookie(c, samlLogout);
  if (sessionId)
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?")
      .bind(sessionId)
      .run();
  clearSessionCookie(c);
  return samlLogout ? "/logout" : finishUrl;
}

/**
 * Sign a user out everywhere, as a password change does: every Prism session
 * but `keepSessionId` (the browser that made the change, if any), every OAuth
 * token, and every grant not yet redeemed (authorization codes, approved
 * device codes, step-up 2FA codes), so a refresh token taken before the
 * change stops working. JWT access tokens can't be recalled and run out on
 * their own.
 *
 * `alongWith` runs in the same batch, first: the password write, so the new
 * password never takes effect without the sign-out. Apps with a back-channel
 * logout endpoint are told afterwards, best-effort: the change has happened
 * by then, whatever an app's endpoint does.
 */
export async function signOutEverywhere(
  env: Env,
  ctx: WaitUntilCtx,
  userId: string,
  keepSessionId: string | null,
  alongWith: D1PreparedStatement[] = [],
): Promise<void> {
  const db = env.DB;
  await db.batch([
    ...alongWith,
    db
      .prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?")
      .bind(userId, keepSessionId ?? ""),
    db.prepare("DELETE FROM oauth_tokens WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM oauth_codes WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM oauth_device_codes WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM oauth_2fa_codes WHERE user_id = ?").bind(userId),
  ]);
  await deliverBackChannelLogout(env, ctx, userId, null).catch(() => {});
}
