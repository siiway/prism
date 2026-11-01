// Admin domain list: every verified-domain claim on the instance, personal
// and team. An admin can force or withdraw verification (an audited
// override) or remove a claim; each asks first.

import {
  Avatar,
  Badge,
  Button,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Skeleton,
  SkeletonItem,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  DeleteRegular,
  GlobeRegular,
  MoreHorizontalRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { type AdminDomain } from "../../lib/api";
import { apiErrorText } from "../../lib/apiError";
import { useApi } from "../../lib/api-context";
import { formatDate } from "../../lib/datetime";
import { useConfirm } from "../../lib/useConfirm";
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
import { Segmented } from "../../components/Segmented";
import { SettingsToast } from "../../components/Settings";

const PAGE_SIZE = 20;
type Filter = "all" | "1" | "0";

const useStyles = makeStyles({
  toast: { position: "sticky", top: "8px", zIndex: 2, marginBottom: "12px" },
  domain: { fontFamily: tokens.fontFamilyMonospace },
  owner: {
    color: tokens.colorNeutralForeground1,
    textDecorationLine: "none",
    ":hover": { textDecorationLine: "underline" },
  },
  danger: { color: tokens.colorPaletteRedForeground1 },
});

export function AdminDomains() {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { message, showMsg } = useToastMessage();
  const { confirm, confirmDialog } = useConfirm();

  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<Filter>("all");
  const { query, setQuery, search } = useDebouncedSearch(() => setPage(1));

  const { data, isFetching } = useQuery({
    queryKey: ["admin-domains", page, search, filter],
    queryFn: () =>
      api.adminListDomains({
        page,
        limit: PAGE_SIZE,
        q: search || undefined,
        verified: filter === "all" ? undefined : filter,
      }),
  });
  const domains = data?.domains ?? [];
  const total = data?.total ?? 0;
  usePageClamp(page, data?.total, PAGE_SIZE, setPage);

  const [busy, setBusy] = useState<string | null>(null);
  const run = async (
    id: string,
    action: () => Promise<unknown>,
    done: string,
  ) => {
    setBusy(id);
    try {
      await action();
      await qc.invalidateQueries({ queryKey: ["admin-domains"] });
      showMsg("success", done);
    } catch (err) {
      showMsg("error", apiErrorText(err, t("common.error")));
    } finally {
      setBusy(null);
    }
  };

  const forceVerify = async (row: AdminDomain) => {
    const ok = await confirm({
      title: t("admin.domainForceVerifyTitle"),
      body: t("admin.domainForceVerifyBody", { domain: row.domain }),
      confirmLabel: t("admin.domainForceVerify"),
    });
    if (ok)
      await run(
        row.id,
        () => api.adminSetDomainVerified(row.id, true),
        t("admin.domainVerifiedDone"),
      );
  };
  const unverify = async (row: AdminDomain) => {
    const ok = await confirm({
      title: t("admin.domainUnverifyTitle"),
      body: t("admin.domainUnverifyBody", { domain: row.domain }),
      confirmLabel: t("admin.domainUnverify"),
    });
    if (ok)
      await run(
        row.id,
        () => api.adminSetDomainVerified(row.id, false),
        t("admin.domainUnverifiedDone"),
      );
  };
  const remove = async (row: AdminDomain) => {
    const ok = await confirm({
      title: t("admin.domainDeleteTitle"),
      body: t("admin.domainDeleteBody", { domain: row.domain }),
      confirmLabel: t("common.delete"),
    });
    if (ok)
      await run(
        row.id,
        () => api.adminDeleteDomain(row.id),
        t("common.deletedDone"),
      );
  };

  const columns: DataListColumn[] = [
    { label: t("admin.domainHeader"), width: "minmax(0, 2fr)" },
    {
      label: t("admin.ownerHeader"),
      width: "minmax(0, 1.4fr)",
      secondary: true,
    },
    { label: t("admin.statusHeader"), width: "100px" },
    { label: t("admin.addedHeader"), width: "100px", secondary: true },
    { label: "", width: "32px", end: true },
  ];

  const owner = (row: AdminDomain) =>
    row.team_id ? (
      <Link to={`/teams/${row.team_id}`} className={styles.owner}>
        <DataListName
          icon={
            <Avatar
              name={row.team_name ?? ""}
              image={row.team_avatar ? { src: row.team_avatar } : undefined}
              size={20}
            />
          }
          name={row.team_name ?? row.team_id}
        />
      </Link>
    ) : row.user_id ? (
      <Link to={`/admin/users/${row.user_id}`} className={styles.owner}>
        @{row.owner_username ?? row.user_id}
      </Link>
    ) : (
      "—"
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {message && (
        <div className={styles.toast}>
          <SettingsToast message={message} />
        </div>
      )}

      <ListSearch
        value={query}
        onChange={setQuery}
        placeholder={t("admin.domainSearch")}
      >
        <Segmented
          label={t("admin.statusHeader")}
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setPage(1);
          }}
          options={[
            { value: "all", label: t("admin.domainFilterAll") },
            { value: "1", label: t("admin.verifiedStatus") },
            { value: "0", label: t("admin.unverifiedStatus") },
          ]}
        />
      </ListSearch>

      {isFetching && !data ? (
        <Skeleton aria-busy>
          <DataList columns={columns}>
            {Array.from({ length: 4 }).map((_, i) => (
              <DataListRow
                key={i}
                cells={columns.map((_, c) => (
                  <SkeletonItem
                    key={c}
                    size={12}
                    style={{ width: c === 0 ? `${35 + (i % 3) * 12}%` : 60 }}
                  />
                ))}
              />
            ))}
          </DataList>
        </Skeleton>
      ) : domains.length === 0 ? (
        <EmptyState
          icon={<GlobeRegular />}
          title={
            search || filter !== "all"
              ? t("teams.noResultsMatch")
              : t("admin.noDomains")
          }
        />
      ) : (
        <>
          <DataList columns={columns}>
            {domains.map((row) => (
              <DataListRow
                key={row.id}
                cells={[
                  <span key="d" className={styles.domain}>
                    {row.domain}
                  </span>,
                  owner(row),
                  <Badge
                    key="s"
                    appearance="tint"
                    size="small"
                    color={row.verified ? "success" : "warning"}
                  >
                    {row.verified
                      ? t("admin.verifiedStatus")
                      : t("admin.unverifiedStatus")}
                  </Badge>,
                  formatDate(row.created_at),
                  <Menu key="m">
                    <MenuTrigger disableButtonEnhancement>
                      <Button
                        size="small"
                        appearance="subtle"
                        icon={<MoreHorizontalRegular />}
                        disabled={busy === row.id}
                        aria-label={t("admin.domainActions", {
                          domain: row.domain,
                        })}
                      />
                    </MenuTrigger>
                    <MenuPopover>
                      <MenuList>
                        {row.verified ? (
                          <MenuItem onClick={() => void unverify(row)}>
                            {t("admin.domainUnverify")}
                          </MenuItem>
                        ) : (
                          <MenuItem onClick={() => void forceVerify(row)}>
                            {t("admin.domainForceVerify")}
                          </MenuItem>
                        )}
                        <MenuDivider />
                        <MenuItem
                          icon={<DeleteRegular />}
                          className={styles.danger}
                          onClick={() => void remove(row)}
                        >
                          {t("common.delete")}
                        </MenuItem>
                      </MenuList>
                    </MenuPopover>
                  </Menu>,
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
