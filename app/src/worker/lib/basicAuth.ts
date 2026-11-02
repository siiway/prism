// Shared parser for OAuth client credentials sent via HTTP Basic auth.

export interface BasicAuthCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Parse an Authorization: Basic header into OAuth client credentials.
 *
 * Returns null when the header is absent, not Basic, not valid base64, or
 * has an empty client id. Splits on the FIRST colon so client secrets that
 * themselves contain ":" survive intact (RFC 7617 §2 — the user-id may not
 * contain a colon, but the password may).
 */
export function parseBasicAuth(
  authHeader: string | undefined,
): BasicAuthCredentials | null {
  if (!authHeader?.startsWith("Basic ")) return null;
  let decoded: string;
  try {
    decoded = atob(authHeader.slice(6));
  } catch {
    return null;
  }
  const sep = decoded.indexOf(":");
  if (sep < 1) return null;
  return {
    clientId: decoded.slice(0, sep),
    clientSecret: decoded.slice(sep + 1),
  };
}
