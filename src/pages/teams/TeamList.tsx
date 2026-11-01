// Teams list page: one bordered list, a row per team.

import {
  Avatar,
  Badge,
  Button,
  Input,
  Skeleton,
  SkeletonItem,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  ChevronRightRegular,
  CopyRegular,
  DismissRegular,
  PeopleRegular,
  SearchRegular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useApi } from "../../lib/api-context";
import { formatDate } from "../../lib/datetime";
import { CopyIdTrigger } from "../../components/CopyIdTrigger";
import { EmptyState } from "../../components/EmptyState";
import { GetStartedPanel } from "../../components/GetStartedPanel";
import { TeamArt } from "../../components/Illustrations";
import { PageHeader } from "../../components/PageHeader";
import { Pagination } from "../../components/Pagination";
import { RoleBadge } from "../../components/RoleBadge";

// Cloudflare-style list: one bordered card, a muted header row, and one
// clickable row per app with its key facts in columns. Secondary columns
// drop away on narrow screens.
const COLUMNS = "minmax(0, 2.2fr) minmax(0, 1.6fr) 120px 110px 20px";

const useStyles = makeStyles({
  toolbar: {
    display: "flex",
    gap: "8px",
    marginBottom: "12px",
    flexWrap: "wrap",
  },
  list: {
    borderRadius: tokens.borderRadiusXLarge,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground1,
    overflow: "hidden",
  },
  head: {
    display: "grid",
    gridTemplateColumns: COLUMNS,
    gap: "16px",
    padding: "10px 16px",
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    "@media (max-width: 768px)": {
      display: "none",
    },
  },
  row: {
    display: "grid",
    gridTemplateColumns: COLUMNS,
    gap: "16px",
    alignItems: "center",
    padding: "12px 16px",
    cursor: "pointer",
    ":not(:last-child)": {
      borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    ":hover": {
      background: tokens.colorNeutralBackground1Hover,
    },
    "@media (max-width: 768px)": {
      gridTemplateColumns: "minmax(0, 1fr) 20px",
    },
  },
  nameCell: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    minWidth: 0,
  },
  nameText: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0,
  },
  nameLine: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
  },
  name: {
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      borderRadius: "2px",
    },
  },
  sub: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  secondary: {
    minWidth: 0,
    "@media (max-width: 768px)": {
      display: "none",
    },
  },
  clientId: {
    justifyContent: "flex-start",
    gap: "6px",
    maxWidth: "100%",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: "12px",
    color: tokens.colorNeutralForeground2,
  },
  clientIdText: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  muted: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground3,
  },
  chevron: {
    fontSize: "14px",
    color: tokens.colorNeutralForeground3,
  },
});

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
      api.listTeams({ page, limit: 20, q: debouncedQuery || undefined }),
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

  const head = (
    <div className={styles.head} role="row">
      <span role="columnheader">{t("apps.colName")}</span>
      <span role="columnheader">{t("teams.colTeamId")}</span>
      <span role="columnheader">{t("teams.roleHeader")}</span>
      <span role="columnheader">{t("apps.colCreated")}</span>
      <span />
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <PageHeader
        title={t("teams.title")}
        subtitle={t("teams.subtitle")}
        actions={newTeamButton}
      />

      {isFetching && !data && (
        <Skeleton aria-busy>
          <div className={styles.list}>
            {head}
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={styles.row}>
                <div className={styles.nameCell}>
                  <SkeletonItem shape="circle" size={32} />
                  <SkeletonItem
                    size={12}
                    style={{ width: `${40 + (i % 3) * 12}%` }}
                  />
                </div>
                <SkeletonItem size={12} style={{ width: "70%" }} />
                <SkeletonItem size={12} style={{ width: 60 }} />
                <SkeletonItem size={12} style={{ width: 72 }} />
                <span />
              </div>
            ))}
          </div>
        </Skeleton>
      )}

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
          action={newTeamButton}
        />
      )}

      {data && (data.teams.length > 0 || debouncedQuery) && (
        <div className={styles.toolbar}>
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
      )}

      {!isFetching && data?.teams.length === 0 && debouncedQuery && (
        <EmptyState
          icon={<PeopleRegular />}
          title={t("teams.noResultsMatch")}
        />
      )}

      {data && data.teams.length > 0 && (
        <>
          <div className={styles.list} role="table">
            {head}
            {data.teams.map((team) => (
              <div
                key={team.id}
                role="row"
                className={styles.row}
                onClick={() => navigate(`/teams/${team.id}`)}
              >
                <div className={styles.nameCell} role="cell">
                  <Avatar
                    image={
                      team.avatar_url ? { src: team.avatar_url } : undefined
                    }
                    name={team.name}
                    size={32}
                  />
                  <div className={styles.nameText}>
                    <div className={styles.nameLine}>
                      {/* A real link so the row works with the keyboard,
                          middle-click and "open in new tab". */}
                      <Link
                        to={`/teams/${team.id}`}
                        className={styles.name}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {team.name}
                      </Link>
                      {team.inherited_from && (
                        <Badge
                          appearance="outline"
                          color="informative"
                          size="small"
                        >
                          {t("teams.inheritedBadge")}
                        </Badge>
                      )}
                    </div>
                    {team.description && (
                      <span className={styles.sub}>{team.description}</span>
                    )}
                  </div>
                </div>
                <div className={styles.secondary} role="cell">
                  <CopyIdTrigger
                    id={team.id}
                    label={t("common.copyTeamId")}
                    copiedLabel={t("common.copiedTeamId")}
                    className={styles.clientId}
                  >
                    <span className={styles.clientIdText}>{team.id}</span>
                    <CopyRegular />
                  </CopyIdTrigger>
                </div>
                <div className={styles.secondary} role="cell">
                  <RoleBadge role={team.role} />
                </div>
                <div className={styles.secondary} role="cell">
                  <span className={styles.muted}>
                    {formatDate(team.created_at)}
                  </span>
                </div>
                <ChevronRightRegular className={styles.chevron} />
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
