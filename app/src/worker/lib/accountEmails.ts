// An email address belongs to the one account that proved it owns it, as
// its verified primary address (users.email) or a verified alternate
// (user_emails). Anyone can type an address without proof, so an
// unverified one never keeps the owner from claiming it. The two tables
// each keep their own column unique, so every path that gives an account
// an address checks the other table here.

/** Whether the address can't become a new primary address: it is already
 *  some account's primary (the column is unique, verified or not), or a
 *  verified alternate of one. An unverified alternate doesn't count: anyone
 *  can add one without proof, and it would let them block the address's
 *  owner from signing up. `exceptUserId` leaves out that account's own
 *  addresses. */
export async function emailInUse(
  db: D1Database,
  email: string,
  exceptUserId = "",
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 FROM users WHERE email = ? AND id != ?
       UNION ALL
       SELECT 1 FROM user_emails
        WHERE email = ? AND user_id != ? AND verified = 1
       LIMIT 1`,
    )
    .bind(
      email.trim().toLowerCase(),
      exceptUserId,
      email.trim().toLowerCase(),
      exceptUserId,
    )
    .first();
  return row !== null;
}

/** Whether another account has proved it owns the address, as its verified
 *  primary or a verified alternate. Verifying an address, or adding it as
 *  an alternate, checks this: an unverified primary someone signed up with
 *  doesn't block the owner. */
export async function emailOwnedElsewhere(
  db: D1Database,
  email: string,
  userId: string,
): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const row = await db
    .prepare(
      `SELECT 1 FROM users WHERE email = ? AND id != ? AND email_verified = 1
       UNION ALL
       SELECT 1 FROM user_emails
        WHERE email = ? AND user_id != ? AND verified = 1
       LIMIT 1`,
    )
    .bind(normalized, userId, normalized, userId)
    .first();
  return row !== null;
}

/** What becomes of the old primary address when an account makes another
 *  of its addresses primary. It moves to the account's alternates, unless
 *  another account already has it as an alternate, which the column's
 *  uniqueness refuses. Then a claim that account never proved gives way to
 *  a verified old primary; otherwise the old primary isn't kept. */
export async function oldPrimaryDemotion(
  db: D1Database,
  userId: string,
  oldEmail: string,
  oldVerified: boolean,
): Promise<{ keep: boolean; dropClaim: D1PreparedStatement | null }> {
  const claim = await db
    .prepare(
      "SELECT id, verified FROM user_emails WHERE email = ? AND user_id != ?",
    )
    .bind(oldEmail, userId)
    .first<{ id: string; verified: number }>();
  if (!claim) return { keep: true, dropClaim: null };
  if (oldVerified && !claim.verified)
    return {
      keep: true,
      dropClaim: db
        .prepare("DELETE FROM user_emails WHERE id = ? AND verified = 0")
        .bind(claim.id),
    };
  return { keep: false, dropClaim: null };
}
