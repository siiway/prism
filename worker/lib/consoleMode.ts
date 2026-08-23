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
 *  Unset means "full": the operator who deploys the instance is the audience
 *  for these tools and already owns the storage behind them. Operators who
 *  would rather not carry the risk turn it down.
 *
 *    "off"                              — the surface 404s
 *    "read-only" / "readonly" / "read"  — reads allowed, every write refused
 *
 *  A value that plainly reads as false ("0", "false", "no", …) is treated as
 *  "off", so `D1_CONSOLE: "false"` does the obvious thing instead of falling
 *  through to "unrecognised, therefore wide open". */
export function parseConsoleMode(raw: string | undefined): ConsoleMode {
  const v = raw?.trim().toLowerCase();
  if (!v) return "full";
  if (["read-only", "readonly", "read", "ro"].includes(v)) return "read-only";
  if (["0", "false", "no", "off", "disabled", "none"].includes(v)) return "off";
  return "full";
}

export function d1ConsoleMode(env: Env): ConsoleMode {
  return parseConsoleMode(env.D1_CONSOLE);
}

/** KV defaults to following `D1_CONSOLE` when `KV_CONSOLE` is unset.
 *
 *  An operator who turned the database console off and then found a key–value
 *  browser sitting next to it would rightly consider that a bug: they are two
 *  windows onto the same instance's storage, and turning one off is a
 *  statement about both unless the other is named explicitly. */
export function kvConsoleMode(env: Env): ConsoleMode {
  return parseConsoleMode(env.KV_CONSOLE ?? env.D1_CONSOLE);
}
