// Domains: verified team domains mark the team's apps as verified.

import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Spinner,
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
import {
  AddRegular,
  CheckmarkCircleRegular,
  DeleteRegular,
  DismissRegular,
  MoreHorizontalRegular,
  SearchRegular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  type Domain,
  type DomainAddResponse,
  type VerificationMethod,
} from "../../../lib/api";
import { useApi } from "../../../lib/api-context";
import { formatDate } from "../../../lib/datetime";
import { useConfirm } from "../../../lib/useConfirm";
import { Pagination } from "../../../components/Pagination";
import {
  SettingsBody,
  SettingsCard,
  SettingsEmpty,
  SettingsFooter,
  SettingsTable,
} from "../../../components/Settings";
import { SkeletonSettingsCard } from "../../../components/Skeletons";
import { DnsAddedInfo } from "../../domains/components";
import { TeamDomainDetailDialog } from "../dialogs/TeamDomainDetailDialog";
import { TransferFromPersonalDialog } from "../dialogs/TransferFromPersonalDialog";
import type { TeamTabProps } from "./types";

const PAGE_SIZE = 20;

const useStyles = makeStyles({
  toolbar: { padding: "0 var(--card-pad) 16px" },
  domain: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase300,
  },
  row: { cursor: "pointer" },
  muted: { color: tokens.colorNeutralForeground3 },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "2px",
    whiteSpace: "nowrap",
  },
  actionsHead: { width: "1px" },
  danger: { color: tokens.colorPaletteRedForeground1 },
});

export function DomainsTab({ team, canManage, showMsg }: TeamTabProps) {
  const api = useApi();
  const styles = useStyles();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { confirm, confirmDialog } = useConfirm();
  const teamId = team.id;

  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => {
      setDebounced(query.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [query]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["team-domains", teamId, page, debounced],
    queryFn: () =>
      api.listTeamDomains(teamId, {
        page,
        limit: PAGE_SIZE,
        q: debounced || undefined,
      }),
  });
  const domains = data?.domains ?? [];
  const total = data?.total ?? 0;

  // Personal domains that could move into the team.
  const { data: personal } = useQuery({
    queryKey: ["domains"],
    queryFn: () => api.listDomains(),
    enabled: canManage,
  });
  const transferable = (personal?.domains ?? []).filter(
    (d: Domain) => !("team_id" in d && d.team_id),
  );

  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["team-domains", teamId] });
  const fail = (err: unknown, fallback: string) =>
    showMsg("error", err instanceof ApiError ? err.message : fallback);

  // ── Add ────────────────────────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<DomainAddResponse | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);

  const add = async () => {
    if (!newDomain.trim()) return;
    setAdding(true);
    try {
      setAdded(await api.addTeamDomain(teamId, newDomain.trim()));
      setNewDomain("");
      setAddOpen(false);
      await refresh();
    } catch (err) {
      fail(err, t("domains.failedAddDomain"));
    } finally {
      setAdding(false);
    }
  };

  // ── Row actions ────────────────────────────────────────────────────────────
  const [verifying, setVerifying] = useState<string | null>(null);
  const [selected, setSelected] = useState<Domain | null>(null);

  const verify = async (domainId: string, method?: VerificationMethod) => {
    setVerifying(domainId);
    try {
      const res = await api.verifyTeamDomain(teamId, domainId, method);
      if (res.verified) {
        showMsg("success", t("domains.domainVerified"));
        await refresh();
      } else {
        showMsg("error", t("domains.verificationCheckFailed"));
      }
    } catch (err) {
      fail(err, t("domains.verificationFailed"));
    } finally {
      setVerifying(null);
    }
  };

  const remove = async (d: Domain) => {
    const ok = await confirm({
      title: t("domains.removeDomain"),
      body: t("domains.removeDomainTeamDesc", { domain: d.domain }),
      confirmLabel: t("common.remove"),
    });
    if (!ok) return;
    try {
      await api.deleteTeamDomain(teamId, d.id);
      await refresh();
    } catch (err) {
      fail(err, t("domains.deleteFailed"));
    }
  };

  const returnToPersonal = async (d: Domain) => {
    try {
      await api.returnDomainToPersonal(teamId, d.id);
      await refresh();
      await qc.invalidateQueries({ queryKey: ["domains"] });
      showMsg("success", t("domains.domainReturnedToPersonal"));
    } catch (err) {
      fail(err, t("domains.transferFailed"));
    }
  };

  const shareToPersonal = async (d: Domain) => {
    try {
      await api.shareTeamDomainToPersonal(teamId, d.id);
      await qc.invalidateQueries({ queryKey: ["domains"] });
      showMsg("success", t("domains.domainSharedToPersonal"));
    } catch (err) {
      fail(err, t("domains.shareFailed"));
    }
  };

  if (isLoading) return <SkeletonSettingsCard rows={2} />;

  return (
    <>
      <SettingsCard
        id="domains"
        title={t("teams.domainsTitle")}
        description={t("teams.domainsCardDesc")}
        action={
          canManage && (
            <>
              {transferable.length > 0 && (
                <Button size="small" onClick={() => setTransferOpen(true)}>
                  {t("domains.transferFromPersonal")}
                </Button>
              )}
              <Button
                size="small"
                icon={<AddRegular />}
                onClick={() => setAddOpen(true)}
              >
                {t("domains.addDomain")}
              </Button>
            </>
          )
        }
      >
        {added && (
          <SettingsBody>
            <DnsAddedInfo info={added} onDismiss={() => setAdded(null)} />
          </SettingsBody>
        )}
        {(total > 5 || debounced) && (
          <div className={styles.toolbar}>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("teams.searchTeamDomainsPlaceholder")}
              contentBefore={<SearchRegular />}
              contentAfter={
                query ? (
                  <Button
                    appearance="transparent"
                    size="small"
                    icon={<DismissRegular />}
                    aria-label={t("common.clear")}
                    onClick={() => setQuery("")}
                  />
                ) : undefined
              }
              style={{ width: "100%" }}
            />
          </div>
        )}
        {domains.length === 0 ? (
          <SettingsEmpty>{t("domains.noDomainsYet")}</SettingsEmpty>
        ) : (
          <SettingsTable>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>{t("domains.domainHeader")}</TableHeaderCell>
                  <TableHeaderCell>{t("domains.statusHeader")}</TableHeaderCell>
                  <TableHeaderCell>
                    {t("domains.verifiedAtHeader")}
                  </TableHeaderCell>
                  {canManage && (
                    <TableHeaderCell className={styles.actionsHead} />
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {domains.map((d) => (
                  <TableRow
                    key={d.id}
                    className={styles.row}
                    onClick={() => setSelected(d)}
                  >
                    <TableCell>
                      <span className={styles.domain}>{d.domain}</span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        appearance="tint"
                        size="small"
                        color={d.verified ? "success" : "warning"}
                        icon={
                          d.verified ? <CheckmarkCircleRegular /> : undefined
                        }
                      >
                        {d.verified
                          ? t("domains.verifiedBadge")
                          : t("domains.pending")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Text size={200} className={styles.muted}>
                        {d.verified_at ? formatDate(d.verified_at) : "—"}
                      </Text>
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <div
                          className={styles.actions}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {!d.verified && (
                            <Button
                              size="small"
                              disabled={verifying === d.id}
                              onClick={() => verify(d.id)}
                            >
                              {verifying === d.id ? (
                                <Spinner size="tiny" />
                              ) : (
                                t("common.verify")
                              )}
                            </Button>
                          )}
                          <Menu>
                            <MenuTrigger disableButtonEnhancement>
                              <Button
                                size="small"
                                appearance="subtle"
                                icon={<MoreHorizontalRegular />}
                                aria-label={t("domains.actionsHeader")}
                              />
                            </MenuTrigger>
                            <MenuPopover>
                              <MenuList>
                                {!!d.verified && (
                                  <MenuItem onClick={() => verify(d.id)}>
                                    {t("domains.checkAgain")}
                                  </MenuItem>
                                )}
                                <MenuItem onClick={() => returnToPersonal(d)}>
                                  {t("domains.returnToPersonal")}
                                </MenuItem>
                                <MenuItem onClick={() => shareToPersonal(d)}>
                                  {t("domains.shareToPersonal")}
                                </MenuItem>
                                <MenuDivider />
                                <MenuItem
                                  icon={<DeleteRegular />}
                                  className={styles.danger}
                                  onClick={() => remove(d)}
                                >
                                  {t("common.remove")}
                                </MenuItem>
                              </MenuList>
                            </MenuPopover>
                          </Menu>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SettingsTable>
        )}
        {(total > PAGE_SIZE || page > 1) && (
          <SettingsFooter>
            <Pagination
              page={page}
              pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
              onChange={setPage}
              disabled={isFetching}
            />
          </SettingsFooter>
        )}
      </SettingsCard>

      <Dialog open={addOpen} onOpenChange={(_, d) => setAddOpen(d.open)}>
        <DialogSurface>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <DialogBody>
              <DialogTitle>{t("domains.addDomain")}</DialogTitle>
              <DialogContent>
                <Field
                  label={t("domains.domainHeader")}
                  hint={t("teams.addDomainHint")}
                  required
                >
                  <Input
                    autoFocus
                    value={newDomain}
                    onChange={(_, d) => setNewDomain(d.value)}
                    placeholder={t("domains.addDomainPlaceholder")}
                  />
                </Field>
              </DialogContent>
              <DialogActions>
                <Button type="button" onClick={() => setAddOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  appearance="primary"
                  disabled={adding || !newDomain.trim()}
                >
                  {adding ? <Spinner size="tiny" /> : t("common.add")}
                </Button>
              </DialogActions>
            </DialogBody>
          </form>
        </DialogSurface>
      </Dialog>

      <TransferFromPersonalDialog
        teamId={teamId}
        open={transferOpen}
        transferableDomains={transferable}
        onClose={() => setTransferOpen(false)}
        showMsg={showMsg}
      />
      <TeamDomainDetailDialog
        domain={selected}
        canManage={canManage}
        verifyingDomain={verifying}
        onClose={() => setSelected(null)}
        onVerify={verify}
      />
      {confirmDialog}
    </>
  );
}
