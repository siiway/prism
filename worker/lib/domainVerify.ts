// Helpers for computing app is_verified from the owner's verified domains.
// An app is considered verified when EVERY non-localhost redirect URI hostname
// is covered by a verified domain owned by the same user
// (exact match or subdomain: sub.example.com matches example.com).
// Localhost / 127.0.0.1 / ::1 redirect URIs are excluded from this requirement.

function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isLocalhostHostname(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

/** Compute is_verified for a single app using a pre-fetched domain set. */
export function computeVerified(
  verifiedDomains: Set<string>,
  _websiteUrl: string | null,
  redirectUrisJson: string,
): boolean {
  if (!verifiedDomains.size) return false;

  let uris: string[] = [];
  try {
    uris = JSON.parse(redirectUrisJson) as string[];
  } catch {
    return false;
  }

  // Extract non-localhost redirect URI hostnames
  const verifiableHosts = uris.flatMap((url) => {
    try {
      const host = new URL(url).hostname;
      return isLocalhostHostname(host) ? [] : [host];
    } catch {
      return [];
    }
  });

  // Must have at least one non-localhost redirect URI to be verifiable
  if (verifiableHosts.length === 0) return false;

  const domainList = [...verifiedDomains];
  // ALL non-localhost redirect URI hostnames must match a verified domain
  return verifiableHosts.every((host) =>
    domainList.some((d) => hostnameMatchesDomain(host, d)),
  );
}

/** Fetch verified domains for a single owner (and optionally a team) and compute is_verified. */
export async function computeIsVerified(
  db: D1Database,
  ownerId: string,
  websiteUrl: string | null,
  redirectUrisJson: string,
  teamId?: string | null,
): Promise<boolean> {
  const queries: Promise<{ results: { domain: string }[] }>[] = [
    db
      .prepare(
        "SELECT domain FROM domains WHERE user_id = ? AND team_id IS NULL AND verified = 1",
      )
      .bind(ownerId)
      .all<{ domain: string }>(),
  ];
  if (teamId) {
    queries.push(
      db
        .prepare(
          "SELECT domain FROM domains WHERE team_id = ? AND verified = 1",
        )
        .bind(teamId)
        .all<{ domain: string }>(),
    );
  }
  const results = await Promise.all(queries);
  const set = new Set(results.flatMap((r) => r.results.map((x) => x.domain)));
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
      `SELECT user_id, domain FROM domains WHERE verified = 1 AND team_id IS NULL AND user_id IN (${placeholders})`,
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

/**
 * Fetch verified domains for multiple teams in one query.
 * Returns a Map<teamId, Set<domain>>.
 */
export async function buildVerifiedTeamDomainsMap(
  db: D1Database,
  teamIds: string[],
): Promise<Map<string, Set<string>>> {
  const unique = [...new Set(teamIds.filter(Boolean))];
  if (!unique.length) return new Map();
  const placeholders = unique.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT team_id, domain FROM domains WHERE verified = 1 AND team_id IN (${placeholders})`,
    )
    .bind(...unique)
    .all<{ team_id: string; domain: string }>();

  const map = new Map<string, Set<string>>();
  for (const r of results) {
    if (!map.has(r.team_id)) map.set(r.team_id, new Set());
    map.get(r.team_id)!.add(r.domain);
  }
  return map;
}
