// Teams list page

import {
  Avatar,
  Badge,
  Button,
  Input,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  PeopleRegular,
  SearchRegular,
  DismissRegular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useApi } from "../../lib/api-context";
import { CopyIdTrigger } from "../../components/CopyIdTrigger";
import { EmptyState } from "../../components/EmptyState";
import { GetStartedPanel } from "../../components/GetStartedPanel";
import { TeamArt } from "../../components/Illustrations";
import { PageHeader } from "../../components/PageHeader";
import { Pagination } from "../../components/Pagination";
import { SkeletonAppCards } from "../../components/Skeletons";

const useStyles = makeStyles({
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: "12px",
  },
  card: {
    cursor: "pointer",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "10px",
    padding: "16px",
    background: tokens.colorNeutralBackground1,
    transition: "border-color 0.15s",
    ":hover": {
      borderTopColor: tokens.colorNeutralForeground1,
      borderRightColor: tokens.colorNeutralForeground1,
      borderBottomColor: tokens.colorNeutralForeground1,
      borderLeftColor: tokens.colorNeutralForeground1,
    },
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
});

const ROLE_COLORS: Record<
  string,
  "brand" | "success" | "subtle" | "informative"
> = {
  owner: "brand",
  "co-owner": "informative",
  admin: "success",
  member: "subtle",
};

export function TeamList() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [query]);

  const { data, isFetching } = useQuery({
    queryKey: ["teams", page, debouncedQuery],
    queryFn: () =>
      api.listTeams({
        page,
        limit: 20,
        q: debouncedQuery || undefined,
      }),
  });

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
      <PageHeader title={t("teams.title")} actions={newTeamButton} />

      {isFetching && !data && <SkeletonAppCards count={4} />}

      {!isFetching && data?.teams.length === 0 && !debouncedQuery && (
        <GetStartedPanel
          art={<TeamArt />}
          title={t("teams.getStarted.title")}
          description={t("teams.getStarted.desc")}
          steps={[
            t("teams.getStarted.step1"),
            t("teams.getStarted.step2"),
            t("teams.getStarted.step3"),
          ]}
          action={
            <Button
              appearance="primary"
              icon={<AddRegular />}
              onClick={() => navigate("/teams/new")}
            >
              {t("teams.newTeam")}
            </Button>
          }
        />
      )}

      {!isFetching && data?.teams.length === 0 && debouncedQuery && (
        <EmptyState
          icon={<PeopleRegular />}
          title={t("teams.noResultsMatch")}
        />
      )}

      {data && data.teams.length > 0 && (
        <>
          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 12,
              flexWrap: "wrap",
            }}
          >
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("teams.searchTeamsPlaceholder")}
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
              style={{ minWidth: 220, flex: "1 1 220px" }}
            />
          </div>
          <div className={styles.grid}>
            {data.teams.map((team) => (
              <div
                key={team.id}
                className={styles.card}
                onClick={() => navigate(`/teams/${team.id}`)}
              >
                <div
                  style={{ display: "flex", alignItems: "flex-start", gap: 12 }}
                >
                  <CopyIdTrigger
                    id={team.id}
                    label={t("common.copyTeamId")}
                    copiedLabel={t("common.copiedTeamId")}
                  >
                    {team.avatar_url ? (
                      <Avatar
                        image={{ src: team.avatar_url }}
                        name={team.name}
                        size={32}
                      />
                    ) : (
                      <Avatar name={team.name} size={32} />
                    )}
                  </CopyIdTrigger>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <Text weight="semibold">{team.name}</Text>
                      <Badge
                        color={ROLE_COLORS[team.role] ?? "subtle"}
                        appearance="filled"
                        size="small"
                      >
                        {team.role}
                      </Badge>
                    </div>
                    {team.description && (
                      <Text
                        size={200}
                        style={{ color: tokens.colorNeutralForeground3 }}
                      >
                        {team.description}
                      </Text>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <Pagination
            page={page}
            pageCount={Math.max(1, Math.ceil((data.total || 0) / 20))}
            total={data.total}
            onChange={setPage}
            disabled={isFetching}
          />
        </>
      )}
    </div>
  );
}
