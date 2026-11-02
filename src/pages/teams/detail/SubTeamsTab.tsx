// Sub-teams: teams nested under this one, which inherit its members and
// verified domains.

import { Avatar } from "@fluentui/react-components";
import { useState } from "react";
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
import { ListSearch } from "../../../components/ListSearch";
import { useDebouncedSearch } from "../../../lib/useDebouncedSearch";

const PAGE_SIZE = 20;

export function SubTeamsTab({ team, canManage, showMsg }: TeamTabProps) {
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
        <ListSearch
          value={query}
          onChange={setQuery}
          placeholder={t("teams.searchSubTeamsPlaceholder")}
        />
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
      {(total > PAGE_SIZE || page > 1) && (
        <SettingsFooter>
          <Pagination
            page={page}
            pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
            onChange={setPage}
            disabled={isFetching}
          />
        </SettingsFooter>
      )}
    </SettingsCard>
  );
}
