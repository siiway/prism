// Site- and team-level scope grants.
//
// These are the highest-privilege grants the OAuth layer issues: `site:*` lets
// an application act across the instance, and `site:team:*` deliberately
// bypasses the team owner's consent. They were written at authorization time
// and then never surfaced again — nothing listed them and nothing revoked
// them, so the only way to find out what an application still held was to read
// the table.
//
// An authority nobody can enumerate is an authority nobody can withdraw, which
// is the whole reason this screen exists.

import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  MessageBar,
  Tab,
  TabList,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { DeleteRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import type { AdminScopeGrant } from "../../lib/api";
import { CopyIdButton } from "../../components/CopyIdButton";
import { MarkdownText } from "../../components/MarkdownText";
import { Pagination } from "../../components/Pagination";
import { SkeletonTableRows } from "../../components/Skeletons";
import { useToastMessage } from "../../lib/useToastMessage";
import { formatDate } from "../../lib/datetime";

const PAGE_SIZE = 20;

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    minWidth: 0,
    flex: 1,
  },
  tableScroll: { overflowX: "auto" },
  mono: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
  scopes: { display: "flex", gap: "4px", flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
});

export function AdminScopeGrants() {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { message, showMsg } = useToastMessage();

  const [kind, setKind] = useState<"site" | "team">("site");
  const [page, setPage] = useState(1);
  const [pendingRevoke, setPendingRevoke] = useState<AdminScopeGrant | null>(
    null,
  );

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["admin-scope-grants", kind, page],
    queryFn: () => api.adminScopeGrants(kind, page),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.adminRevokeScopeGrant(kind, id),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["admin-scope-grants"] });
      setPendingRevoke(null);
      showMsg("success", res.message);
    },
    onError: (err) =>
      showMsg("error", err instanceof ApiError ? err.message : String(err)),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className={styles.root}>
      {message && <MessageBar intent={message.type}>{message.text}</MessageBar>}
      <MessageBar intent="info">
        <MarkdownText source={t("admin.scopeGrantsNotice")} />
      </MessageBar>

      <TabList
        selectedValue={kind}
        onTabSelect={(_, d) => {
          setKind(d.value as "site" | "team");
          setPage(1);
        }}
      >
        <Tab value="site">{t("admin.siteGrantsTab")}</Tab>
        <Tab value="team">{t("admin.teamGrantsTab")}</Tab>
      </TabList>

      <div className={styles.tableScroll}>
        <Table size="small">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>{t("admin.applicationsTab")}</TableHeaderCell>
              <TableHeaderCell>
                {kind === "site"
                  ? t("admin.scopesHeader")
                  : t("admin.permissionsHeader")}
              </TableHeaderCell>
              <TableHeaderCell>
                {kind === "site"
                  ? t("admin.grantedByHeader")
                  : t("admin.teamHeader")}
              </TableHeaderCell>
              <TableHeaderCell>{t("admin.grantedHeader")}</TableHeaderCell>
              <TableHeaderCell style={{ width: 1 }} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <SkeletonTableRows rows={6} cols={5} />
            ) : data?.grants.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <Text className={styles.muted}>
                    {t("admin.noScopeGrants")}
                  </Text>
                </TableCell>
              </TableRow>
            ) : (
              data?.grants.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div>
                      <Text weight="semibold" block>
                        {row.app_name ?? t("admin.unknownApp")}
                      </Text>
                      <Text size={200} className={styles.mono}>
                        {row.client_id}
                      </Text>
                    </div>
                  </TableCell>
                  <TableCell>
                    {kind === "site" ? (
                      <div className={styles.scopes}>
                        {(row.scopes ?? []).map((s) => (
                          <Badge key={s} appearance="tint" size="small">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <Text size={200} className={styles.mono}>
                        {JSON.stringify(row.permissions)}
                      </Text>
                    )}
                  </TableCell>
                  <TableCell>
                    {kind === "site" ? (
                      <Text size={200}>
                        {row.admin_username ? `@${row.admin_username}` : "—"}
                      </Text>
                    ) : row.team_id ? (
                      <Button
                        size="small"
                        appearance="subtle"
                        onClick={() => navigate(`/teams/${row.team_id}`)}
                      >
                        {row.team_name ?? row.team_id}
                      </Button>
                    ) : (
                      <Text className={styles.muted}>—</Text>
                    )}
                  </TableCell>
                  <TableCell>
                    <Text size={200}>{formatDate(row.granted_at)}</Text>
                  </TableCell>
                  <TableCell>
                    <div style={{ display: "flex", gap: 4 }}>
                      <CopyIdButton id={row.id} />
                      <Button
                        size="small"
                        appearance="subtle"
                        icon={<DeleteRegular />}
                        aria-label={t("common.revoke")}
                        onClick={() => setPendingRevoke(row)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <Pagination
          page={page}
          pageCount={totalPages}
          total={data?.total}
          disabled={isLoading || isFetching}
          onChange={setPage}
        />
      )}

      <Dialog
        open={pendingRevoke !== null}
        onOpenChange={(_, d) => !d.open && setPendingRevoke(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("admin.revokeGrantTitle")}</DialogTitle>
            <DialogContent>
              <Text block>
                {t("admin.revokeGrantBody", {
                  app:
                    pendingRevoke?.app_name ?? pendingRevoke?.client_id ?? "",
                })}
              </Text>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button>{t("common.cancel")}</Button>
              </DialogTrigger>
              <Button
                appearance="primary"
                style={{ background: tokens.colorPaletteRedBackground3 }}
                disabled={revoke.isPending}
                onClick={() => pendingRevoke && revoke.mutate(pendingRevoke.id)}
              >
                {t("common.revoke")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
