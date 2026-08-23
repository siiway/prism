// Availability of the direct-storage consoles (Admin → Database).
//
// Both the D1 console and the KV browser are the same kind of thing: an
// unmediated window onto storage that the rest of the product only ever
// touches through curated endpoints. They get the same three-way switch, and
// share this parser so `D1_CONSOLE` and `KV_CONSOLE` can never drift into
// accepting different spellings of "off".

export type ConsoleMode = "full" | "read-only" | "off";

/** Parse a console availability variable.
 *
 *    unset / "off" / "false" / "0" / …  — the surface 404s
 *    "read-only" / "readonly" / "read"  — reads allowed, every write refused
 *    "full" / "on" / "true" / "1"       — unrestricted
 *
 *  **Unset means off.** These are the two widest doors in the product, and a
 *  door that opens because nobody said otherwise is the wrong default for
 *  something that can empty a table. An operator who wants direct storage
 *  access says so once in `wrangler.jsonc`; everyone who never thinks about
 *  it gets an instance without one.
 *
 *  Anything unrecognised is also off, for the same reason: a typo in the
 *  variable should fail closed. */
export function parseConsoleMode(raw: string | undefined): ConsoleMode {
  const v = raw?.trim().toLowerCase();
  if (!v) return "off";
  if (["read-only", "readonly", "read", "ro"].includes(v)) return "read-only";
  if (["full", "on", "true", "1", "yes", "enabled"].includes(v)) return "full";
  return "off";
}

export function d1ConsoleMode(env: Env): ConsoleMode {
  return parseConsoleMode(env.D1_CONSOLE);
}

/** KV follows `D1_CONSOLE` when `KV_CONSOLE` is unset.
 *
 *  An operator who turned the database console on and then found no key–value
 *  browser beside it — or turned it off and found one — would rightly consider
 *  either a bug: they are two windows onto the same instance's storage, and a
 *  setting for one is a statement about both unless the other is named
 *  explicitly. With neither set, both are off. */
export function kvConsoleMode(env: Env): ConsoleMode {
  return parseConsoleMode(env.KV_CONSOLE ?? env.D1_CONSOLE);
}
