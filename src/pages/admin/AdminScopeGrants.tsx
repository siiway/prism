// Site- and team-level scope grants that apps still hold.
//
// These are the highest-privilege grants the OAuth layer issues: `site:*` lets
// an application act across the instance, and `site:team:*` deliberately
// bypasses the team owner's consent. One row per app and account (site) or
// app and team (team); each opens on its own page, where it can be revoked.
// The kind lives in ?view= so coming back from a grant lands on the same list.

import {
  Badge,
  Skeleton,
  SkeletonItem,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { KeyMultipleRegular } from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AdminScopeGrant, ScopeGrantKind } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import { formatDate } from "../../lib/datetime";
import { useDebouncedSearch } from "../../lib/useDebouncedSearch";
import { usePageClamp } from "../../lib/usePageClamp";
import { useToastMessage } from "../../lib/useToastMessage";
import {
  DataList,
  DataListName,
  DataListRow,
  type DataListColumn,
} from "../../components/DataList";
import { EmptyState } from "../../components/EmptyState";
import { ListSearch } from "../../components/ListSearch";
import { Pagination } from "../../components/Pagination";
import { Segmented } from "../../components/Segmented";
import { SettingsToast } from "../../components/Settings";

const PAGE_SIZE = 20;

const useStyles = makeStyles({
  toast: { marginBottom: "12px" },
  views: { display: "flex", marginBottom: "12px" },
  scopes: { display: "flex", gap: "4px", flexWrap: "wrap" },
  name: {
    color: tokens.colorNeutralForeground1,
    textDecorationLine: "none",
    ":hover": { textDecorationLine: "underline" },
  },
});

/** Where a grant opens. */
const scopeGrantPath = (kind: ScopeGrantKind, id: string) =>
  `/admin/scope-grants/${kind}/${id}`;

function GrantList({ kind }: { kind: ScopeGrantKind }) {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [page, setPage] = useState(1);
  const { query, setQuery, search } = useDebouncedSearch(() => setPage(1));
  const { data, isFetching } = useQuery({
    queryKey: ["admin-scope-grants", kind, page, search],
    queryFn: () => api.adminScopeGrants(kind, page, { q: search || undefined }),
  });
  const grants = data?.grants ?? [];
  const total = data?.total ?? 0;
  usePageClamp(page, data?.total, PAGE_SIZE, setPage);

  const columns: DataListColumn[] = [
    { label: t("admin.grantAppHeader"), width: "minmax(0, 1.5fr)" },
    {
      label:
        kind === "site"
          ? t("admin.scopesHeader")
          : t("admin.permissionsHeader"),
      width: "minmax(0, 2fr)",
      secondary: true,
    },
    {
      label:
        kind === "site" ? t("admin.grantAccountHeader") : t("admin.teamHeader"),
      width: "minmax(0, 1fr)",
      secondary: true,
    },
    { label: t("admin.grantedHeader"), width: "100px", secondary: true },
  ];

  const scopesOf = (row: AdminScopeGrant) =>
    (kind === "site" ? row.scopes : row.permissions) ?? [];

  return (
    <>
      <ListSearch
        value={query}
        onChange={setQuery}
        placeholder={
          kind === "site"
            ? t("admin.searchSiteGrants")
            : t("admin.searchTeamGrants")
        }
      />

      {isFetching && !data ? (
        <Skeleton aria-busy>
          <DataList columns={columns}>
            {Array.from({ length: 3 }).map((_, i) => (
              <DataListRow
                key={i}
                cells={columns.map((_, c) => (
                  <SkeletonItem key={c} size={12} style={{ width: "60%" }} />
                ))}
              />
            ))}
          </DataList>
        </Skeleton>
      ) : grants.length === 0 ? (
        <EmptyState
          icon={<KeyMultipleRegular />}
          title={
            search
              ? t("teams.noResultsMatch")
              : kind === "site"
                ? t("admin.noSiteGrants")
                : t("admin.noTeamGrants")
          }
        />
      ) : (
        <>
          <DataList columns={columns}>
            {grants.map((row) => {
              const path = scopeGrantPath(kind, row.id);
              return (
                <DataListRow
                  key={row.id}
                  onClick={() => navigate(path)}
                  cells={[
                    <DataListName
                      key="app"
                      name={
                        // A real link: keyboard, middle-click, new tab.
                        <Link
                          to={path}
                          className={styles.name}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {row.app_name ?? t("admin.unknownApp")}
                        </Link>
                      }
                      sub={row.client_id}
                    />,
                    <div key="s" className={styles.scopes}>
                      {scopesOf(row).map((s) => (
                        <Badge
                          key={s}
                          appearance="tint"
                          color={kind === "site" ? "danger" : "informative"}
                          size="small"
                        >
                          {s}
                        </Badge>
                      ))}
                    </div>,
                    kind === "site"
                      ? row.grantee_username
                        ? `@${row.grantee_username}`
                        : "—"
                      : (row.team_name ?? row.team_id ?? "—"),
                    formatDate(row.granted_at),
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
    </>
  );
}

export function AdminScopeGrants() {
  const styles = useStyles();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const kind: ScopeGrantKind = params.get("view") === "team" ? "team" : "site";
  const { message, showMsg } = useToastMessage();

  // Back from revoking a grant: say so once, then drop the flag so a reload
  // doesn't repeat it.
  const revoked = (location.state as { revoked?: string } | null)?.revoked;
  useEffect(() => {
    if (!revoked) return;
    showMsg("success", t("admin.grantRevokedToast", { app: revoked }));
    navigate(location.pathname + location.search, {
      replace: true,
      state: null,
    });
  }, [revoked, showMsg, t, navigate, location.pathname, location.search]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {message && (
        <div className={styles.toast}>
          <SettingsToast message={message} />
        </div>
      )}
      <div className={styles.views}>
        <Segmented
          label={t("admin.scopeGrantKind")}
          value={kind}
          onChange={(v) => setParams(v === "team" ? { view: "team" } : {})}
          options={[
            { value: "site", label: t("admin.siteGrantsTab") },
            { value: "team", label: t("admin.teamGrantsTab") },
          ]}
        />
      </div>
      {/* Keyed so switching views starts a fresh search and page. */}
      <GrantList key={kind} kind={kind} />
    </div>
  );
}
