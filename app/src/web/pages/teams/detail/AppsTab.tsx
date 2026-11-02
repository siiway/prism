// Apps: the team's OAuth apps, with creating one or moving a personal app in.

import { Avatar } from "@fluentui/react-components";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useApi } from "../../../lib/api-context";
import { Pagination } from "../../../components/Pagination";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsLinkRow,
} from "../../../components/Settings";
import { SkeletonSettingsCard } from "../../../components/Skeletons";
import { MigrateAppDialog } from "../dialogs/MigrateAppDialog";
import { NewTeamAppDialog } from "../dialogs/NewTeamAppDialog";
import type { TeamTabProps } from "./types";
import { useDebouncedSearch } from "../../../lib/useDebouncedSearch";
import { ListSearch } from "../../../components/ListSearch";

const PAGE_SIZE = 20;

export function AppsTab({ team, canManage, showMsg }: TeamTabProps) {
  const api = useApi();
  const { t } = useTranslation();
  const teamId = team.id;

  const [page, setPage] = useState(1);
  const {
    query,
    setQuery,
    search: debounced,
  } = useDebouncedSearch(() => setPage(1));

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["team-apps", teamId, page, debounced],
    queryFn: () =>
      api.listTeamApps(teamId, {
        page,
        limit: PAGE_SIZE,
        q: debounced || undefined,
      }),
  });
  const apps = data?.apps ?? [];
  const total = data?.total ?? 0;

  // Personal apps that could move into the team.
  const { data: myApps } = useQuery({
    queryKey: ["apps"],
    queryFn: () => api.listApps(),
    enabled: canManage,
  });
  const personalApps = (myApps?.apps ?? []).filter((a) => !a.team_id);

  if (isLoading) return <SkeletonSettingsCard rows={3} />;

  return (
    <SettingsCard
      id="apps"
      title={t("teams.appsTitle")}
      description={t("teams.appsDesc")}
      action={
        canManage && (
          <>
            {personalApps.length > 0 && (
              <MigrateAppDialog
                teamId={teamId}
                personalApps={personalApps}
                showMsg={showMsg}
              />
            )}
            <NewTeamAppDialog teamId={teamId} showMsg={showMsg} />
          </>
        )
      }
    >
      {(total > 5 || debounced) && (
        <ListSearch
          value={query}
          onChange={setQuery}
          placeholder={t("teams.searchTeamAppsPlaceholder")}
        />
      )}
      {apps.length === 0 ? (
        <SettingsEmpty>
          {debounced ? t("teams.noAppsMatch") : t("teams.noAppsInTeam")}
        </SettingsEmpty>
      ) : (
        apps.map((app) => (
          <SettingsLinkRow
            key={app.id}
            to={`/apps/${app.id}`}
            icon={
              <Avatar
                image={app.icon_url ? { src: app.icon_url } : undefined}
                name={app.name}
                size={32}
                shape="square"
              />
            }
            label={app.name}
            description={app.description || undefined}
            meta={
              app.is_public ? t("apps.typePublic") : t("apps.typeConfidential")
            }
          />
        ))
      )}
      <Pagination
        page={page}
        total={total}
        pageSize={PAGE_SIZE}
        onChange={setPage}
        disabled={isFetching}
        footer
      />
    </SettingsCard>
  );
}
