// OAuth App list page

import {
  Avatar,
  Badge,
  Button,
  Input,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  ChevronRightRegular,
  CopyRegular,
  GlobeRegular,
  SearchRegular,
  DismissRegular,
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
import { AppArt } from "../../components/Illustrations";
import { PageHeader } from "../../components/PageHeader";
import { Pagination } from "../../components/Pagination";
import { SkeletonAppCards } from "../../components/Skeletons";

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

export function AppList() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const { data: site } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });
  const siteName = site?.site_name ?? "Prism";

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
    queryKey: ["apps", page, debouncedQuery],
    queryFn: () =>
      api.listApps({ page, limit: 20, q: debouncedQuery || undefined }),
  });

  const newAppButton = (
    <Button
      appearance="primary"
      icon={<AddRegular />}
      onClick={() => navigate("/apps/new")}
    >
      {t("apps.newApp")}
    </Button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <PageHeader title={t("apps.myApplications")} actions={newAppButton} />

      {isFetching && !data && <SkeletonAppCards count={6} />}

      {!isFetching && data?.apps.length === 0 && !debouncedQuery && (
        <GetStartedPanel
          art={<AppArt />}
          title={t("apps.getStarted.title")}
          description={t("apps.getStarted.desc", { siteName })}
          steps={[
            t("apps.getStarted.step1"),
            t("apps.getStarted.step2"),
            t("apps.getStarted.step3"),
          ]}
          action={
            <Button
              appearance="primary"
              icon={<AddRegular />}
              onClick={() => navigate("/apps/new")}
            >
              {t("apps.newApp")}
            </Button>
          }
        />
      )}

      {!isFetching && data?.apps.length === 0 && debouncedQuery && (
        <EmptyState icon={<GlobeRegular />} title={t("teams.noResultsMatch")} />
      )}

      {data && data.apps.length > 0 && (
        <>
          <div className={styles.toolbar}>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("apps.searchAppsPlaceholder")}
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
          <div className={styles.list} role="table">
            <div className={styles.head} role="row">
              <span role="columnheader">{t("apps.colName")}</span>
              <span role="columnheader">{t("apps.clientId")}</span>
              <span role="columnheader">{t("apps.colType")}</span>
              <span role="columnheader">{t("apps.colCreated")}</span>
              <span />
            </div>
            {data.apps.map((app) => (
              <div
                key={app.id}
                role="row"
                className={styles.row}
                onClick={() => navigate(`/apps/${app.id}`)}
              >
                <div className={styles.nameCell} role="cell">
                  <Avatar
                    image={app.icon_url ? { src: app.icon_url } : undefined}
                    name={app.name}
                    size={32}
                    shape="square"
                  />
                  <div className={styles.nameText}>
                    <div className={styles.nameLine}>
                      {/* A real link so the row works with the keyboard,
                          middle-click and "open in new tab". */}
                      <Link
                        to={`/apps/${app.id}`}
                        className={styles.name}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {app.name}
                      </Link>
                      {app.is_verified && (
                        <Badge color="success" appearance="tint" size="small">
                          {t("apps.verified")}
                        </Badge>
                      )}
                      {!app.is_active && (
                        <Badge color="subtle" appearance="tint" size="small">
                          {t("apps.disabled")}
                        </Badge>
                      )}
                    </div>
                    {(app.description || app.website_url) && (
                      <span className={styles.sub}>
                        {app.description || app.website_url}
                      </span>
                    )}
                  </div>
                </div>
                <div className={styles.secondary} role="cell">
                  <CopyIdTrigger
                    id={app.client_id}
                    label={t("common.copyClientId")}
                    copiedLabel={t("common.copiedClientId")}
                    className={styles.clientId}
                  >
                    <span className={styles.clientIdText}>{app.client_id}</span>
                    <CopyRegular />
                  </CopyIdTrigger>
                </div>
                <div className={styles.secondary} role="cell">
                  <span className={styles.muted}>
                    {app.is_public
                      ? t("apps.typePublic")
                      : t("apps.typeConfidential")}
                  </span>
                </div>
                <div className={styles.secondary} role="cell">
                  <span className={styles.muted}>
                    {formatDate(app.created_at)}
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
