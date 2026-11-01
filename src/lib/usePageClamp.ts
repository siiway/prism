// Keep a paged list on a page that exists. Removing the last row on the last
// page (or filtering elsewhere) can leave `page` past the end, where the
// list would show as empty with no pager to get back; this steps back to
// the last page that still has rows.

import { useEffect } from "react";

export function usePageClamp(
  page: number,
  /** Total rows from the latest response; undefined while loading. */
  total: number | undefined,
  pageSize: number,
  setPage: (page: number) => void,
) {
  useEffect(() => {
    if (total === undefined) return;
    const last = Math.max(1, Math.ceil(total / pageSize));
    if (page > last) setPage(last);
  }, [page, total, pageSize, setPage]);
}
