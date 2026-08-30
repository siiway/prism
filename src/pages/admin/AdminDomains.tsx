// Every domain on the instance, personal and team-owned.
//
// Domains were previously reachable only through the account or team that
// owned them, which is the wrong index for the question an operator actually
// has: who claims example.com, and is that claim real?
//
// The verify toggle here is an override, not a check. It marks a domain
// verified without proving anything about DNS — for split-horizon setups,
// internal TLDs, or a registrar outage, where the alternative is the domain
// never working. The audit entry records it as `admin_override` so the
// difference survives.

import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Dropdown,
  Input,
  MessageBar,
  Option,
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
import {
  CheckmarkCircleRegular,
  DeleteRegular,
  DismissCircleRegular,
  SearchRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import type { AdminDomain } from "../../lib/api";
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
  toolbar: { display: "flex", gap: "8px", flexWrap: "wrap" },
  search: { flexGrow: 1, minWidth: "200px" },
  tableScroll: { overflowX: "auto" },
  domain: { fontFamily: tokens.fontFamilyMonospace },
  owner: { display: "flex", alignItems: "center", gap: "6px" },
  muted: { color: tokens.colorNeutralForeground3 },
});

export function AdminDomains() {
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { message, showMsg } = useToastMessage();

  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "1" | "0">("all");
  const [pendingDelete, setPendingDelete] = useState<AdminDomain | null>(null);
  const [pendingVerify, setPendingVerify] = useState<AdminDomain | null>(null);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["admin-domains", page, search, filter],
    queryFn: () =>
      api.adminListDomains({
        page,
        limit: PAGE_SIZE,
        q: search || undefined,
        verified: filter === "all" ? undefined : filter,
      }),
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["admin-domains"] });

  const setVerified = useMutation({
    mutationFn: (v: { id: string; verified: boolean }) =>
      api.adminSetDomainVerified(v.id, v.verified),
    onSuccess: async (res) => {
      await invalidate();
      setPendingVerify(null);
      showMsg("success", res.message);
    },
    onError: (err) =>
      showMsg("error", err instanceof ApiError ? err.message : String(err)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.adminDeleteDomain(id),
    onSuccess: async (res) => {
      await invalidate();
      setPendingDelete(null);
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
          placeholder={t("admin.domainSearch")}
          contentBefore={<SearchRegular />}
          onChange={(_, d) => setSearchDraft(d.value)}
          onKeyDown={(e) => e.key === "Enter" && applySearch()}
        />
        <Dropdown
          value={t(
            filter === "all"
              ? "admin.domainFilterAll"
              : filter === "1"
                ? "admin.verifiedStatus"
                : "admin.unverifiedStatus",
          )}
          selectedOptions={[filter]}
          onOptionSelect={(_, d) => {
            setFilter((d.optionValue as "all" | "1" | "0") ?? "all");
            setPage(1);
          }}
        >
          <Option value="all" text={t("admin.domainFilterAll")}>
            {t("admin.domainFilterAll")}
          </Option>
          <Option value="1" text={t("admin.verifiedStatus")}>
            {t("admin.verifiedStatus")}
          </Option>
          <Option value="0" text={t("admin.unverifiedStatus")}>
            {t("admin.unverifiedStatus")}
          </Option>
        </Dropdown>
        <Button onClick={applySearch}>{t("common.search")}</Button>
      </div>

      <div className={styles.tableScroll}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>{t("admin.domainHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.ownerHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.statusHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.addedHeader")}</TableHeaderCell>
              <TableHeaderCell style={{ width: 1 }} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <SkeletonTableRows rows={8} cols={5} />
            ) : data?.domains.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <Text className={styles.muted}>{t("admin.noDomains")}</Text>
                </TableCell>
              </TableRow>
            ) : (
              data?.domains.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Text className={styles.domain}>{row.domain}</Text>
                  </TableCell>
                  <TableCell>
                    {row.team_id ? (
                      <Button
                        appearance="subtle"
                        size="small"
                        onClick={() => navigate(`/teams/${row.team_id}`)}
                      >
                        <span className={styles.owner}>
                          <Avatar
                            name={row.team_name ?? ""}
                            image={
                              row.team_avatar
                                ? { src: row.team_avatar }
                                : undefined
                            }
                            size={20}
                          />
                          {row.team_name ?? row.team_id}
                        </span>
                      </Button>
                    ) : row.user_id ? (
                      <Button
                        appearance="subtle"
                        size="small"
                        onClick={() => navigate(`/admin/users/${row.user_id}`)}
                      >
                        @{row.owner_username ?? row.user_id}
                      </Button>
                    ) : (
                      <Text className={styles.muted}>—</Text>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      appearance="tint"
                      color={row.verified ? "success" : "subtle"}
                    >
                      {row.verified
                        ? t("admin.verifiedStatus")
                        : t("admin.unverifiedStatus")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Text size={200}>{formatDate(row.created_at)}</Text>
                  </TableCell>
                  <TableCell>
                    <div style={{ display: "flex", gap: 4 }}>
                      <CopyIdButton id={row.id} />
                      {row.verified ? (
                        <Tooltip
                          relationship="label"
                          content={t("admin.domainUnverify")}
                        >
                          <Button
                            size="small"
                            appearance="subtle"
                            icon={<DismissCircleRegular />}
                            onClick={() =>
                              setVerified.mutate({
                                id: row.id,
                                verified: false,
                              })
                            }
                          />
                        </Tooltip>
                      ) : (
                        <Tooltip
                          relationship="label"
                          content={t("admin.domainForceVerify")}
                        >
                          <Button
                            size="small"
                            appearance="subtle"
                            icon={<CheckmarkCircleRegular />}
                            onClick={() => setPendingVerify(row)}
                          />
                        </Tooltip>
                      )}
                      <Button
                        size="small"
                        appearance="subtle"
                        icon={<DeleteRegular />}
                        aria-label={t("common.delete")}
                        onClick={() => setPendingDelete(row)}
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
        open={pendingVerify !== null}
        onOpenChange={(_, d) => !d.open && setPendingVerify(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("admin.domainForceVerifyTitle")}</DialogTitle>
            <DialogContent>
              <Text block>
                {t("admin.domainForceVerifyBody", {
                  domain: pendingVerify?.domain ?? "",
                })}
              </Text>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button>{t("common.cancel")}</Button>
              </DialogTrigger>
              <Button
                appearance="primary"
                disabled={setVerified.isPending}
                onClick={() =>
                  pendingVerify &&
                  setVerified.mutate({ id: pendingVerify.id, verified: true })
                }
              >
                {t("admin.domainForceVerify")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(_, d) => !d.open && setPendingDelete(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("admin.domainDeleteTitle")}</DialogTitle>
            <DialogContent>
              <Text>
                {t("admin.domainDeleteBody", {
                  domain: pendingDelete?.domain ?? "",
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
                disabled={remove.isPending}
                onClick={() => pendingDelete && remove.mutate(pendingDelete.id)}
              >
                {t("common.delete")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
