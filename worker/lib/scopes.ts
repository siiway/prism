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
