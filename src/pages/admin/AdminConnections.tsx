// Admin OAuth sources: the sign-in providers (GitHub, Google, generic OIDC…)
// people can use and link. Each row says whether the source is offered at
// sign-in and opens its page, where that is changed; Add source opens
// /admin/connections/new.

import {
  Button,
  Skeleton,
  SkeletonItem,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { AddRegular, PlugConnectedRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiErrorText } from "../../lib/apiError";
import { useApi } from "../../lib/api-context";
import { useDebouncedSearch } from "../../lib/useDebouncedSearch";
import { useToastMessage } from "../../lib/useToastMessage";
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
import { SettingsToast } from "../../components/Settings";
import { ViewBanner } from "../../components/ViewBanner";
import { SignInPreview } from "./sources/SignInPreview";
import { providerLabel } from "./sources/sourceForm";

const PAGE_SIZE = 20;

const useStyles = makeStyles({
  toast: { position: "sticky", top: "8px", zIndex: 2, marginBottom: "12px" },
  banner: { marginBottom: "12px" },
  // The list, with the sign-in preview beside it on wide screens and
  // below it on narrow ones.
  layout: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 300px",
    alignItems: "start",
    gap: "16px",
    "@media (max-width: 1100px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  main: { minWidth: 0, display: "flex", flexDirection: "column" },
  aside: {
    position: "sticky",
    top: "16px",
    "@media (max-width: 1100px)": { position: "static" },
  },
  muted: { color: tokens.colorNeutralForeground3 },
  name: {
    color: tokens.colorNeutralForeground1,
    textDecorationLine: "none",
    ":hover": { textDecorationLine: "underline" },
  },
});

export function AdminConnections() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { message, showMsg } = useToastMessage();
  const [page, setPage] = useState(1);
  const { query, setQuery, search } = useDebouncedSearch(() => setPage(1));

  const { data, isFetching } = useQuery({
    queryKey: ["admin-oauth-sources", page, search],
    queryFn: () =>
      api.adminListOAuthSources({
        page,
        limit: PAGE_SIZE,
        q: search || undefined,
      }),
  });
  const sources = data?.sources ?? [];
  const total = data?.total ?? 0;
  usePageClamp(page, data?.total, PAGE_SIZE, setPage);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["admin-oauth-sources"] });
    await qc.invalidateQueries({ queryKey: ["admin-oauth-source"] });
    await qc.invalidateQueries({ queryKey: ["site"] });
  };

  // Credentials still kept in site settings from before sources existed.
  const [migrating, setMigrating] = useState(false);
  const migrate = async () => {
    setMigrating(true);
    try {
      const res = await api.adminMigrateOAuthSources();
      await refresh();
      showMsg(
        "success",
        res.migrated.length
          ? t("admin.oauthMigrated", { providers: res.migrated.join(", ") })
          : t("admin.oauthMigrateAlreadyDone"),
      );
    } catch (err) {
      showMsg("error", apiErrorText(err, t("common.saveFailed")));
    } finally {
      setMigrating(false);
    }
  };

  const columns: DataListColumn[] = [
    { label: t("admin.oauthName"), width: "minmax(0, 2fr)" },
    {
      label: t("admin.oauthProvider"),
      width: "minmax(0, 1.2fr)",
      secondary: true,
    },
    { label: t("admin.oauthTrustedColumn"), width: "110px", secondary: true },
    { label: t("admin.oauthOfferedColumn"), width: "90px", end: true },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {message && (
        <div className={styles.toast}>
          <SettingsToast message={message} />
        </div>
      )}

      {data && data.legacy_providers.length > 0 && (
        <div className={styles.banner}>
          <ViewBanner
            intent="warning"
            action={{
              label: migrating
                ? t("common.loading")
                : t("admin.oauthMigrateAction"),
              onClick: () => void migrate(),
            }}
          >
            {t("admin.oauthMigrateBanner", {
              providers: data.legacy_providers.join(", "),
            })}
          </ViewBanner>
        </div>
      )}

      <ListSearch
        value={query}
        onChange={setQuery}
        placeholder={t("admin.searchSourcesPlaceholder")}
      >
        <Button
          appearance="primary"
          icon={<AddRegular />}
          onClick={() => navigate("/admin/connections/new")}
        >
          {t("admin.oauthAddSource")}
        </Button>
      </ListSearch>

      <div className={styles.layout}>
        <div className={styles.main}>
          {isFetching && !data ? (
            <Skeleton aria-busy>
              <DataList columns={columns}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <DataListRow
                    key={i}
                    cells={columns.map((_, c) => (
                      <SkeletonItem
                        key={c}
                        size={12}
                        style={{ width: "60%" }}
                      />
                    ))}
                  />
                ))}
              </DataList>
            </Skeleton>
          ) : sources.length === 0 ? (
            <EmptyState
              icon={<PlugConnectedRegular />}
              title={
                search ? t("teams.noResultsMatch") : t("admin.oauthNoSources")
              }
            />
          ) : (
            <>
              <DataList columns={columns}>
                {sources.map((src) => {
                  const path = `/admin/connections/${src.id}`;
                  return (
                    <DataListRow
                      key={src.id}
                      onClick={() => navigate(path)}
                      cells={[
                        <DataListName
                          key="n"
                          name={
                            // A real link: keyboard, middle-click, new tab.
                            <Link
                              to={path}
                              className={styles.name}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {src.name}
                            </Link>
                          }
                          sub={src.slug}
                        />,
                        providerLabel(t, src.provider),
                        src.trusted
                          ? t("admin.oauthTrustedYes")
                          : t("admin.oauthTrustedNo"),
                        src.enabled === 1 ? (
                          t("admin.oauthOfferedYes")
                        ) : (
                          <span key="o" className={styles.muted}>
                            {t("admin.oauthOfferedNo")}
                          </span>
                        ),
                      ]}
                    />
                  );
                })}
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
        <SignInPreview className={styles.aside} />
      </div>
    </div>
  );
}
