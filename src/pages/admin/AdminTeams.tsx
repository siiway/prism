// Admin team list: every team on the instance. Rows open the team's own page
// on its Moderation tab (invite sign-up, converting, staged dissolution);
// a filter narrows the list to teams with either set. Members, apps
// and deletion are managed there with site-admin authority. New team opens
// /teams/new, where a site admin can name the owner.

import { Avatar, Badge, Button, makeStyles } from "@fluentui/react-components";
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
  type DataListColumn,
  DataListName,
  DataListRow,
  DataListSkeleton,
} from "../../components/DataList";
import { EmptyState } from "../../components/EmptyState";
import { ListSearch } from "../../components/ListSearch";
import { Pagination } from "../../components/Pagination";
import { Select } from "../../components/Select";

const PAGE_SIZE = 20;

const useStyles = makeStyles({
  badges: { display: "flex", gap: "4px", flexWrap: "wrap" },
});
const FROM = { from: "admin-teams" };

export function AdminTeams() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const { query, setQuery, search } = useDebouncedSearch(() => setPage(1));
  // Teams a site admin has set something for: invite sign-up, or converting.
  const [filter, setFilter] = useState<"" | "invite_signup" | "convert">("");

  const { data, isFetching } = useQuery({
    queryKey: ["admin-teams", page, search, filter],
    queryFn: () => api.adminListTeams(page, search, filter || undefined),
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
      width: "150px",
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
        <Select
          aria-label={t("admin.teamFilter")}
          style={{ width: 200 }}
          value={filter}
          onChange={(_, d) => {
            setFilter(d.value as typeof filter);
            setPage(1);
          }}
        >
          <option value="">{t("admin.teamFilterAll")}</option>
          <option value="invite_signup">
            {t("admin.teamFilterInviteSignup")}
          </option>
          <option value="convert">{t("admin.teamFilterConvert")}</option>
        </Select>
        <Button
          appearance="primary"
          icon={<AddRegular />}
          onClick={() => navigate("/teams/new", { state: FROM })}
        >
          {t("admin.teamCreate")}
        </Button>
      </ListSearch>

      {isFetching && !data ? (
        <DataListSkeleton columns={columns} linked rows={4} />
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
                  ) : team.invite_registration_granted ||
                    team.invite_registration_allow_convert != null ? (
                    <span key="invite" className={styles.badges}>
                      {!!team.invite_registration_granted && (
                        <Badge appearance="tint" color="brand" size="small">
                          {t("teams.moderation.granted")}
                        </Badge>
                      )}
                      {/* Only an override; the site default isn't news. */}
                      {team.invite_registration_allow_convert != null && (
                        <Badge appearance="outline" size="small">
                          {team.invite_registration_allow_convert
                            ? t("teams.moderation.convertBadgeOn")
                            : t("teams.moderation.convertBadgeOff")}
                        </Badge>
                      )}
                    </span>
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
