/**
 * Parses an app-delegation scope string: `app:<client_id>:<inner_scope>`
 * Returns null if the string is not in that format.
 */
export function parseAppScope(
  s: string,
): { clientId: string; innerScope: string } | null {
  if (!s.startsWith("app:")) return null;
  const rest = s.slice(4);
  const sep = rest.indexOf(":");
  if (sep < 1 || sep === rest.length - 1) return null;
  return { clientId: rest.slice(0, sep), innerScope: rest.slice(sep + 1) };
}

// ── Team-scoped permissions ──────────────────────────────────────────────────

/**
 * The set of valid permission suffixes for team-scoped tokens.
 * Unbound form:  `team:read`, `team:member:read`, etc.
 * Bound form:    `team:<teamId>:read`, `team:<teamId>:member:read`, etc.
 */
export const TEAM_PERMISSIONS = new Set([
  "read",
  "write",
  "delete",
  "member:read",
  "member:write",
  "member:profile:read",
]);

/** Unbound team scope strings that apps include in their scope request. */
export const UNBOUND_TEAM_SCOPES = new Set(
  [...TEAM_PERMISSIONS].map((p) => `team:${p}`),
);

/**
 * If `s` is an unbound team scope (e.g. `"team:member:read"`), returns the
 * permission part (`"member:read"`).  Otherwise returns null.
 */
export function parseUnboundTeamScope(s: string): string | null {
  if (!s.startsWith("team:")) return null;
  const perm = s.slice(5);
  return TEAM_PERMISSIONS.has(perm) ? perm : null;
}

/**
 * If `s` is a bound team scope (e.g. `"team:abc123:member:read"`), returns
 * `{ teamId, permission }`.  Otherwise returns null.
 */
export function parseBoundTeamScope(
  s: string,
): { teamId: string; permission: string } | null {
  if (!s.startsWith("team:")) return null;
  const rest = s.slice(5);
  // Check against every known permission suffix, longest first to avoid
  // false positives (e.g. "member:profile:read" vs "member:read").
  const sorted = [...TEAM_PERMISSIONS].sort((a, b) => b.length - a.length);
  for (const perm of sorted) {
    const suffix = `:${perm}`;
    if (rest.endsWith(suffix)) {
      const teamId = rest.slice(0, rest.length - suffix.length);
      // teamId must be non-empty and not contain ":" (unbound scopes have no teamId)
      if (teamId && !teamId.includes(":")) {
        return { teamId, permission: perm };
      }
    }
  }
  return null;
}

/**
 * Binds a list of unbound team scopes to a specific team ID.
 * Unrecognised scopes are passed through unchanged.
 */
export function bindTeamScopes(scopes: string[], teamId: string): string[] {
  return scopes.map((s) => {
    const perm = parseUnboundTeamScope(s);
    return perm ? `team:${teamId}:${perm}` : s;
  });
}
