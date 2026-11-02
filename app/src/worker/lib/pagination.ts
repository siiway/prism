// Small helpers shared by list endpoints that paginate + search. Every list
// endpoint goes through them, so the param names, the bounds, and the LIKE
// escaping stay consistent — and a hostile `?limit=-1` cannot turn a page
// request into a full-table dump.

export interface PageOptions {
  page: number;
  limit: number;
  offset: number;
}

/** Parse `page`/`limit` query params with sane bounds. */
export function readPage(
  pageRaw: string | undefined,
  limitRaw: string | undefined,
  defaultLimit = 50,
  maxLimit = 100,
): PageOptions {
  const page = Math.max(1, Number(pageRaw) || 1);
  const limit = Math.min(
    maxLimit,
    Math.max(1, Number(limitRaw) || defaultLimit),
  );
  return { page, limit, offset: (page - 1) * limit };
}

/**
 * Escape user input for a `LIKE ... ESCAPE '\'` pattern so `%`/`_`/`\` in
 * the term are treated literally rather than widening the match.
 */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`;
}
