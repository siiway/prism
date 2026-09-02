// Every outstanding team invite on the instance.
//
// Invites were visible only from inside the team that issued them, which is
// the wrong index when a link has leaked and the question is "what else did
// this creator hand out". Registration-capable invites — the ones that mint
// accounts rather than adding existing ones — are the reason this needs to be
// one list rather than a tour of every team page.

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
  Input,
  MessageBar,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { DeleteRegular, SearchRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import type { AdminTeamInvite } from "../../lib/api";
import { CopyIdButton } from "../../components/CopyIdButton";
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
  toolbar: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    flexWrap: "wrap",
  },
  search: { flexGrow: 1, minWidth: "200px" },
  tableScroll: { overflowX: "auto" },
  token: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
  muted: { color: tokens.colorNeutralForeground3 },
});

export function AdminTeamInvites() {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { message, showMsg } = useToastMessage();

  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [registrationOnly, setRegistrationOnly] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<AdminTeamInvite | null>(
    null,
  );

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["admin-team-invites", page, search, registrationOnly],
    queryFn: () =>
      api.adminTeamInvites({
        page,
        limit: PAGE_SIZE,
        q: search || undefined,
        registration: registrationOnly || undefined,
      }),
  });

  const revoke = useMutation({
    mutationFn: (token: string) => api.adminRevokeTeamInvite(token),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["admin-team-invites"] });
      setPendingRevoke(null);
      showMsg("success", res.message);
    },
    onError: (err) =>
      showMsg("error", err instanceof ApiError ? err.message : String(err)),
  });

  const applySearch = () => {
    setSearch(searchDraft.trim());
    setPage(1);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className={styles.root}>
      {message && <MessageBar intent={message.type}>{message.text}</MessageBar>}

      <div className={styles.toolbar}>
        <Input
          className={styles.search}
          value={searchDraft}
          placeholder={t("admin.teamInviteSearch")}
          contentBefore={<SearchRegular />}
          onChange={(_, d) => setSearchDraft(d.value)}
          onKeyDown={(e) => e.key === "Enter" && applySearch()}
        />
        <Switch
          checked={registrationOnly}
          onChange={(_, d) => {
            setRegistrationOnly(d.checked);
            setPage(1);
          }}
          label={t("admin.registrationInvitesOnly")}
        />
        <Button onClick={applySearch}>{t("common.search")}</Button>
      </div>

      <div className={styles.tableScroll}>
        <Table size="small">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>{t("admin.teamHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.roleHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.usesHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.expiresHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.createdByHeader")}</TableHeaderCell>
              <TableHeaderCell style={{ width: 1 }} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <SkeletonTableRows rows={8} cols={6} />
            ) : data?.invites.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <Text className={styles.muted}>
                    {t("admin.noTeamInvites")}
                  </Text>
                </TableCell>
              </TableRow>
            ) : (
              data?.invites.map((row) => (
                <TableRow key={row.token}>
                  <TableCell>
                    <div>
                      <Button
                        appearance="subtle"
                        size="small"
                        onClick={() => navigate(`/teams/${row.team_id}`)}
                      >
                        {row.team_name ?? row.team_id}
                      </Button>
                      {row.allows_registration && (
                        <Badge
                          appearance="tint"
                          color="warning"
                          size="small"
                          style={{ marginInlineStart: 4 }}
                        >
                          {t("admin.mintsAccounts")}
                        </Badge>
                      )}
                      {row.email && (
                        <Text size={200} block className={styles.muted}>
                          {row.email}
                        </Text>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Text size={200}>{row.role}</Text>
                  </TableCell>
                  <TableCell>
                    <Text size={200}>
                      {row.max_uses
                        ? `${row.uses} / ${row.max_uses}`
                        : row.uses}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <Text size={200}>
                      {row.expires_at ? formatDate(row.expires_at) : "—"}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <Text size={200}>
                      {row.created_by_username
                        ? `@${row.created_by_username}`
                        : "—"}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <div style={{ display: "flex", gap: 4 }}>
                      {/* The token is the credential — copyable so a leaked
                          link can be matched against what exists. */}
                      <Tooltip
                        relationship="label"
                        content={t("admin.copyInviteToken")}
                      >
                        <span>
                          <CopyIdButton id={row.token} />
                        </span>
                      </Tooltip>
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
            <DialogTitle>{t("admin.revokeInviteTitle")}</DialogTitle>
            <DialogContent>
              <Text block>
                {t("admin.revokeInviteBody", {
                  team: pendingRevoke?.team_name ?? "",
                  uses: pendingRevoke?.uses ?? 0,
                })}
              </Text>
              <Text block size={200} className={styles.token}>
                {pendingRevoke?.token}
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
                onClick={() =>
                  pendingRevoke && revoke.mutate(pendingRevoke.token)
                }
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
