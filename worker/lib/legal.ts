// Operator-authored legal pages (Privacy Policy, Terms of Service).
//
// These live in their own `legal_documents` D1 table rather than in the
// `site_config` key-value store. getConfig() loads every site_config row into
// memory on essentially every request, and a policy is a long document (capped
// at LEGAL_MAX_BYTES) that the overwhelming majority of requests never render
// — paying to read it on that hot path is the wrong trade. See
// worker/db/migrations/0061_legal_documents.sql.

/** The fixed set of documents, addressed by slug. The slug is what the
 *  /legal/:doc endpoint and the /privacy, /terms pages use. */
export const LEGAL_SLUGS = ["privacy", "terms"] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

export function isLegalSlug(v: string): v is LegalSlug {
  return (LEGAL_SLUGS as readonly string[]).includes(v);
}

/** Free-form markdown, capped so a runaway paste can't bloat a row — or the
 *  audit entry that records the change. 256 KiB dwarfs any real policy while
 *  staying well clear of D1's row limits. */
export const LEGAL_MAX_BYTES = 256 * 1024;

export interface LegalDocumentRow {
  slug: string;
  content: string;
  updated_at: number;
  updated_by: string | null;
}

export async function getLegalDocument(
  db: D1Database,
  slug: string,
): Promise<LegalDocumentRow | null> {
  return db
    .prepare(
      "SELECT slug, content, updated_at, updated_by FROM legal_documents WHERE slug = ?",
    )
    .bind(slug)
    .first<LegalDocumentRow>();
}

/** Every document, published or not — for the admin editor. */
export async function listLegalDocuments(
  db: D1Database,
): Promise<LegalDocumentRow[]> {
  const { results } = await db
    .prepare(
      "SELECT slug, content, updated_at, updated_by FROM legal_documents",
    )
    .all<LegalDocumentRow>();
  return results;
}

/** Slugs whose document is published (non-empty). Read by the /site payload so
 *  the footer knows which links to render without shipping the content. */
export async function listPublishedLegalSlugs(
  db: D1Database,
): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT slug FROM legal_documents WHERE content != ''")
    .all<{ slug: string }>();
  return results.map((r) => r.slug);
}

export async function upsertLegalDocument(
  db: D1Database,
  slug: string,
  content: string,
  userId: string | null,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO legal_documents (slug, content, updated_at, updated_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET
         content = excluded.content,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
    )
    .bind(slug, content, now, userId)
    .run();
}
