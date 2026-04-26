// Fetcher + site-wide cache for "GitHub profile" READMEs.
//
// A user's "profile README" is the README of the repo named the same as
// the user (the special `<login>/<login>` repository). We fetch it through
// the standard GitHub repos API so we get media-type negotiation, etag, and
// auth headers for free.
//
// Token cascade: unauthenticated first, then user PAT, then site PAT.
// We start unauthenticated because tokens have personal/site rate-limit
// budgets we'd rather not burn for routine views — if the 60/hr unauth
// ceiling kicks in (HTTP 403 with X-RateLimit-Remaining: 0), THEN we
// escalate to a token tier. A revoked user PAT (HTTP 401) also escalates
// to the next tier so that single request still completes. Each 401 on a
// tokened tier bumps a per-source failure counter; the token is auto-
// cleared once it hits 3 so we stop re-trying known-bad credentials.
// Counter resets on any non-401 response.
//
// 403s without a zero-remaining rate-limit header (perms revoked, repo
// blocked, etc.) are returned as-is — escalating wouldn't help.
//
// Caching is keyed by GitHub login, not by Prism user, so two Prism users
// pointing at the same `octocat` GitHub account share a cache entry. The
// cache stores the etag so refreshes use a conditional GET.

import { getConfig, setConfigValue } from "./config";
import { decryptSecret } from "./secretCrypto";

export interface GithubReadmeFetchResult {
  /** HTTP status from the GitHub API. 200 = new content, 304 = unchanged,
   *  404 = no README, 401 = bad credentials (token revoked/typo),
   *  403 = rate limited or repo blocked, 5xx = upstream broken. */
  status: number;
  /** Raw markdown source. Only set on 200; null on 304 (caller has the
   *  cached copy already), null on errors. */
  content: string | null;
  /** Returned etag — pass back on the next conditional GET. */
  etag: string | null;
  /** Parsed X-RateLimit-Remaining header. null when not present. Used by
   *  the cascade to distinguish a rate-limit 403 from a permissions 403. */
  rateLimitRemaining: number | null;
}

interface CacheRow {
  github_login: string;
  content: string | null;
  etag: string | null;
  status: number;
  fetched_at: number;
}

type TokenSource = "user" | "site" | "none";

interface ResolvedToken {
  source: TokenSource;
  token: string | null;
}

const GITHUB_API = "https://api.github.com";
const MAX_TOKEN_FAILURES = 3;

/** Threshold we use to cap 401 retries (exported so admin/UI can show it). */
export const GITHUB_TOKEN_FAILURE_LIMIT = MAX_TOKEN_FAILURES;

/** Build the ordered cascade of tokens to try for a given profile owner.
 *  Unauthenticated comes first so we don't burn token budget on routine
 *  fetches; tokens are escalated to only when the unauth tier hits its
 *  rate limit (or, for the user PAT, when the site PAT hits 401). */
async function resolveTokens(
  env: Env,
  ownerUserId: string,
): Promise<ResolvedToken[]> {
  const db = env.DB;
  const out: ResolvedToken[] = [{ source: "none", token: null }];

  const userRow = await db
    .prepare("SELECT github_readme_token FROM users WHERE id = ?")
    .bind(ownerUserId)
    .first<{ github_readme_token: string | null }>();
  if (userRow?.github_readme_token) {
    // PAT may be encrypted at rest; decrypt before sending to GitHub.
    const userToken = await decryptSecret(env, userRow.github_readme_token);
    if (userToken) out.push({ source: "user", token: userToken });
  }

  const config = await getConfig(db);
  if (config.github_readme_token) {
    const siteToken = await decryptSecret(env, config.github_readme_token);
    if (siteToken) out.push({ source: "site", token: siteToken });
  }

  return out;
}

/** Single-tier resolve, used by the manual-sync endpoint where we don't
 *  want fall-through retry behaviour to mask a config issue. */
export async function pickGithubToken(
  env: Env,
  ownerUserId: string,
): Promise<string | null> {
  const tiers = await resolveTokens(env, ownerUserId);
  return tiers[0]?.token ?? null;
}

/** Issue the request to GitHub. Honours `If-None-Match` for conditional GETs. */
export async function fetchGithubReadme(
  login: string,
  etag: string | null,
  token: string | null,
): Promise<GithubReadmeFetchResult> {
  const headers: Record<string, string> = {
    // raw media type returns the markdown source directly instead of base64-
    // encoded JSON. Saves a round of decoding and keeps the content stable.
    Accept: "application/vnd.github.raw+json",
    "User-Agent": "Prism (profile-readme-source)",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (etag) headers["If-None-Match"] = etag;
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(
      `${GITHUB_API}/repos/${encodeURIComponent(login)}/${encodeURIComponent(login)}/readme`,
      {
        method: "GET",
        headers,
        // Layered cache — Cloudflare's edge cache holds the response
        // briefly even before our D1 cache picks it up.
        cf: { cacheTtl: 60, cacheEverything: true },
      },
    );
  } catch {
    return { status: 502, content: null, etag, rateLimitRemaining: null };
  }

  const newEtag = res.headers.get("etag") ?? etag;
  const rlHeader = res.headers.get("x-ratelimit-remaining");
  const rateLimitRemaining = rlHeader === null ? null : parseInt(rlHeader, 10);

  if (res.status === 304) {
    return { status: 304, content: null, etag: newEtag, rateLimitRemaining };
  }
  if (!res.ok) {
    return {
      status: res.status,
      content: null,
      etag: newEtag,
      rateLimitRemaining,
    };
  }
  const content = await res.text();
  return { status: 200, content, etag: newEtag, rateLimitRemaining };
}

async function bumpTokenFailure(
  db: D1Database,
  ownerUserId: string,
  source: TokenSource,
): Promise<void> {
  if (source === "user") {
    // Atomically increment, then clear if we've hit the cap.
    await db
      .prepare(
        "UPDATE users SET github_readme_token_failures = github_readme_token_failures + 1 WHERE id = ?",
      )
      .bind(ownerUserId)
      .run();
    const row = await db
      .prepare("SELECT github_readme_token_failures FROM users WHERE id = ?")
      .bind(ownerUserId)
      .first<{ github_readme_token_failures: number }>();
    if ((row?.github_readme_token_failures ?? 0) >= MAX_TOKEN_FAILURES) {
      await db
        .prepare(
          "UPDATE users SET github_readme_token = NULL, github_readme_token_failures = 0 WHERE id = ?",
        )
        .bind(ownerUserId)
        .run();
    }
    return;
  }
  if (source === "site") {
    const config = await getConfig(db);
    const next = (config.github_readme_token_failures ?? 0) + 1;
    if (next >= MAX_TOKEN_FAILURES) {
      // Clear the token AND reset the counter in one shot.
      await Promise.all([
        setConfigValue(db, "github_readme_token", ""),
        setConfigValue(db, "github_readme_token_failures", 0),
      ]);
    } else {
      await setConfigValue(db, "github_readme_token_failures", next);
    }
    return;
  }
  // source === "none" — nothing to bump.
}

async function resetTokenFailures(
  db: D1Database,
  ownerUserId: string,
  source: TokenSource,
): Promise<void> {
  if (source === "user") {
    await db
      .prepare(
        "UPDATE users SET github_readme_token_failures = 0 WHERE id = ? AND github_readme_token_failures > 0",
      )
      .bind(ownerUserId)
      .run();
    return;
  }
  if (source === "site") {
    const config = await getConfig(db);
    if ((config.github_readme_token_failures ?? 0) > 0) {
      await setConfigValue(db, "github_readme_token_failures", 0);
    }
  }
}

/**
 * Fetch with the token cascade.
 *
 *   - 401 on a tokened tier → bump that tier's counter and fall through.
 *   - 403 with X-RateLimit-Remaining: 0 (any tier) → fall through. No
 *     counter bump — the credentials work, the quota's just gone.
 *   - Anything else (200/304/404/other 403/5xx) → return as-is. For a
 *     tokened tier we additionally reset its counter, since the request
 *     proved the credentials are accepted.
 *
 * The first tier is always unauthenticated, so a normal request that
 * succeeds within the public 60/hr ceiling never touches a token at all.
 */
async function fetchWithFallback(
  env: Env,
  ownerUserId: string,
  login: string,
  etag: string | null,
): Promise<GithubReadmeFetchResult> {
  const db = env.DB;
  const tiers = await resolveTokens(env, ownerUserId);
  let last: GithubReadmeFetchResult = {
    status: 0,
    content: null,
    etag,
    rateLimitRemaining: null,
  };

  for (const tier of tiers) {
    const result = await fetchGithubReadme(login, etag, tier.token);
    last = result;

    const isRateLimited =
      result.status === 403 && result.rateLimitRemaining === 0;

    if (result.status === 401 && tier.source !== "none") {
      // True auth failure on a token tier — record and fall through.
      await bumpTokenFailure(db, ownerUserId, tier.source);
      continue;
    }

    if (isRateLimited) {
      // Rate-limited at this tier. Don't bump any counter (credentials
      // are fine, the quota just ran out) — try the next tier instead.
      continue;
    }

    if (tier.source !== "none") {
      await resetTokenFailures(db, ownerUserId, tier.source);
    }
    return result;
  }

  return last;
}

/**
 * Read the README markdown for a GitHub login, going through the site cache.
 * Returns null when there is no README to show (404 or hard fetch failure
 * with no cache fallback).
 */
export async function getGithubReadmeFromCache(
  env: Env,
  ownerUserId: string,
  login: string,
): Promise<string | null> {
  const db = env.DB;
  const normalized = login.toLowerCase();
  const config = await getConfig(db);
  const ttl = config.github_readme_cache_ttl_seconds;
  const now = Math.floor(Date.now() / 1000);

  const cached = await db
    .prepare("SELECT * FROM github_readme_cache WHERE github_login = ?")
    .bind(normalized)
    .first<CacheRow>();

  if (cached && now - cached.fetched_at < ttl) {
    return cached.status === 200 ? cached.content : null;
  }

  const result = await fetchWithFallback(
    env,
    ownerUserId,
    normalized,
    cached?.etag ?? null,
  );

  if (result.status === 304 && cached) {
    await db
      .prepare(
        "UPDATE github_readme_cache SET fetched_at = ?, etag = ? WHERE github_login = ?",
      )
      .bind(now, result.etag, normalized)
      .run();
    return cached.content;
  }

  if (result.status === 200) {
    await db
      .prepare(
        `INSERT INTO github_readme_cache (github_login, content, etag, status, fetched_at)
         VALUES (?, ?, ?, 200, ?)
         ON CONFLICT(github_login) DO UPDATE SET
           content = excluded.content,
           etag = excluded.etag,
           status = 200,
           fetched_at = excluded.fetched_at`,
      )
      .bind(normalized, result.content, result.etag, now)
      .run();
    return result.content;
  }

  if (result.status === 404) {
    await db
      .prepare(
        `INSERT INTO github_readme_cache (github_login, content, etag, status, fetched_at)
         VALUES (?, NULL, NULL, 404, ?)
         ON CONFLICT(github_login) DO UPDATE SET
           content = NULL,
           etag = NULL,
           status = 404,
           fetched_at = excluded.fetched_at`,
      )
      .bind(normalized, now)
      .run();
    return null;
  }

  // Any other failure (rate limit, all-tiers-401, upstream 5xx, network) —
  // fall back to whatever stale content we have rather than blanking.
  return cached?.status === 200 ? cached.content : null;
}
