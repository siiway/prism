// Resolving a presented Personal Access Token (`prism_pat_…`).

import { hashLookupCandidate } from "./secretCrypto";
import type { WaitUntilCtx } from "../types";

export interface PersonalAccessToken {
  id: string;
  user_id: string;
  scopes: string[];
  expires_at: number | null;
}

/** Look a PAT up by its value. The token column holds either legacy
 *  plaintext or the keyed hash (after SECRETS_KEY migration), so both forms
 *  are matched. Expiry is left to the caller, which may want to report it
 *  differently from "no such token". */
export async function findPersonalAccessToken(
  env: Env,
  raw: string,
): Promise<PersonalAccessToken | null> {
  const lookupHash = await hashLookupCandidate(env, raw);
  if (!lookupHash) return null;
  const row = await env.DB.prepare(
    "SELECT id, user_id, scopes, expires_at FROM personal_access_tokens WHERE token = ? OR token = ?",
  )
    .bind(raw, lookupHash)
    .first<{
      id: string;
      user_id: string;
      scopes: string;
      expires_at: number | null;
    }>();
  if (!row) return null;
  return { ...row, scopes: JSON.parse(row.scopes) as string[] };
}

export function isExpired(pat: PersonalAccessToken, now: number): boolean {
  return pat.expires_at !== null && pat.expires_at < now;
}

/** Best-effort `last_used_at` bump that never blocks the request. */
export function touchPersonalAccessToken(
  env: Env,
  ctx: WaitUntilCtx,
  id: string,
  now: number,
): void {
  ctx.waitUntil(
    env.DB.prepare(
      "UPDATE personal_access_tokens SET last_used_at = ? WHERE id = ?",
    )
      .bind(now, id)
      .run()
      .then(() => undefined)
      .catch(() => undefined),
  );
}
