// Sub-teams: teams nested under this one, which inherit its members and
// verified domains.

import { Avatar, Button, Input, makeStyles } from "@fluentui/react-components";
import { DismissRegular, SearchRegular } from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useApi } from "../../../lib/api-context";
import { Pagination } from "../../../components/Pagination";
import { RoleBadge } from "../../../components/RoleBadge";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsFooter,
  SettingsLinkRow,
} from "../../../components/Settings";
import { SkeletonSettingsCard } from "../../../components/Skeletons";
import { CreateSubTeamDialog } from "../dialogs/CreateSubTeamDialog";
import type { TeamTabProps } from "./types";

const PAGE_SIZE = 20;

const useStyles = makeStyles({
  toolbar: { padding: "0 var(--card-pad) 16px" },
});

export function SubTeamsTab({ team, canManage, showMsg }: TeamTabProps) {
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
    queryKey: ["sub-teams", teamId, page, debounced],
    queryFn: () =>
      api.listSubTeams(teamId, {
        page,
        limit: PAGE_SIZE,
        q: debounced || undefined,
      }),
  });
  const subTeams = data?.sub_teams ?? [];
  const total = data?.total ?? 0;

  if (isLoading) return <SkeletonSettingsCard rows={2} />;

  return (
    <SettingsCard
      id="sub-teams"
      title={t("teams.subTeamsTitle")}
      description={t("teams.subTeamsCardDesc")}
      action={
        canManage && (
          <CreateSubTeamDialog parentTeamId={teamId} showMsg={showMsg} />
        )
      }
    >
      {(total > 5 || debounced) && (
        <div className={styles.toolbar}>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("teams.searchSubTeamsPlaceholder")}
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
      {subTeams.length === 0 ? (
        <SettingsEmpty>
          {debounced ? t("teams.noSubTeamsMatch") : t("teams.noSubTeams")}
        </SettingsEmpty>
      ) : (
        subTeams.map((sub) => (
          <SettingsLinkRow
            key={sub.id}
            to={`/teams/${sub.id}`}
            icon={
              <Avatar
                image={sub.avatar_url ? { src: sub.avatar_url } : undefined}
                name={sub.name}
                size={32}
              />
            }
            label={
              <>
                {sub.name}
                <RoleBadge role={sub.my_role} />
              </>
            }
            meta={t("teams.memberCountShort", { count: sub.member_count })}
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
