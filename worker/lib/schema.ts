// Recognising a database that is behind the code.
//
// A Worker deploy and a `wrangler d1 migrations apply` are two commands, and
// nothing makes them atomic. Between them the code references tables and
// columns that do not exist yet — briefly on a good day, indefinitely on an
// instance whose operator forgot the second command.
//
// The default behaviour in that window is bad out of proportion to the cause:
// D1 rejects the query, the route throws, and the global error handler turns
// it into a 500. If the query in question runs on every page — a notice board
// does — one unapplied migration takes the whole product down rather than the
// one feature that needed it.
//
// So features whose storage arrived in a migration catch this specific error
// and degrade: a read returns nothing, a write says plainly what is wrong.
// Everything that predates the migration is untouched, which is the point.

/** D1 surfaces SQLite's own message, e.g.
 *  `D1_ERROR: no such table: notices: SQLITE_ERROR`. Column mismatches from a
 *  half-applied ALTER read the same way.
 *
 *  Matched on the message rather than a code because D1 does not expose one,
 *  and deliberately narrow: an error this does not recognise keeps propagating
 *  to the 500 handler, which is the right outcome for a real failure. Treating
 *  every query error as "migrations pending" would hide exactly the bugs this
 *  is meant not to resemble. */
export function isMissingSchemaError(err: unknown): boolean {
  // D1 puts SQLite's text in `message`, but wraps in some paths, so the
  // `cause` chain is walked too. Bounded, because a cause chain can be
  // circular and this runs on a request path.
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth++) {
    const message =
      current instanceof Error
        ? current.message
        : typeof current === "string"
          ? current
          : "";
    if (/no such table|no such column/i.test(message)) return true;
    current = current instanceof Error ? current.cause : null;
  }
  return false;
}

/** What to tell an operator who hit one. Names the command, because the
 *  question after "the feature is unavailable" is always "how do I fix it". */
export const MIGRATIONS_PENDING =
  "This feature's database tables are missing. Apply the pending migrations " +
  "(`wrangler d1 migrations apply <database> --remote`) and try again.";

/** Run a read whose storage came from a migration.
 *
 *  Returns `fallback` when the tables are not there yet, so a feature that is
 *  merely absent renders as absent rather than as a broken page. */
export async function readWithFallback<T>(
  run: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (isMissingSchemaError(err)) return fallback;
    throw err;
  }
}
