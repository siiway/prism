// Site- and team-level scope grants.
//
// These are the highest-privilege grants the OAuth layer issues: `site:*` lets
// an application act across the instance, and `site:team:*` deliberately
// bypasses the team owner's consent. They're written at authorization time
// and nothing else lists them — an authority nobody can enumerate is one
// nobody can withdraw, which is why this screen exists.

import {
  Badge,
  Button,
  Skeleton,
  SkeletonItem,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { KeyMultipleRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, type AdminScopeGrant } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import { formatDate } from "../../lib/datetime";
import { useConfirm } from "../../lib/useConfirm";
import { useToastMessage } from "../../lib/useToastMessage";
import { usePageClamp } from "../../lib/usePageClamp";
import {
  DataList,
  DataListName,
  DataListRow,
  type DataListColumn,
} from "../../components/DataList";
import { EmptyState } from "../../components/EmptyState";
import { Pagination } from "../../components/Pagination";
import { Segmented } from "../../components/Segmented";
import { SettingsToast } from "../../components/Settings";

const PAGE_SIZE = 20;
type Kind = "site" | "team";

const useStyles = makeStyles({
  toast: { position: "sticky", top: "8px", zIndex: 2, marginBottom: "12px" },
  toolbar: { display: "flex", marginBottom: "12px" },
  mono: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
  scopes: { display: "flex", gap: "4px", flexWrap: "wrap" },
  link: {
    color: tokens.colorNeutralForeground1,
    textDecorationLine: "none",
    ":hover": { textDecorationLine: "underline" },
  },
  danger: { color: tokens.colorPaletteRedForeground1 },
});

export function AdminScopeGrants() {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { message, showMsg } = useToastMessage();
  const { confirm, confirmDialog } = useConfirm();

  const [kind, setKind] = useState<Kind>("site");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isFetching } = useQuery({
    queryKey: ["admin-scope-grants", kind, page],
    queryFn: () => api.adminScopeGrants(kind, page),
  });
  const grants = data?.grants ?? [];
  const total = data?.total ?? 0;
  usePageClamp(page, data?.total, PAGE_SIZE, setPage);

  const revoke = async (row: AdminScopeGrant) => {
    const ok = await confirm({
      title: t("admin.revokeGrantTitle"),
      body: t("admin.revokeGrantBody", {
        app: row.app_name ?? row.client_id,
      }),
      confirmLabel: t("common.revoke"),
    });
    if (!ok) return;
    setBusy(row.id);
    try {
      const res = await api.adminRevokeScopeGrant(kind, row.id);
      await qc.invalidateQueries({ queryKey: ["admin-scope-grants"] });
      showMsg("success", res.message);
    } catch (err) {
      showMsg("error", err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const columns: DataListColumn[] = [
    { label: t("admin.applicationsTab"), width: "minmax(0, 1.6fr)" },
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
        kind === "site" ? t("admin.grantedByHeader") : t("admin.teamHeader"),
      width: "minmax(0, 1fr)",
      secondary: true,
    },
    { label: t("admin.grantedHeader"), width: "100px", secondary: true },
    { label: "", width: "80px", end: true },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {message && (
        <div className={styles.toast}>
          <SettingsToast message={message} />
        </div>
      )}

      <div className={styles.toolbar}>
        <Segmented
          label={t("admin.scopeGrantKind")}
          value={kind}
          onChange={(v) => {
            setKind(v);
            setPage(1);
          }}
          options={[
            { value: "site", label: t("admin.siteGrantsTab") },
            { value: "team", label: t("admin.teamGrantsTab") },
          ]}
        />
      </div>

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
          title={t("admin.noScopeGrants")}
        />
      ) : (
        <>
          <DataList columns={columns}>
            {grants.map((row) => (
              <DataListRow
                key={row.id}
                cells={[
                  <DataListName
                    key="app"
                    name={row.app_name ?? t("admin.unknownApp")}
                    sub={row.client_id}
                  />,
                  kind === "site" ? (
                    <div key="s" className={styles.scopes}>
                      {(row.scopes ?? []).map((s) => (
                        <Badge
                          key={s}
                          appearance="tint"
                          color="danger"
                          size="small"
                        >
                          {s}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <span key="p" className={styles.mono}>
                      {JSON.stringify(row.permissions)}
                    </span>
                  ),
                  kind === "site" ? (
                    row.admin_username ? (
                      `@${row.admin_username}`
                    ) : (
                      "—"
                    )
                  ) : row.team_id ? (
                    <Link
                      key="team"
                      to={`/teams/${row.team_id}`}
                      className={styles.link}
                    >
                      {row.team_name ?? row.team_id}
                    </Link>
                  ) : (
                    "—"
                  ),
                  formatDate(row.granted_at),
                  <Button
                    key="r"
                    size="small"
                    className={styles.danger}
                    disabled={busy === row.id}
                    onClick={() => void revoke(row)}
                  >
                    {t("common.revoke")}
                  </Button>,
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

      {confirmDialog}
    </div>
  );
}
