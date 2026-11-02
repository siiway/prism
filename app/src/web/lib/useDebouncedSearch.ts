import { useEffect, useState } from "react";

/** A search box value plus its debounced, trimmed copy; resets the page when
 *  the search settles. */
export function useDebouncedSearch(onSettle?: () => void, delay = 250) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(query.trim());
      onSettle?.();
    }, delay);
    return () => clearTimeout(id);
    // onSettle is a setter-style callback; re-running on its identity would
    // restart the timer every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, delay]);
  return { query, setQuery, search };
}
