// Shared site-invite validation/consumption used by both the password
// registration path (routes/auth.ts) and the social/OAuth registration path
// (routes/connections.ts). Keeping this in one place ensures invite-only mode
// is enforced identically regardless of how the account is created — a split
// between the two paths previously let OAuth sign-ups bypass invites entirely.

import type { SiteInviteRow } from "../types";
import { hashLookupCandidate } from "./secretCrypto";

export type InviteValidation =
  | { ok: true; invite: SiteInviteRow }
  | { ok: false; error: string; status: 403 };

/**
 * Validate an invite token for a registration attempt. Mirrors the checks
 * that historically lived inline in the password register handler:
 *   - token is present
 *   - token resolves to a site_invites row (raw or hashed-lookup form)
 *   - not expired
 *   - not over its max_uses
 *   - email-bound invites match the registering email
 *
 * Does NOT consume the invite — call `consumeSiteInvite` after the user row
 * is successfully created so a failed insert doesn't burn a use.
 *
 * `email` may be null (e.g. a social sign-up with no provider-confirmed
 * address); an email-bound invite will then be rejected, which is the safe
 * behaviour.
 */
export async function validateSiteInvite(
  env: Env,
  token: string | null | undefined,
  email: string | null | undefined,
): Promise<InviteValidation> {
  if (!token)
    return {
      ok: false,
      error: "An invite token is required to register",
      status: 403,
    };

  const now = Math.floor(Date.now() / 1000);
  const inviteLookup = await hashLookupCandidate(env, token);
  if (!inviteLookup)
    return { ok: false, error: "Invalid invite token", status: 403 };

  const invite = await env.DB.prepare(
    "SELECT * FROM site_invites WHERE token = ? OR token = ?",
  )
    .bind(token, inviteLookup)
    .first<SiteInviteRow>();

  if (!invite) return { ok: false, error: "Invalid invite token", status: 403 };
  if (invite.expires_at !== null && invite.expires_at < now)
    return { ok: false, error: "Invite token has expired", status: 403 };
  if (invite.max_uses !== null && invite.use_count >= invite.max_uses)
    return {
      ok: false,
      error: "Invite token has reached its usage limit",
      status: 403,
    };
  if (
    invite.email &&
    invite.email.toLowerCase() !== (email ?? "").toLowerCase().trim()
  )
    return {
      ok: false,
      error: "This invite is for a different email address",
      status: 403,
    };

  return { ok: true, invite };
}

/**
 * Take one use of an invite, atomically. Returns false when there was none
 * left to take.
 *
 * The cap cannot be enforced by validateSiteInvite's read: concurrent
 * registrations all see the same use_count, all pass, and all increment —
 * which on an invite-only instance turns one leaked link into as many
 * accounts as the attacker can request at once. The condition therefore lives
 * in the UPDATE, so exactly one racing request can take the last use.
 *
 * Claim before inserting the user and release on failure, so a rejected
 * insert does not burn a use. This mirrors the team-invite registration path.
 */
export async function claimSiteInvite(
  env: Env,
  invite: SiteInviteRow,
): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE site_invites SET use_count = use_count + 1
        WHERE id = ? AND (max_uses IS NULL OR use_count < max_uses)`,
  )
    .bind(invite.id)
    .run();
  return res.meta.changes === 1;
}

/** Hand back a use taken by claimSiteInvite when the account was not created. */
export async function releaseSiteInvite(
  env: Env,
  invite: SiteInviteRow,
): Promise<void> {
  await env.DB.prepare(
    "UPDATE site_invites SET use_count = use_count - 1 WHERE id = ? AND use_count > 0",
  )
    .bind(invite.id)
    .run();
}
