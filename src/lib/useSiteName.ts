// The configured site name, for copy that refers to "this site". Shares the
// ["site"] query every page already loads (SSR prefetches it), so it is
// normally available on first render; "Prism" covers the brief gap.

import { useQuery } from "@tanstack/react-query";
import { useApi } from "./api-context";

export function useSiteName(): string {
  const api = useApi();
  const { data } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });
  return data?.site_name ?? "Prism";
}
