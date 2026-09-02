import type { SocialOAuthStateRow } from "../types";
import { base64urlToBuf, bufToBase64url } from "./crypto";

export const SOCIAL_OAUTH_STATE_TTL_SECONDS = 10 * 60;
const MAX_STORED_SOCIAL_OAUTH_STATES = 10_000;
const EXPIRED_STATE_CLEANUP_LIMIT = 1_000;
const SOCIAL_OAUTH_STATE_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const SOCIAL_OAUTH_CORRELATION_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isValidSocialOAuthState(value: string): boolean {
  return SOCIAL_OAUTH_STATE_PATTERN.test(value);
}

export function isValidSocialOAuthCorrelation(value: string): boolean {
  return SOCIAL_OAUTH_CORRELATION_PATTERN.test(value);
}

export type SocialOAuthMode = "login" | "connect";

async function correlationEncryptionKey(
  correlation: string,
): Promise<CryptoKey> {
  if (!isValidSocialOAuthCorrelation(correlation))
    throw new Error("Invalid social OAuth correlation secret");
  return crypto.subtle.importKey(
    "raw",
    base64urlToBuf(correlation),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt an invite bearer with the browser-only correlation secret. */
export async function sealSocialOAuthInviteToken(
  token: string | null,
  correlation: string,
  state: string,
): Promise<string | null> {
  if (!token) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(state),
    },
    await correlationEncryptionKey(correlation),
    new TextEncoder().encode(token),
  );
  return `${bufToBase64url(iv)}.${bufToBase64url(ciphertext)}`;
}

/** Decrypt an invite only after the matching state and cookie are consumed. */
export async function openSocialOAuthInviteToken(
  sealed: string | null,
  correlation: string,
  state: string,
): Promise<string | null> {
  if (!sealed) return null;
  const parts = sealed.split(".");
  if (parts.length !== 2) throw new Error("Malformed sealed invite token");
  const iv = base64urlToBuf(parts[0]);
  if (iv.byteLength !== 12) throw new Error("Malformed sealed invite token");
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(state),
    },
    await correlationEncryptionKey(correlation),
    base64urlToBuf(parts[1]),
  );
  return new TextDecoder().decode(plaintext);
}

export interface NewSocialOAuthState {
  state: string;
  slug: string;
  provider: string;
  mode: SocialOAuthMode;
  userId: string | null;
  sessionId: string | null;
  correlationHash: string;
  codeVerifier: string | null;
  inviteTokenCiphertext?: string | null;
  now: number;
}

/** Store browser-bound social OAuth state in D1's strongly consistent store. */
export async function storeSocialOAuthState(
  db: D1Database,
  input: NewSocialOAuthState,
): Promise<boolean> {
  // Keep abandoned flows bounded even where scheduled cleanup is disabled.
  // The INSERT also applies a hard table cap in one statement, so a burst of
  // concurrent public begin requests cannot race past it.
  await db
    .prepare(
      `DELETE FROM social_oauth_states
        WHERE state IN (
          SELECT state FROM social_oauth_states
           WHERE expires_at <= ?
           LIMIT ?
        )`,
    )
    .bind(input.now, EXPIRED_STATE_CLEANUP_LIMIT)
    .run();

  const result = await db
    .prepare(
      `INSERT INTO social_oauth_states
         (state, slug, provider, mode, user_id, session_id, correlation_hash,
          code_verifier, invite_token_ciphertext, expires_at, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE (SELECT COUNT(*) FROM social_oauth_states) < ?`,
    )
    .bind(
      input.state,
      input.slug,
      input.provider,
      input.mode,
      input.userId,
      input.sessionId,
      input.correlationHash,
      input.codeVerifier,
      input.inviteTokenCiphertext ?? null,
      input.now + SOCIAL_OAUTH_STATE_TTL_SECONDS,
      input.now,
      MAX_STORED_SOCIAL_OAUTH_STATES,
    )
    .run();
  return result.meta.changes === 1;
}

export interface ConsumeSocialOAuthStateInput {
  state: string;
  slug: string;
  provider: string;
  correlationHash: string;
  sessionId: string | null;
  userId: string | null;
  now: number;
}

/**
 * Redeem state exactly once. DELETE ... RETURNING makes validation and
 * consumption one atomic D1 statement, so concurrent callbacks cannot both
 * pass. Connect flows additionally require the initiating live session.
 */
export async function consumeSocialOAuthState(
  db: D1Database,
  input: ConsumeSocialOAuthStateInput,
): Promise<SocialOAuthStateRow | null> {
  return db
    .prepare(
      `DELETE FROM social_oauth_states
        WHERE state = ?
          AND slug = ?
          AND provider = ?
          AND correlation_hash = ?
          AND expires_at > ?
          AND (
            mode = 'login'
            OR (
              mode = 'connect'
              AND session_id = ?
              AND user_id = ?
            )
          )
        RETURNING state, slug, provider, mode, user_id, session_id,
                  correlation_hash, code_verifier, invite_token_ciphertext,
                  expires_at, created_at`,
    )
    .bind(
      input.state,
      input.slug,
      input.provider,
      input.correlationHash,
      input.now,
      input.sessionId,
      input.userId,
    )
    .first<SocialOAuthStateRow>();
}
