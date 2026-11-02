// OAuth App list page

import { Avatar, Badge, Button } from "@fluentui/react-components";
import { AddRegular, GlobeRegular } from "@fluentui/react-icons";
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
import { AppArt } from "../../components/Illustrations";
import { ListSearch } from "../../components/ListSearch";
import { PageHeader } from "../../components/PageHeader";
import { Pagination } from "../../components/Pagination";

const PAGE_SIZE = 20;

export function AppList() {
  const api = useApi();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const { data: site } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });
  const siteName = site?.site_name ?? "Prism";

  const [page, setPage] = useState(1);
  const { query, setQuery, search } = useDebouncedSearch(() => setPage(1));

  const { data, isFetching } = useQuery({
    queryKey: ["apps", page, search],
    queryFn: () =>
      api.listApps({ page, limit: PAGE_SIZE, q: search || undefined }),
  });

  const columns: DataListColumn[] = [
    { label: t("apps.colName"), width: "minmax(0, 2.2fr)" },
    { label: t("apps.clientId"), width: "minmax(0, 1.6fr)", secondary: true },
    { label: t("apps.colType"), width: "120px", secondary: true },
    { label: t("apps.colCreated"), width: "110px", secondary: true },
  ];

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

      {(query || search || !!data?.apps.length) && (
        <ListSearch
          value={query}
          onChange={setQuery}
          placeholder={t("apps.searchAppsPlaceholder")}
        />
      )}

      {isFetching && !data && (
        <DataListSkeleton columns={columns} rows={5} icon="square" />
      )}

      {!isFetching && data?.apps.length === 0 && !search && (
        <GetStartedPanel
          art={<AppArt />}
          title={t("apps.getStarted.title")}
          description={t("apps.getStarted.desc", { siteName })}
          steps={[
            t("apps.getStarted.step1"),
            t("apps.getStarted.step2"),
            t("apps.getStarted.step3"),
          ]}
          action={newAppButton}
        />
      )}

      {!isFetching && data?.apps.length === 0 && search && (
        <EmptyState icon={<GlobeRegular />} title={t("teams.noResultsMatch")} />
      )}

      {data && data.apps.length > 0 && (
        <>
          <DataList columns={columns}>
            {data.apps.map((app) => (
              <DataListRow
                key={app.id}
                onClick={() => navigate(`/apps/${app.id}`)}
                cells={[
                  <DataListName
                    key="name"
                    icon={
                      <Avatar
                        image={app.icon_url ? { src: app.icon_url } : undefined}
                        name={app.name}
                        size={32}
                        shape="square"
                      />
                    }
                    name={
                      <DataListLink to={`/apps/${app.id}`}>
                        {app.name}
                      </DataListLink>
                    }
                    badges={
                      <>
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
                      </>
                    }
                    sub={app.description || app.website_url || undefined}
                  />,
                  <CopyIdText
                    key="client"
                    id={app.client_id}
                    label={t("common.copyClientId")}
                    copiedLabel={t("common.copiedClientId")}
                  />,
                  app.is_public
                    ? t("apps.typePublic")
                    : t("apps.typeConfidential"),
                  formatDate(app.created_at),
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
