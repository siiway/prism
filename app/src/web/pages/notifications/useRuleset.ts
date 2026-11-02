// One ruleset from the cached list (there is no single-ruleset endpoint),
// and saving its rules, for the ruleset page and the rule pages.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationRulesetRule } from "../../lib/api";
import { useApi } from "../../lib/api-context";

export function useRuleset(id: string) {
  const api = useApi();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["notification-rulesets"],
    queryFn: () => api.listNotificationRulesets(),
  });
  const ruleset = query.data?.rulesets.find((r) => r.id === id);

  /** Replace the ruleset's rules; throws ApiError on failure. */
  const saveRules = async (rules: NotificationRulesetRule[]) => {
    await api.updateNotificationRuleset(id, { rules });
    await qc.invalidateQueries({ queryKey: ["notification-rulesets"] });
  };

  return { ruleset, isLoading: query.isLoading, saveRules };
}
