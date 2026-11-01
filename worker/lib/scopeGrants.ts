// Elevated scope grants: what `site:*` and `team:<id>:*` authority an
// application holds, and how to take it back.
//
// The site_scope_grants / team_scope_grants tables are written when someone
// approves an app, but they are only a record. The authority itself lives in
// the user's stored approval (oauth_consents) and in the tokens issued under
// it, so withdrawing a grant has to change those too.

/** Scope lists are stored as JSON arrays; older rows may be space-separated. */
export function parseScopeList(raw: string | null | undefined): string[] {
  const text = raw?.trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed))
        return parsed.filter((s): s is string => typeof s === "string");
    } catch {
      // Fall through and treat it as a plain list.
    }
  }
  return text.split(/\s+/).filter(Boolean);
}

export type GrantKind = "site" | "team";

/** Whether a scope is part of the grant: any `site:*` scope, or one bound to
 *  this team (`team:<id>:<permission>`). */
export function grantMatcher(
  kind: GrantKind,
  teamId?: string,
): (scope: string) => boolean {
  if (kind === "site") return (s) => s.startsWith("site:");
  const prefix = `team:${teamId}:`;
  return (s) => s.startsWith(prefix);
}

/** A LIKE pattern that finds rows whose scope list might hold the grant.
 *  Rows it finds are checked again with grantMatcher. */
export function grantLike(kind: GrantKind, teamId?: string): string {
  return kind === "site" ? "%site:%" : `%team:${teamId}:%`;
}

/** The scopes of the grant that a stored list holds, without the
 *  `team:<id>:` prefix for team grants. */
export function heldScopes(
  kind: GrantKind,
  lists: (string | null | undefined)[],
  teamId?: string,
): string[] {
  const matches = grantMatcher(kind, teamId);
  const held = new Set<string>();
  for (const raw of lists)
    for (const s of parseScopeList(raw))
      if (matches(s))
        held.add(kind === "team" ? s.slice(`team:${teamId}:`.length) : s);
  return [...held].sort();
}

/** A stored approval with the grant taken out. `null` when nothing else is
 *  left, so the approval should be deleted rather than kept empty. */
export function stripGrant(
  raw: string | null | undefined,
  kind: GrantKind,
  teamId?: string,
): string | null {
  const matches = grantMatcher(kind, teamId);
  const rest = parseScopeList(raw).filter((s) => !matches(s));
  return rest.length ? JSON.stringify(rest) : null;
}
