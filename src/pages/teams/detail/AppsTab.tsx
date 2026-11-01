// Apps: the team's OAuth apps, with creating one or moving a personal app in.

import { Avatar, Button, Input, makeStyles } from "@fluentui/react-components";
import { DismissRegular, SearchRegular } from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useApi } from "../../../lib/api-context";
import { Pagination } from "../../../components/Pagination";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsFooter,
  SettingsLinkRow,
} from "../../../components/Settings";
import { SkeletonSettingsCard } from "../../../components/Skeletons";
import { MigrateAppDialog } from "../dialogs/MigrateAppDialog";
import { NewTeamAppDialog } from "../dialogs/NewTeamAppDialog";
import type { TeamTabProps } from "./types";

const PAGE_SIZE = 20;

const useStyles = makeStyles({
  toolbar: { padding: "0 var(--card-pad) 16px" },
});

export function AppsTab({ team, canManage, showMsg }: TeamTabProps) {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const teamId = team.id;

  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => {
      setDebounced(query.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [query]);

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
        <div className={styles.toolbar}>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("teams.searchTeamAppsPlaceholder")}
            contentBefore={<SearchRegular />}
            contentAfter={
              query ? (
                <Button
                  appearance="transparent"
                  size="small"
                  icon={<DismissRegular />}
                  aria-label={t("common.clear")}
                  onClick={() => setQuery("")}
                />
              ) : undefined
            }
            style={{ width: "100%" }}
          />
        </div>
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
      {total > PAGE_SIZE && (
        <SettingsFooter>
          <Pagination
            page={page}
            pageCount={Math.ceil(total / PAGE_SIZE)}
            onChange={setPage}
            disabled={isFetching}
          />
        </SettingsFooter>
      )}
    </SettingsCard>
  );
}
