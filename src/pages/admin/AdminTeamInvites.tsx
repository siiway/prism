// Every outstanding team invite on the instance.
//
// Invites were visible only from inside the team that issued them — the wrong
// index when a link has leaked and the question is "what else did this
// creator hand out". Invites that create accounts rather than adding existing
// ones are why this is one list rather than a tour of every team page.

import {
  Badge,
  Button,
  Skeleton,
  SkeletonItem,
  Switch,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { MailRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, type AdminTeamInvite } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import { formatDate } from "../../lib/datetime";
import { useConfirm } from "../../lib/useConfirm";
import { useDebouncedSearch } from "../../lib/useDebouncedSearch";
import { useToastMessage } from "../../lib/useToastMessage";
import { usePageClamp } from "../../lib/usePageClamp";
import { CopyButton } from "../../components/CopyButton";
import {
  DataList,
  DataListRow,
  type DataListColumn,
} from "../../components/DataList";
import { EmptyState } from "../../components/EmptyState";
import { ListSearch } from "../../components/ListSearch";
import { Pagination } from "../../components/Pagination";
import { RoleBadge } from "../../components/RoleBadge";
import { SettingsToast } from "../../components/Settings";

const PAGE_SIZE = 20;

const useStyles = makeStyles({
  toast: { position: "sticky", top: "8px", zIndex: 2, marginBottom: "12px" },
  team: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
  teamLine: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexWrap: "wrap",
  },
  link: {
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    textDecorationLine: "none",
    ":hover": { textDecorationLine: "underline" },
  },
  sub: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    overflowWrap: "anywhere",
  },
  actions: { display: "flex", alignItems: "center", gap: "4px" },
  danger: { color: tokens.colorPaletteRedForeground1 },
});

export function AdminTeamInvites() {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { message, showMsg } = useToastMessage();
  const { confirm, confirmDialog } = useConfirm();

  const [page, setPage] = useState(1);
  const [registrationOnly, setRegistrationOnly] = useState(false);
  const { query, setQuery, search } = useDebouncedSearch(() => setPage(1));
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isFetching } = useQuery({
    queryKey: ["admin-team-invites", page, search, registrationOnly],
    queryFn: () =>
      api.adminTeamInvites({
        page,
        limit: PAGE_SIZE,
        q: search || undefined,
        registration: registrationOnly || undefined,
      }),
  });
  const invites = data?.invites ?? [];
  const total = data?.total ?? 0;
  usePageClamp(page, data?.total, PAGE_SIZE, setPage);

  const revoke = async (row: AdminTeamInvite) => {
    const ok = await confirm({
      title: t("admin.revokeInviteTitle"),
      body: t("admin.revokeInviteBody", {
        team: row.team_name ?? row.team_id,
        uses: row.uses,
      }),
      confirmLabel: t("common.revoke"),
    });
    if (!ok) return;
    setBusy(row.token);
    try {
      await api.adminRevokeTeamInvite(row.token);
      await qc.invalidateQueries({ queryKey: ["admin-team-invites"] });
      showMsg("success", t("common.revokedDone"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.error"),
      );
    } finally {
      setBusy(null);
    }
  };

  const columns: DataListColumn[] = [
    { label: t("admin.teamHeader"), width: "minmax(0, 2fr)" },
    { label: t("admin.roleHeader"), width: "minmax(0, 1fr)", secondary: true },
    { label: t("admin.usesHeader"), width: "70px", secondary: true },
    { label: t("admin.expiresHeader"), width: "100px", secondary: true },
    {
      label: t("admin.createdByHeader"),
      width: "minmax(0, 1fr)",
      secondary: true,
    },
    { label: "", width: "110px", end: true },
  ];

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
        placeholder={t("admin.teamInviteSearch")}
      >
        <Switch
          checked={registrationOnly}
          onChange={(_, d) => {
            setRegistrationOnly(d.checked);
            setPage(1);
          }}
          label={t("admin.registrationInvitesOnly")}
        />
      </ListSearch>

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
      ) : invites.length === 0 ? (
        <EmptyState
          icon={<MailRegular />}
          title={
            search || registrationOnly
              ? t("teams.noResultsMatch")
              : t("admin.noTeamInvites")
          }
        />
      ) : (
        <>
          <DataList columns={columns}>
            {invites.map((row) => (
              <DataListRow
                key={row.token}
                cells={[
                  <div key="team" className={styles.team}>
                    <div className={styles.teamLine}>
                      <Link
                        to={`/teams/${row.team_id}`}
                        className={styles.link}
                      >
                        {row.team_name ?? row.team_id}
                      </Link>
                      {row.allows_registration && (
                        <Badge appearance="tint" color="warning" size="small">
                          {t("admin.mintsAccounts")}
                        </Badge>
                      )}
                    </div>
                    {row.email && (
                      <span className={styles.sub}>{row.email}</span>
                    )}
                  </div>,
                  <div key="role" className={styles.team}>
                    <span>
                      <RoleBadge role={row.role} />
                    </span>
                    {row.groups.length > 0 && (
                      <span className={styles.sub}>
                        {t("admin.memberGroupsValue", {
                          groups: row.groups.map((g) => g.name).join(", "),
                        })}
                      </span>
                    )}
                  </div>,
                  row.max_uses ? `${row.uses} / ${row.max_uses}` : row.uses,
                  formatDate(row.expires_at),
                  row.created_by_username ? `@${row.created_by_username}` : "—",
                  <div key="a" className={styles.actions}>
                    {/* The token is the credential: copyable so a leaked
                        link can be matched against what exists. */}
                    <CopyButton
                      text={row.token}
                      label={t("admin.copyInviteToken")}
                    />
                    <Button
                      size="small"
                      className={styles.danger}
                      disabled={busy === row.token}
                      onClick={() => void revoke(row)}
                    >
                      {t("common.revoke")}
                    </Button>
                  </div>,
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
