// Helpers for computing app is_verified from the owner's verified domains.
// An app is considered verified when at least one of its redirect URI hostnames
// or its website URL hostname matches a verified domain owned by the same user
// (exact match or subdomain: sub.example.com matches example.com).

function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function extractHostnames(
  websiteUrl: string | null,
  redirectUrisJson: string,
): string[] {
  let uris: string[] = [];
  try {
    uris = JSON.parse(redirectUrisJson) as string[];
  } catch {
    /* ignore bad JSON */
  }
  if (websiteUrl) uris = [websiteUrl, ...uris];
  return uris.flatMap((url) => {
    try {
      return [new URL(url).hostname];
    } catch {
      return [];
    }
  });
}

/** Compute is_verified for a single app using a pre-fetched domain set. */
export function computeVerified(
  verifiedDomains: Set<string>,
  websiteUrl: string | null,
  redirectUrisJson: string,
): boolean {
  if (!verifiedDomains.size) return false;
  const hostnames = extractHostnames(websiteUrl, redirectUrisJson);
  return hostnames.some((host) =>
    [...verifiedDomains].some((d) => hostnameMatchesDomain(host, d)),
  );
}

/** Fetch verified domains for a single owner and compute is_verified. */
export async function computeIsVerified(
  db: D1Database,
  ownerId: string,
  websiteUrl: string | null,
  redirectUrisJson: string,
): Promise<boolean> {
  const { results } = await db
    .prepare("SELECT domain FROM domains WHERE user_id = ? AND verified = 1")
    .bind(ownerId)
    .all<{ domain: string }>();
  const set = new Set(results.map((r) => r.domain));
  return computeVerified(set, websiteUrl, redirectUrisJson);
}

/**
 * Fetch verified domains for multiple owners in one query.
 * Returns a Map<ownerId, Set<domain>>.
 */
export async function buildVerifiedDomainsMap(
  db: D1Database,
  ownerIds: string[],
): Promise<Map<string, Set<string>>> {
  const unique = [...new Set(ownerIds)];
  if (!unique.length) return new Map();
  const placeholders = unique.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT user_id, domain FROM domains WHERE verified = 1 AND user_id IN (${placeholders})`,
    )
    .bind(...unique)
    .all<{ user_id: string; domain: string }>();

  const map = new Map<string, Set<string>>();
  for (const r of results) {
    if (!map.has(r.user_id)) map.set(r.user_id, new Set());
    map.get(r.user_id)!.add(r.domain);
  }
  return map;
}
