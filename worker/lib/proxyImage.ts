// Build URLs that route external images through the sanitizing reverse proxy.
//
// The proxy no longer accepts arbitrary URLs from the request — instead it
// looks up an opaque id in image_proxy_mappings (see migration 0043). This
// helper computes the deterministic id, registers the (id, url) pair on
// first use, and returns the public proxy URL the client can fetch.
//
// id = first 32 hex chars of sha256(url). Deterministic so repeat calls
// for the same URL return the same id; INSERT OR IGNORE keeps the table
// duplicate-free across racing handlers.
//
// An isolate-level Map memoizes already-registered URLs so a single page
// render with several proxied images doesn't write the same row over and
// over.

import { sha256Hex } from "./crypto";

const memoCache = new Map<string, string>();

export function forgetImageProxyMapping(url: string): void {
  memoCache.delete(url);
}

/** Deterministic id for a given URL (sha256 prefix). Pure function, no DB. */
export async function imageProxyId(url: string): Promise<string> {
  return (await sha256Hex(url)).slice(0, 32);
}

/**
 * Persist a (url -> id) mapping if missing and return the id.
 * Use this from write paths (avatar updates, OAuth app icon edits, social
 * login profile pulls, etc.) so that subsequent reads can resolve the id.
 *
 * createdBy is the user this mapping should be attributed to in the admin
 * panel. Pass null for system-driven server-side renders where no single
 * user owns the URL (the user/team/app row already attributes the data).
 */
export async function registerImageProxyMapping(
  db: D1Database,
  url: string,
  createdBy: string | null = null,
): Promise<string> {
  const cached = memoCache.get(url);
  if (cached) return cached;
  const id = await imageProxyId(url);
  await db
    .prepare(
      "INSERT OR IGNORE INTO image_proxy_mappings (id, url, created_by, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(id, url, createdBy, Math.floor(Date.now() / 1000))
    .run();
  memoCache.set(url, id);
  return id;
}

/**
 * Rewrite an image URL to route through the sanitizing reverse proxy.
 * Local assets (starting with "/") are made absolute using the base URL.
 * Returns null when the input is null/undefined/empty.
 *
 * Registers the mapping inline so the returned URL is always servable.
 * No createdBy because this is the read-path helper — call sites are
 * rendering data that already has its own ownership chain (avatar_url
 * belongs to the user row, icon_url to the app row, etc.).
 */
export async function proxyImageUrl(
  baseUrl: string,
  db: D1Database,
  url: string | null | undefined,
): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("/")) return `${baseUrl}${url}`;
  const id = await registerImageProxyMapping(db, url);
  return `${baseUrl}/api/proxy/image/${id}`;
}

const HTML_IMG_RE = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
const MD_IMG_RE = /!\[[^\]]*\]\(\s*([^)\s]+)/g;

/**
 * Pull every https:// image URL out of a markdown blob — both <img src=…>
 * and ![alt](url) forms. Used by the README save paths so anonymous
 * profile viewers (who can't hit the authenticated /register endpoint)
 * still find each embedded image already mapped.
 */
export function extractMarkdownImageUrls(source: string): string[] {
  const urls = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = HTML_IMG_RE.exec(source)) !== null) urls.add(m[1]);
  while ((m = MD_IMG_RE.exec(source)) !== null) urls.add(m[1]);
  return [...urls].filter((u) => /^https:\/\//i.test(u));
}

/** Register every image URL embedded in a markdown blob. Idempotent. */
export async function registerMarkdownImageMappings(
  db: D1Database,
  source: string | null | undefined,
  createdBy: string | null = null,
): Promise<void> {
  if (!source) return;
  const urls = extractMarkdownImageUrls(source);
  if (urls.length === 0) return;
  await Promise.all(
    urls.map((u) => registerImageProxyMapping(db, u, createdBy)),
  );
}

/**
 * Build the set of every external image URL the deployment is currently
 * referencing — avatars, icons, the site icon, plus images embedded in
 * profile READMEs and the GitHub README cache. Used both by the admin
 * backfill (turn URLs INTO mappings) and by the orphan sweep (find
 * mappings whose URL is no longer referenced anywhere).
 */
export async function collectReferencedImageUrls(
  db: D1Database,
): Promise<Set<string>> {
  const urls = new Set<string>();
  const add = (v: string | null | undefined) => {
    if (!v) return;
    const trimmed = v.trim();
    if (!trimmed || trimmed.startsWith("/")) return;
    urls.add(trimmed);
  };

  const [users, teams, apps, sources, siteIcon, readmes, ghReadmes] =
    await Promise.all([
      db
        .prepare(
          "SELECT avatar_url FROM users WHERE avatar_url IS NOT NULL AND avatar_url != ''",
        )
        .all<{ avatar_url: string }>(),
      db
        .prepare(
          "SELECT avatar_url FROM teams WHERE avatar_url IS NOT NULL AND avatar_url != ''",
        )
        .all<{ avatar_url: string }>(),
      db
        .prepare(
          "SELECT icon_url FROM oauth_apps WHERE icon_url IS NOT NULL AND icon_url != ''",
        )
        .all<{ icon_url: string }>(),
      db
        .prepare(
          "SELECT icon_url FROM oauth_sources WHERE icon_url IS NOT NULL AND icon_url != ''",
        )
        .all<{ icon_url: string }>(),
      db
        .prepare("SELECT value FROM site_config WHERE key = 'site_icon_url'")
        .first<{ value: string }>(),
      db
        .prepare(
          "SELECT profile_readme FROM users WHERE profile_readme IS NOT NULL AND profile_readme != ''",
        )
        .all<{ profile_readme: string }>(),
      db
        .prepare(
          "SELECT content FROM github_readme_cache WHERE content IS NOT NULL AND status = 200",
        )
        .all<{ content: string }>(),
    ]);

  for (const r of users.results) add(r.avatar_url);
  for (const r of teams.results) add(r.avatar_url);
  for (const r of apps.results) add(r.icon_url);
  for (const r of sources.results) add(r.icon_url);
  if (siteIcon?.value) {
    try {
      const parsed = JSON.parse(siteIcon.value);
      if (typeof parsed === "string") add(parsed);
    } catch {
      // Older rows may store the URL raw — treat as a string.
      add(siteIcon.value);
    }
  }
  for (const r of readmes.results) {
    for (const u of extractMarkdownImageUrls(r.profile_readme)) add(u);
  }
  for (const r of ghReadmes.results) {
    for (const u of extractMarkdownImageUrls(r.content)) add(u);
  }

  return urls;
}

/**
 * Delete image_proxy_mappings rows whose URL no longer appears in any
 * reference column. Cron-safe (idempotent, bounded work) and also called
 * via waitUntil after deletes that are likely to orphan large batches
 * (admin user delete, README rewrite, etc.).
 *
 * Mappings created within graceSeconds are skipped so a registration
 * racing this sweep doesn't get pruned before the parent row's INSERT
 * lands. Default 5 minutes — comfortable for a typical write path.
 *
 * Also flushes the per-isolate registration memo so a URL that was
 * just deleted will be re-inserted on the next register call rather
 * than silently skipped.
 */
export async function sweepOrphanedImageProxyMappings(
  db: D1Database,
  opts: { graceSeconds?: number } = {},
): Promise<{ deleted: number }> {
  const grace = opts.graceSeconds ?? 5 * 60;
  const cutoff = Math.floor(Date.now() / 1000) - grace;

  const referenced = await collectReferencedImageUrls(db);

  const candidates = await db
    .prepare("SELECT id, url FROM image_proxy_mappings WHERE created_at < ?")
    .bind(cutoff)
    .all<{ id: string; url: string }>();

  const orphans = candidates.results.filter((r) => !referenced.has(r.url));
  if (orphans.length === 0) return { deleted: 0 };

  // D1 batch caps around 100 statements; chunk to be safe.
  const CHUNK = 50;
  for (let i = 0; i < orphans.length; i += CHUNK) {
    const slice = orphans.slice(i, i + CHUNK);
    await db.batch(
      slice.map((o) =>
        db.prepare("DELETE FROM image_proxy_mappings WHERE id = ?").bind(o.id),
      ),
    );
  }

  // Drop memoized URLs that we just deleted so a subsequent register
  // call actually re-INSERTs instead of returning the cached id.
  for (const o of orphans) memoCache.delete(o.url);

  return { deleted: orphans.length };
}
