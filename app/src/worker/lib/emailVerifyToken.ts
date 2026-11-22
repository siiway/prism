// Email verification links last 24 hours, as the email says. The token
// carries the time it was issued: only its keyed hash is stored, so the time
// can't be changed without breaking the match, and no column is needed.

import { randomBase64url } from "./crypto";

const EMAIL_VERIFY_TTL_SECONDS = 24 * 60 * 60;

/** A new token for an email verification link. */
export function newEmailVerifyToken(
  now = Math.floor(Date.now() / 1000),
): string {
  return `${randomBase64url(24)}.${now}`;
}

/** Whether a presented token was issued within the last 24 hours. Tokens
 *  from before issue times were added carry none, and count as expired. */
export function emailVerifyTokenFresh(
  token: string,
  now = Math.floor(Date.now() / 1000),
): boolean {
  const issued = Number(token.slice(token.lastIndexOf(".") + 1));
  if (!token.includes(".") || !Number.isInteger(issued)) return false;
  return issued <= now && now - issued <= EMAIL_VERIFY_TTL_SECONDS;
}
