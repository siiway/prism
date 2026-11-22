// An email address belongs to one account, whether it is that account's
// primary address (users.email) or one of its alternates (user_emails). The
// two tables each keep their own column unique, so every path that gives an
// account an address checks the other table here.

/** Whether the address is already some account's primary email, or a
 *  verified alternate of one. An unverified alternate doesn't count: anyone
 *  can add one without proof, and it would let them block the address's
 *  owner from signing up. Verifying an alternate checks this again.
 *  `exceptUserId` leaves out that account's own addresses. */
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
