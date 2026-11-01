// Notification prefs and the destinations built from them, for the
// Notifications page and the ruleset pages.

import { useQuery } from "@tanstack/react-query";
import { useApi } from "../../lib/api-context";
import { listDestinations } from "./destinations";

export function useDestinations() {
  const api = useApi();
  const prefs = useQuery({
    queryKey: ["notification-prefs"],
    queryFn: () => api.getNotificationPrefs(),
  });
  const { data: site } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });
  const hasTgBot = !!site?.tg_notify_source_slug;
  const hasDiscordBot = !!site?.discord_notify_source_slug;
  return {
    prefs: prefs.data,
    isLoading: prefs.isLoading,
    hasTgBot,
    hasDiscordBot,
    destinations: listDestinations(prefs.data, hasDiscordBot),
  };
}
