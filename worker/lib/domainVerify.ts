// Helpers for computing app is_verified from the owner's verified domains.
// An app is considered verified when EVERY non-localhost redirect URI hostname
// is covered by a verified domain owned by the same user
// (exact match or subdomain: sub.example.com matches example.com).
// Localhost / 127.0.0.1 / ::1 redirect URIs are excluded from this requirement.

import { parseRedirectUris } from "./redirectUri";

function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/**
 * Normalize a user-entered domain: tolerate a pasted URL
 * ("https://Example.COM/path" → "example.com"), stray path segments,
 * surrounding whitespace, uppercase, and a trailing DNS-root dot.
 * Returns the cleaned domain; validation against the domain regex still
 * happens at the call site.
 */
export function normalizeDomainInput(raw: string): string {
  let domain = raw.trim().toLowerCase();
  if (domain.includes("://")) {
    try {
      domain = new URL(domain).hostname;
    } catch {
      /* not a parseable URL — fall through with the raw value */
    }
  } else {
    // Strip any path/query the user pasted alongside the bare host
    domain = domain.split(/[/?#]/)[0];
  }
  return domain.replace(/\.+$/, "");
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

  // Only `equals` entries carry a concrete hostname we can verify against a
  // domain. Wildcard/regex entries are inherently unbounded, so an app that
  // uses them cannot be auto-verified from redirect URIs alone.
  const uris = parseRedirectUris(redirectUrisJson)
    .filter((e) => e.type === "equals")
    .map((e) => e.value);

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

/**
 * Resolves the effective verification status of an app, where an explicit
 * admin override (1 = verified, -1 = unverified) takes precedence over
 * automatic domain-based verification.
 */
export function resolveAppVerified(
  storedVerified: number | undefined | null,
  computedVerified: boolean,
): boolean {
  if (storedVerified === 1) return true;
  if (storedVerified === -1) return false;
  return computedVerified;
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
