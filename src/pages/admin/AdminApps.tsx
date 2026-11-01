// Admin app list: every OAuth app on the instance. Rows open the app's own
// page on its Moderation tab, where status flags, transfers and revocation
// live.

import {
  Avatar,
  Badge,
  Skeleton,
  SkeletonItem,
} from "@fluentui/react-components";
import { AppsRegular } from "@fluentui/react-icons";
import { useState } from "react";
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

export function AdminApps() {
  const api = useApi();
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const { query, setQuery, search } = useDebouncedSearch(() => setPage(1));

  const { data, isFetching } = useQuery({
    queryKey: ["admin-apps", page, search],
    queryFn: () => api.adminListApps(page, search),
  });
  const apps = data?.apps ?? [];
  const total = data?.total ?? 0;
  usePageClamp(page, data?.total, PAGE_SIZE, setPage);

  const columns: DataListColumn[] = [
    { label: t("admin.appHeader"), width: "minmax(0, 2.2fr)" },
    {
      label: t("admin.ownerHeader"),
      width: "minmax(0, 1.4fr)",
      secondary: true,
    },
    { label: t("admin.statusHeader"), width: "150px", secondary: true },
    { label: t("admin.createdHeader"), width: "100px", secondary: true },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <ListSearch
        value={query}
        onChange={setQuery}
        placeholder={t("admin.searchApps")}
      />

      {isFetching && !data ? (
        <Skeleton aria-busy>
          <DataList columns={columns} linked>
            {Array.from({ length: 5 }).map((_, i) => (
              <DataListRow
                key={i}
                cells={[
                  <SkeletonItem
                    key="a"
                    size={12}
                    style={{ width: `${40 + (i % 3) * 12}%` }}
                  />,
                  <SkeletonItem key="b" size={12} style={{ width: "60%" }} />,
                  <SkeletonItem key="c" size={12} style={{ width: 60 }} />,
                  <SkeletonItem key="d" size={12} style={{ width: 72 }} />,
                ]}
              />
            ))}
          </DataList>
        </Skeleton>
      ) : apps.length === 0 ? (
        <EmptyState
          icon={<AppsRegular />}
          title={search ? t("teams.noResultsMatch") : t("admin.noAppsYet")}
        />
      ) : (
        <>
          <DataList columns={columns} linked>
            {apps.map((app) => (
              <DataListRow
                key={app.id}
                to={`/apps/${app.id}?tab=moderation`}
                state={{ from: "admin-apps" }}
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
                    name={app.name}
                    badges={
                      <>
                        {!!app.is_official && (
                          <Badge appearance="tint" color="brand" size="small">
                            {t("admin.officialHeader")}
                          </Badge>
                        )}
                        {!!app.is_first_party && (
                          <Badge
                            appearance="outline"
                            color="informative"
                            size="small"
                          >
                            {t("admin.firstPartyHeader")}
                          </Badge>
                        )}
                      </>
                    }
                    sub={app.client_id}
                  />,
                  app.team_id ? (
                    <DataListName
                      key="owner"
                      icon={
                        <Avatar
                          image={
                            app.team_avatar_url
                              ? { src: app.team_avatar_url }
                              : undefined
                          }
                          name={app.team_name ?? t("admin.teamHeader")}
                          size={20}
                          shape="square"
                        />
                      }
                      name={app.team_name ?? t("admin.teamHeader")}
                      sub={t("admin.teamHeader")}
                    />
                  ) : app.owner_username ? (
                    `@${app.owner_username}`
                  ) : (
                    "—"
                  ),
                  <span key="status">
                    {app.is_active ? (
                      t("admin.activeStatus")
                    ) : (
                      <Badge appearance="tint" color="danger" size="small">
                        {t("admin.disabledStatus")}
                      </Badge>
                    )}
                    {app.is_verified && ` · ${t("admin.verifiedBadge")}`}
                  </span>,
                  formatDate(app.created_at),
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
