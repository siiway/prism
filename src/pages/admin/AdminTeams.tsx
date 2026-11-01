// Admin team list: every team on the instance. Rows open the team's own page
// on its Moderation tab (invite sign-up, staged dissolution); members, apps
// and deletion are managed there with site-admin authority. New team opens
// /teams/new, where a site admin can name the owner.

import {
  Avatar,
  Badge,
  Button,
  Skeleton,
  SkeletonItem,
} from "@fluentui/react-components";
import { AddRegular, PeopleTeamRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useApi } from "../../lib/api-context";
import { formatDate } from "../../lib/datetime";
import { useDebouncedSearch } from "../../lib/useDebouncedSearch";
import { usePageClamp } from "../../lib/usePageClamp";
import {
  DataList,
  DataListName,
  DataListRow,
  type DataListColumn,
} from "../../components/DataList";
import { EmptyState } from "../../components/EmptyState";
import { ListSearch } from "../../components/ListSearch";
import { Pagination } from "../../components/Pagination";

const PAGE_SIZE = 20;
const FROM = { from: "admin-teams" };

export function AdminTeams() {
  const api = useApi();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const { query, setQuery, search } = useDebouncedSearch(() => setPage(1));

  const { data, isFetching } = useQuery({
    queryKey: ["admin-teams", page, search],
    queryFn: () => api.adminListTeams(page, search),
  });
  const teams = data?.teams ?? [];
  const total = data?.total ?? 0;
  usePageClamp(page, data?.total, PAGE_SIZE, setPage);

  const columns: DataListColumn[] = [
    { label: t("admin.teamHeader"), width: "minmax(0, 2.2fr)" },
    {
      label: t("admin.ownerHeader"),
      width: "minmax(0, 1.2fr)",
      secondary: true,
    },
    {
      label: t("admin.membersHeader"),
      width: "80px",
      secondary: true,
      end: true,
    },
    { label: t("admin.appsHeader"), width: "60px", secondary: true, end: true },
    {
      label: t("teams.moderation.inviteColumn"),
      width: "130px",
      secondary: true,
    },
    { label: t("admin.createdHeader"), width: "100px", secondary: true },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <ListSearch
        value={query}
        onChange={setQuery}
        placeholder={t("admin.searchTeams")}
      >
        <Button
          appearance="primary"
          icon={<AddRegular />}
          onClick={() => navigate("/teams/new", { state: FROM })}
        >
          {t("admin.teamCreate")}
        </Button>
      </ListSearch>

      {isFetching && !data ? (
        <Skeleton aria-busy>
          <DataList columns={columns} linked>
            {Array.from({ length: 4 }).map((_, i) => (
              <DataListRow
                key={i}
                cells={columns.map((_, c) => (
                  <SkeletonItem
                    key={c}
                    size={12}
                    style={{ width: c === 0 ? `${40 + (i % 3) * 12}%` : 40 }}
                  />
                ))}
              />
            ))}
          </DataList>
        </Skeleton>
      ) : teams.length === 0 ? (
        <EmptyState
          icon={<PeopleTeamRegular />}
          title={search ? t("teams.noResultsMatch") : t("teams.noTeamsYet")}
        />
      ) : (
        <>
          <DataList columns={columns} linked>
            {teams.map((team) => (
              <DataListRow
                key={team.id}
                to={`/teams/${team.id}?tab=moderation`}
                state={FROM}
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
                    name={team.name}
                    sub={team.description || team.id}
                  />,
                  team.owner_username ? `@${team.owner_username}` : "—",
                  team.member_count,
                  team.app_count,
                  team.dissolving_at ? (
                    <Badge
                      key="invite"
                      appearance="tint"
                      color="danger"
                      size="small"
                    >
                      {t("teams.moderation.dissolving")}
                    </Badge>
                  ) : team.invite_registration_granted ? (
                    <Badge
                      key="invite"
                      appearance="tint"
                      color="brand"
                      size="small"
                    >
                      {t("teams.moderation.granted")}
                    </Badge>
                  ) : (
                    "—"
                  ),
                  formatDate(team.created_at),
                ]}
              />
            ))}
          </DataList>
          {(total > PAGE_SIZE || page > 1) && (
            <Pagination
              page={page}
              pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
              total={total}
              onChange={setPage}
              disabled={isFetching}
            />
          )}
        </>
      )}
    </div>
  );
}
