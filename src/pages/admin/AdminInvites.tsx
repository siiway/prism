// Admin: site invite management

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
  MessageBar,
  Spinner,
  Tab,
  TabList,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Tooltip,
  Title3,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  CopyRegular,
  DeleteRegular,
  DismissRegular,
  EditRegular,
  MailRegular,
  PauseRegular,
  PlayRegular,
  SearchRegular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, type SiteInvite } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import { AdminTeamInvites } from "./AdminTeamInvites";
import { formatDate } from "../../lib/datetime";
import { EmptyState } from "../../components/EmptyState";
import { Pagination } from "../../components/Pagination";
import { SkeletonTableRows } from "../../components/Skeletons";

const useStyles = makeStyles({
  tableScroll: { overflowX: "auto" },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    minWidth: 0,
    flex: 1,
  },
  form: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    alignItems: "start",
    gap: "12px",
    padding: "16px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "8px",
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    "& > *": {
      minWidth: 0,
    },
    "& input": {
      width: "100%",
      boxSizing: "border-box",
    },
    "@media (max-width: 600px)": {
      gridTemplateColumns: "1fr",
    },
  },
  formFull: { gridColumn: "1 / -1" },
  actions: {
    gridColumn: "1 / -1",
    display: "flex",
    justifyContent: "flex-end",
    flexWrap: "wrap",
  },
  copyRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginTop: "4px",
  },
  urlBox: {
    flex: 1,
    fontFamily: "monospace",
    fontSize: "12px",
    padding: "4px 8px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "4px",
    background: tokens.colorNeutralBackground3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  searchBar: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  rowActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "2px",
    whiteSpace: "nowrap",
  },
  actionHeader: { width: "1px" },
  editForm: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
});

export function AdminInvites() {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [tab, setTab] = useState<"site" | "team">("site");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [query]);

  const [form, setForm] = useState({
    email: "",
    note: "",
    max_uses: "",
    expires_in_days: "",
    send_email: false,
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [newInviteUrl, setNewInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<SiteInvite | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [editInvite, setEditInvite] = useState<SiteInvite | null>(null);
  const [editForm, setEditForm] = useState({
    email: "",
    note: "",
    max_uses: "",
    expires_in_days: "",
  });
  const [savingInvite, setSavingInvite] = useState(false);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "invites", page, debouncedQuery],
    queryFn: () =>
      api.adminListInvites({ page, limit: 20, q: debouncedQuery || undefined }),
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    setCreating(true);
    try {
      const emailList = form.email
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

      if (emailList.length > 1) {
        const remainingEmails = [...emailList];
        const failed: string[] = [];
        for (const em of emailList) {
          try {
            await api.adminCreateInvite({
              email: em,
              note: form.note || undefined,
              max_uses: 1,
              expires_in_days: form.expires_in_days
                ? parseInt(form.expires_in_days, 10)
                : undefined,
              send_email: form.send_email,
            });
            const idx = remainingEmails.indexOf(em);
            if (idx !== -1) remainingEmails.splice(idx, 1);
          } catch {
            failed.push(em);
          }
        }
        qc.invalidateQueries({ queryKey: ["admin", "invites"] });
        if (failed.length > 0) {
          setForm((f) => ({
            ...f,
            email: failed.join(", "),
            max_uses: String(failed.length),
          }));
          setCreateError(
            `Created ${emailList.length - failed.length} invites. Failed for: ${failed.join(", ")}`,
          );
          return;
        }
        setNewInviteUrl(null);
        setForm({
          email: "",
          note: "",
          max_uses: "",
          expires_in_days: "",
          send_email: false,
        });
        return;
      }

      const res = await api.adminCreateInvite({
        email: emailList[0] || undefined,
        note: form.note || undefined,
        max_uses: emailList.length === 1 ? 1 : form.max_uses ? parseInt(form.max_uses, 10) : undefined,
        expires_in_days: form.expires_in_days
          ? parseInt(form.expires_in_days, 10)
          : undefined,
        send_email: form.send_email,
      });
      setNewInviteUrl(res.invite.invite_url);
      setForm({
        email: "",
        note: "",
        max_uses: "",
        expires_in_days: "",
        send_email: false,
      });
      qc.invalidateQueries({ queryKey: ["admin", "invites"] });
    } catch (err) {
      setCreateError(
        err instanceof ApiError ? err.message : "Failed to create invite",
      );
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await api.adminRevokeInvite(revokeTarget.id);
      qc.invalidateQueries({ queryKey: ["admin", "invites"] });
    } finally {
      setRevoking(false);
      setRevokeTarget(null);
    }
  };

  const handleInviteEnabled = async (invite: SiteInvite, enabled: boolean) => {
    try {
      await api.adminUpdateInvite(invite.id, { enabled });
      qc.invalidateQueries({ queryKey: ["admin", "invites"] });
    } catch (err) {
      setCreateError(
        err instanceof ApiError ? err.message : "Failed to update invite",
      );
    }
  };

  const openEditInvite = (invite: SiteInvite) => {
    setEditInvite(invite);
    setEditForm({
      email: invite.email ?? "",
      note: invite.note ?? "",
      max_uses: invite.max_uses?.toString() ?? "",
      expires_in_days: invite.expires_at
        ? String(Math.max(1, Math.ceil((invite.expires_at - now) / 86400)))
        : "",
    });
  };

  const handleEditInvite = async () => {
    if (!editInvite) return;
    setSavingInvite(true);
    try {
      await api.adminUpdateInvite(editInvite.id, {
        email: editForm.email.trim() || null,
        note: editForm.note.trim() || null,
        max_uses: editForm.max_uses.trim() ? Number(editForm.max_uses) : null,
        expires_in_days: editForm.expires_in_days.trim()
          ? Number(editForm.expires_in_days)
          : null,
      });
      await qc.invalidateQueries({ queryKey: ["admin", "invites"] });
      setEditInvite(null);
    } catch (err) {
      setCreateError(
        err instanceof ApiError ? err.message : "Failed to update invite",
      );
    } finally {
      setSavingInvite(false);
    }
  };

  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(id);
  }, []);

  const totalPages = data ? Math.ceil(data.total / 20) : 1;

  // Site invites create accounts on the instance; team invites add people to
  // a team (and, when granted, create accounts too). Different lifecycles,
  // same question when one leaks — so they share a screen rather than a table.
  if (tab === "team") {
    return (
      <div className={styles.section}>
        <TabList
          selectedValue={tab}
          onTabSelect={(_, d) => setTab(d.value as "site" | "team")}
        >
          <Tab value="site">{t("admin.siteInvitesTab")}</Tab>
          <Tab value="team">{t("admin.teamInvitesTab")}</Tab>
        </TabList>
        <AdminTeamInvites />
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <TabList
        selectedValue={tab}
        onTabSelect={(_, d) => setTab(d.value as "site" | "team")}
      >
        <Tab value="site">{t("admin.siteInvitesTab")}</Tab>
        <Tab value="team">{t("admin.teamInvitesTab")}</Tab>
      </TabList>

      <Title3>{t("admin.invites")}</Title3>

      <form onSubmit={handleCreate} className={styles.form}>
        <Field label={t("admin.inviteEmail")} hint={t("admin.inviteEmailHint")}>
          <Input
            value={form.email}
            onChange={(e) => {
              const val = e.target.value;
              const emails = val.split(",").map((x) => x.trim()).filter(Boolean);
              setForm((f) => ({
                ...f,
                email: val,
                max_uses: emails.length > 0 ? String(emails.length) : f.max_uses,
              }));
            }}
            placeholder="user@example.com"
          />
        </Field>

        <Field label={t("admin.inviteNote")} hint={t("admin.inviteNoteHint")}>
          <Input
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          />
        </Field>

        <Field
          label={t("admin.inviteMaxUses")}
          hint={t("admin.inviteMaxUsesHint")}
        >
          <Input
            type="number"
            min={1}
            value={
              form.email.trim()
                ? String(
                    form.email
                      .split(",")
                      .map((x) => x.trim())
                      .filter(Boolean).length || 1,
                  )
                : form.max_uses
            }
            disabled={form.email.trim().length > 0}
            onChange={(e) =>
              setForm((f) => ({ ...f, max_uses: e.target.value }))
            }
            placeholder={t("admin.inviteUnlimited")}
          />
        </Field>

        <Field label={t("admin.inviteExpiresIn")}>
          <Input
            type="number"
            min={1}
            value={form.expires_in_days}
            onChange={(e) =>
              setForm((f) => ({ ...f, expires_in_days: e.target.value }))
            }
            placeholder={t("admin.inviteNoExpiry")}
          />
        </Field>

        <div className={styles.formFull}>
          <Switch
            label={t("admin.inviteSendEmail")}
            checked={form.send_email}
            disabled={!form.email}
            onChange={(_, d) =>
              setForm((f) => ({ ...f, send_email: d.checked }))
            }
          />
        </div>

        {createError && (
          <div className={styles.formFull}>
            <MessageBar intent="error">{createError}</MessageBar>
          </div>
        )}

        {newInviteUrl && (
          <div className={styles.formFull}>
            <Text size={200} weight="semibold">
              {t("admin.inviteLink")}
            </Text>
            <div className={styles.copyRow}>
              <Text className={styles.urlBox}>{newInviteUrl}</Text>
              <Button
                icon={<CopyRegular />}
                appearance="subtle"
                onClick={() => handleCopy(newInviteUrl)}
              >
                {copied ? t("admin.inviteCopied") : undefined}
              </Button>
            </div>
          </div>
        )}

        <div className={styles.actions}>
          <Button
            appearance="primary"
            type="submit"
            disabled={creating}
            icon={creating ? <Spinner size="tiny" /> : undefined}
          >
            {t("admin.createInvite")}
          </Button>
        </div>
      </form>

      <div className={styles.searchBar}>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("teams.searchInvitesPlaceholder")}
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
          style={{ flex: 1 }}
        />
      </div>

      {isLoading ? (
        <SkeletonTableRows rows={5} cols={6} />
      ) : !data?.invites.length ? (
        <EmptyState
          icon={<MailRegular />}
          title={
            debouncedQuery
              ? t("teams.noResultsMatch")
              : t("admin.inviteNoInvites")
          }
        />
      ) : (
        <>
          <div className={styles.tableScroll}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>{t("admin.inviteEmail")}</TableHeaderCell>
                  <TableHeaderCell>{t("admin.inviteNote")}</TableHeaderCell>
                  <TableHeaderCell>{t("admin.inviteUsed")}</TableHeaderCell>
                  <TableHeaderCell>
                    {t("admin.inviteCreatedBy")}
                  </TableHeaderCell>
                  <TableHeaderCell>
                    {t("admin.inviteExpiresIn")}
                  </TableHeaderCell>
                  <TableHeaderCell className={styles.actionHeader} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.invites.map((inv) => {
                  const expired =
                    inv.expires_at !== null && inv.expires_at < now;
                  const exhausted =
                    inv.max_uses !== null && inv.use_count >= inv.max_uses;
                  const inviteUrl = `${window.location.origin}/register?invite=${inv.token}`;
                  return (
                    <TableRow key={inv.id}>
                      <TableCell>{inv.email ?? "—"}</TableCell>
                      <TableCell>{inv.note ?? "—"}</TableCell>
                      <TableCell>
                        {inv.use_count}
                        {inv.max_uses !== null
                          ? ` / ${inv.max_uses}`
                          : ` / ${t("admin.inviteUnlimited")}`}
                        {exhausted && (
                          <Badge color="warning" style={{ marginLeft: 6 }}>
                            {t("admin.inviteUsed")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {inv.created_by_username ?? inv.created_by}
                      </TableCell>
                      <TableCell>
                        {inv.expires_at ? (
                          <>
                            {formatDate(inv.expires_at)}
                            {expired && (
                              <Badge color="danger" style={{ marginLeft: 6 }}>
                                {t("admin.inviteExpired")}
                              </Badge>
                            )}
                          </>
                        ) : (
                          t("admin.inviteNoExpiry")
                        )}
                      </TableCell>
                      <TableCell>
                        {!inv.enabled && (
                          <Badge color="danger" appearance="tint">
                            {t("admin.inviteDisabled")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className={styles.rowActions}>
                          <Tooltip
                            content={
                              inv.token_available === false
                                ? t("admin.hashedInviteCopyHint")
                                : copiedInviteId === inv.id
                                  ? t("admin.inviteCopied")
                                  : t("admin.copyInviteLink")
                            }
                            relationship="label"
                          >
                            <span>
                              <Button
                                icon={<CopyRegular />}
                                appearance="subtle"
                                size="small"
                                disabled={inv.token_available === false}
                                aria-label={t("admin.copyInviteLink")}
                                onClick={async () => {
                                  await handleCopy(inviteUrl);
                                  setCopiedInviteId(inv.id);
                                  setTimeout(
                                    () => setCopiedInviteId(null),
                                    2000,
                                  );
                                }}
                              />
                            </span>
                          </Tooltip>
                          <Tooltip
                            content={t("common.edit")}
                            relationship="label"
                          >
                            <Button
                              icon={<EditRegular />}
                              appearance="subtle"
                              size="small"
                              aria-label={t("common.edit")}
                              onClick={() => openEditInvite(inv)}
                            />
                          </Tooltip>
                          <Tooltip
                            content={
                              inv.enabled
                                ? t("admin.disableInvite")
                                : t("admin.enableInvite")
                            }
                            relationship="label"
                          >
                            <Button
                              icon={
                                inv.enabled ? <PauseRegular /> : <PlayRegular />
                              }
                              appearance="subtle"
                              size="small"
                              aria-label={
                                inv.enabled
                                  ? t("admin.disableInvite")
                                  : t("admin.enableInvite")
                              }
                              onClick={() =>
                                handleInviteEnabled(inv, !inv.enabled)
                              }
                            />
                          </Tooltip>
                          <Tooltip
                            content={t("admin.inviteRevoke")}
                            relationship="label"
                          >
                            <Button
                              icon={<DeleteRegular />}
                              appearance="subtle"
                              size="small"
                              aria-label={t("admin.inviteRevoke")}
                              onClick={() => setRevokeTarget(inv)}
                            />
                          </Tooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {totalPages > 1 && (
            <Pagination
              page={page}
              pageCount={totalPages}
              onChange={setPage}
              total={data?.total}
            />
          )}
        </>
      )}

      <Dialog
        open={editInvite !== null}
        onOpenChange={(_, data) => !data.open && setEditInvite(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("admin.editInviteTitle")}</DialogTitle>
            <DialogContent>
              <div className={styles.editForm}>
                <Field label={t("admin.inviteEmail")}>
                  <Input
                    type="email"
                    value={editForm.email}
                    onChange={(_, data) =>
                      setEditForm((form) => ({ ...form, email: data.value }))
                    }
                  />
                </Field>
                <Field label={t("admin.inviteNote")}>
                  <Input
                    value={editForm.note}
                    onChange={(_, data) =>
                      setEditForm((form) => ({ ...form, note: data.value }))
                    }
                  />
                </Field>
                <Field
                  label={t("admin.inviteMaxUses")}
                  hint={t("admin.inviteMaxUsesHint")}
                >
                  <Input
                    type="number"
                    min={1}
                    value={editForm.max_uses}
                    onChange={(_, data) =>
                      setEditForm((form) => ({ ...form, max_uses: data.value }))
                    }
                  />
                </Field>
                <Field label={t("admin.inviteExpiresIn")}>
                  <Input
                    type="number"
                    min={1}
                    value={editForm.expires_in_days}
                    onChange={(_, data) =>
                      setEditForm((form) => ({
                        ...form,
                        expires_in_days: data.value,
                      }))
                    }
                  />
                </Field>
              </div>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setEditInvite(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                appearance="primary"
                disabled={savingInvite}
                icon={savingInvite ? <Spinner size="tiny" /> : undefined}
                onClick={handleEditInvite}
              >
                {t("common.saveChanges")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog
        open={!!revokeTarget}
        onOpenChange={(_, s) => !s.open && setRevokeTarget(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("admin.inviteRevokeConfirm")}</DialogTitle>
            <DialogContent>
              {revokeTarget && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                  <div>
                    <Text weight="semibold">{t("admin.inviteToken")}: </Text>
                    <Text style={{ fontFamily: "monospace" }}>
                      {revokeTarget.token_available === false
                        ? "(hashed)"
                        : `${revokeTarget.token.slice(0, 4)}...${revokeTarget.token.slice(-4)}`}
                    </Text>
                  </div>
                  {revokeTarget.email && (
                    <div>
                      <Text weight="semibold">{t("admin.inviteEmail")}: </Text>
                      <Text>{revokeTarget.email}</Text>
                    </div>
                  )}
                  {revokeTarget.note && (
                    <div>
                      <Text weight="semibold">{t("admin.inviteNote")}: </Text>
                      <Text>{revokeTarget.note}</Text>
                    </div>
                  )}
                  <div>
                    <Text weight="semibold">{t("admin.inviteUsed")}: </Text>
                    <Text>
                      {revokeTarget.use_count}
                      {revokeTarget.max_uses !== null
                        ? ` / ${revokeTarget.max_uses}`
                        : ` / ${t("admin.inviteUnlimited")}`}
                    </Text>
                  </div>
                  <div>
                    <Text weight="semibold">{t("admin.inviteCreatedBy")}: </Text>
                    <Text>
                      {revokeTarget.created_by_username
                        ? `@${revokeTarget.created_by_username}`
                        : revokeTarget.created_by}
                    </Text>
                  </div>
                  <div>
                    <Text weight="semibold">{t("admin.inviteExpiresIn")}: </Text>
                    <Text>
                      {revokeTarget.expires_at
                        ? formatDate(revokeTarget.expires_at)
                        : t("admin.inviteNoExpiry")}
                    </Text>
                  </div>
                </div>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setRevokeTarget(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                appearance="primary"
                onClick={handleRevoke}
                disabled={revoking}
                icon={revoking ? <Spinner size="tiny" /> : undefined}
              >
                {t("admin.inviteRevoke")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
