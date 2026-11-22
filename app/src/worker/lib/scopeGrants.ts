// Elevated scope grants: what site-level (`site:*`, `admin:*`) and
// `team:<id>:*` authority an application holds, and how to take it back.
//
// The site_scope_grants / team_scope_grants tables are written when someone
// approves an app, but they are only a record. The authority itself lives in
// the user's stored approval (oauth_consents) and in the tokens issued under
// it, so withdrawing a grant has to change those too.

import { isSiteLevelScope } from "../../shared/scopes";

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

/** Whether a scope is part of the grant: any `site:*` or `admin:*` scope, or
 *  one bound to this team (`team:<id>:<permission>`). */
export function grantMatcher(
  kind: GrantKind,
  teamId?: string,
): (scope: string) => boolean {
  if (kind === "site") return isSiteLevelScope;
  const prefix = `team:${teamId}:`;
  return (s) => s.startsWith(prefix);
}

/** LIKE patterns that find rows whose scope list might hold the grant.
 *  Rows they find are checked again with grantMatcher. */
export function grantLikes(kind: GrantKind, teamId?: string): string[] {
  return kind === "site" ? SITE_GRANT_LIKES : [`%team:${teamId}:%`];
}

/** Each site-level prefix at the start of a scope, in a JSON list
 *  (`["site:...`, `,"admin:...`) or an older space-separated one. A bare
 *  `%admin:%` would also match app scopes like `app:<id>:admin:panel`. */
export const SITE_GRANT_LIKES = ["site:", "admin:"].flatMap((prefix) => [
  `%"${prefix}%`,
  `${prefix}%`,
  `% ${prefix}%`,
]);

/** `(column LIKE ? OR ...)`, one placeholder per pattern. */
export function likeAny(column: string, patterns: string[]): string {
  return `(${patterns.map(() => `${column} LIKE ?`).join(" OR ")})`;
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
