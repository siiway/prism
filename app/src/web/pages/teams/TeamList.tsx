// Teams list page: one bordered list, a row per team.

import { Avatar, Badge, Button } from "@fluentui/react-components";
import { AddRegular, PeopleRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useApi } from "../../lib/api-context";
import { formatDate } from "../../lib/datetime";
import { useDebouncedSearch } from "../../lib/useDebouncedSearch";
import { CopyIdText } from "../../components/CopyIdTrigger";
import {
  DataList,
  DataListLink,
  DataListName,
  DataListRow,
  DataListSkeleton,
  type DataListColumn,
} from "../../components/DataList";
import { EmptyState } from "../../components/EmptyState";
import { GetStartedPanel } from "../../components/GetStartedPanel";
import { TeamArt } from "../../components/Illustrations";
import { ListSearch } from "../../components/ListSearch";
import { PageHeader } from "../../components/PageHeader";
import { Pagination } from "../../components/Pagination";
import { RoleBadge } from "../../components/RoleBadge";

const PAGE_SIZE = 20;

export function TeamList() {
  const api = useApi();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [page, setPage] = useState(1);
  const { query, setQuery, search } = useDebouncedSearch(() => setPage(1));

  const { data, isFetching } = useQuery({
    queryKey: ["teams", page, search],
    queryFn: () =>
      api.listTeams({ page, limit: PAGE_SIZE, q: search || undefined }),
  });

  const columns: DataListColumn[] = [
    { label: t("apps.colName"), width: "minmax(0, 2.2fr)" },
    {
      label: t("teams.colTeamId"),
      width: "minmax(0, 1.6fr)",
      secondary: true,
    },
    { label: t("teams.roleHeader"), width: "120px", secondary: true },
    { label: t("apps.colCreated"), width: "110px", secondary: true },
  ];

  const newTeamButton = (
    <Button
      appearance="primary"
      icon={<AddRegular />}
      onClick={() => navigate("/teams/new")}
    >
      {t("teams.newTeam")}
    </Button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <PageHeader
        title={t("teams.title")}
        subtitle={t("teams.subtitle")}
        actions={newTeamButton}
      />

      {isFetching && !data && (
        <DataListSkeleton columns={columns} icon="circle" />
      )}

      {!isFetching && data?.teams.length === 0 && !search && (
        <GetStartedPanel
          art={<TeamArt />}
          title={t("teams.getStarted.title")}
          description={t("teams.getStarted.desc")}
          steps={[
            t("teams.getStarted.step1"),
            t("teams.getStarted.step2"),
            t("teams.getStarted.step3"),
          ]}
          action={newTeamButton}
        />
      )}

      {data && (data.teams.length > 0 || search) && (
        <ListSearch
          value={query}
          onChange={setQuery}
          placeholder={t("teams.searchTeamsPlaceholder")}
        />
      )}

      {!isFetching && data?.teams.length === 0 && search && (
        <EmptyState
          icon={<PeopleRegular />}
          title={t("teams.noResultsMatch")}
        />
      )}

      {data && data.teams.length > 0 && (
        <>
          <DataList columns={columns}>
            {data.teams.map((team) => (
              <DataListRow
                key={team.id}
                onClick={() => navigate(`/teams/${team.id}`)}
                cells={[
                  <DataListName
                    key="name"
                    icon={
                      <Avatar
                        image={
                          team.avatar_url ? { src: team.avatar_url } : undefined
                        }
                        name={team.name}
                        size={32}
                      />
                    }
                    name={
                      <DataListLink to={`/teams/${team.id}`}>
                        {team.name}
                      </DataListLink>
                    }
                    badges={
                      team.inherited_from && (
                        <Badge
                          appearance="outline"
                          color="informative"
                          size="small"
                        >
                          {t("teams.inheritedBadge")}
                        </Badge>
                      )
                    }
                    sub={team.description || undefined}
                  />,
                  <CopyIdText
                    key="id"
                    id={team.id}
                    label={t("common.copyTeamId")}
                    copiedLabel={t("common.copiedTeamId")}
                  />,
                  <RoleBadge key="role" role={team.role} />,
                  formatDate(team.created_at),
                ]}
              />
            ))}
          </DataList>
          <Pagination
            page={page}
            total={data.total}
            pageSize={PAGE_SIZE}
            onChange={setPage}
            disabled={isFetching}
          />
        </>
      )}
    </div>
  );
}
