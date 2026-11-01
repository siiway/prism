// Invite links for a team: create, copy, edit, pause and revoke.

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
  Spinner,
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
  CheckmarkRegular,
  CopyRegular,
  DeleteRegular,
  DismissRegular,
  EditRegular,
  LinkRegular,
  MailRegular,
  PauseRegular,
  PlayRegular,
  SearchRegular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { type Team, type TeamInvite } from "../../../lib/api";
import { apiErrorText } from "../../../lib/apiError";
import { useApi } from "../../../lib/api-context";
import { formatDate } from "../../../lib/datetime";
import { toLocalDateTimeInput } from "../../../lib/inviteExpiry";
import type { ConfirmOptions } from "../../../lib/useConfirm";
import { Pagination } from "../../../components/Pagination";
import { RoleBadge } from "../../../components/RoleBadge";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsFooter,
  SettingsTable,
} from "../../../components/Settings";
import { SkeletonTableBodyRows } from "../../../components/Skeletons";
import { InviteDialog } from "../dialogs/InviteDialog";

const PAGE_SIZE = 20;

const useStyles = makeStyles({
  toolbar: { padding: "0 var(--card-pad) 16px" },
  muted: { color: tokens.colorNeutralForeground3 },
  target: { display: "flex", alignItems: "center", gap: "8px" },
  targetIcon: { flexShrink: 0, color: tokens.colorNeutralForeground3 },
  chips: { display: "flex", flexWrap: "wrap", gap: "4px" },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "2px",
    whiteSpace: "nowrap",
  },
  actionsHead: { width: "1px" },
  form: { display: "flex", flexDirection: "column", gap: "12px" },
});

interface Props {
  team: Team;
  showMsg: (type: "success" | "error", text: string) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

export function InvitesCard({ team, showMsg, confirm }: Props) {
  const api = useApi();
  const styles = useStyles();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const teamId = team.id;
  // Invites can create accounts when a site admin has allowed this team and
  // sign-up isn't closed.
  const { data: site } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });

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
    queryKey: ["team-invites", teamId, page, debounced],
    queryFn: () =>
      api.listTeamInvites(teamId, {
        page,
        limit: PAGE_SIZE,
        q: debounced || undefined,
      }),
  });
  const invites = data?.invites ?? [];
  const total = data?.total ?? 0;

  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["team-invites", teamId] });
  const fail = (err: unknown) =>
    showMsg("error", apiErrorText(err, t("teams.failedUpdateInvite")));

  const [copied, setCopied] = useState<string | null>(null);
  const copyLink = async (inv: TeamInvite) => {
    if (!inv.token) return;
    const link = inv.allows_registration
      ? `${window.location.origin}/join/${teamId}?invite=${inv.token}`
      : `${window.location.origin}/teams/join/${inv.token}`;
    await navigator.clipboard.writeText(link);
    setCopied(inv.token);
    setTimeout(() => setCopied(null), 1500);
  };

  const setEnabled = async (inv: TeamInvite, enabled: boolean) => {
    try {
      await api.updateTeamInvite(teamId, inv.token!, { enabled });
      await refresh();
    } catch (err) {
      fail(err);
    }
  };

  const revoke = async (inv: TeamInvite) => {
    const ok = await confirm({
      title: t("teams.revokeInviteTitle"),
      body: t("teams.revokeInviteBody"),
      confirmLabel: t("teams.revokeInvite"),
    });
    if (!ok) return;
    try {
      await api.revokeTeamInvite(teamId, inv.token!);
      await refresh();
      showMsg("success", t("teams.inviteRevoked"));
    } catch (err) {
      showMsg("error", apiErrorText(err, t("teams.failedRevokeInvite")));
    }
  };

  // ── Edit ───────────────────────────────────────────────────────────────────
  const [editing, setEditing] = useState<TeamInvite | null>(null);
  const [form, setForm] = useState({ email: "", max_uses: "", expires_at: "" });
  const [saving, setSaving] = useState(false);
  const openEdit = (inv: TeamInvite) => {
    setEditing(inv);
    setForm({
      email: inv.email ?? "",
      max_uses: String(inv.max_uses),
      expires_at: toLocalDateTimeInput(new Date(inv.expires_at * 1000)),
    });
  };
  const saveEdit = async () => {
    if (!editing?.token) return;
    const expiresAt = Math.floor(new Date(form.expires_at).getTime() / 1000);
    if (!Number.isFinite(expiresAt)) {
      showMsg("error", t("teams.inviteExpiryInvalid"));
      return;
    }
    setSaving(true);
    try {
      await api.updateTeamInvite(teamId, editing.token, {
        email: form.email.trim() || null,
        max_uses: Number(form.max_uses),
        expires_at: expiresAt,
      });
      await refresh();
      setEditing(null);
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  const iconButton = (
    label: string,
    icon: React.ReactElement,
    onClick: () => void,
    disabled = false,
  ) => (
    <Tooltip content={label} relationship="label" withArrow>
      <Button
        size="small"
        appearance="subtle"
        icon={icon}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
      />
    </Tooltip>
  );

  return (
    <SettingsCard
      id="invites"
      title={t("teams.invitesTitle")}
      description={t("teams.invitesDesc")}
      action={
        <InviteDialog
          teamId={teamId}
          canRegister={
            team.invite_registration_granted && !!site?.allow_registration
          }
          showMsg={showMsg}
        />
      }
    >
      {(total > 5 || debounced) && (
        <div className={styles.toolbar}>
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
            style={{ width: "100%" }}
          />
        </div>
      )}

      {!isLoading && invites.length === 0 ? (
        <SettingsEmpty>{t("teams.noActiveInvites")}</SettingsEmpty>
      ) : (
        <SettingsTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>{t("teams.inviteTypeHeader")}</TableHeaderCell>
                <TableHeaderCell>{t("teams.roleHeader")}</TableHeaderCell>
                <TableHeaderCell>{t("teams.inviteUsesHeader")}</TableHeaderCell>
                <TableHeaderCell>
                  {t("teams.inviteExpiresHeader")}
                </TableHeaderCell>
                <TableHeaderCell>
                  {t("teams.inviteCreatedByHeader")}
                </TableHeaderCell>
                <TableHeaderCell className={styles.actionsHead} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <SkeletonTableBodyRows rows={2} cols={6} />}
              {invites.map((inv) => {
                // Older invites keep only a hash of their token, so their
                // link can't be shown again.
                const hashed = inv.token?.startsWith("__HASH_v1__") ?? false;
                const manageable = inv.can_manage && !!inv.token;
                return (
                  <TableRow key={`${inv.created_at}-${inv.created_by}`}>
                    <TableCell>
                      <div className={styles.target}>
                        {inv.email ? (
                          <MailRegular className={styles.targetIcon} />
                        ) : (
                          <LinkRegular className={styles.targetIcon} />
                        )}
                        <span>
                          {inv.email ?? t("teams.shareableLink")}
                          {hashed && (
                            <Text size={200} className={styles.muted}>
                              {" "}
                              {t("teams.hashedInvite")}
                            </Text>
                          )}
                        </span>
                        {!inv.enabled && (
                          <Badge appearance="tint" color="danger" size="small">
                            {t("teams.inviteDisabled")}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className={styles.chips}>
                        <RoleBadge role={inv.role} />
                        {inv.groups.map((group) => (
                          <Badge
                            key={group.id}
                            appearance="outline"
                            size="small"
                          >
                            {group.name}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {inv.uses} / {inv.max_uses === 0 ? "∞" : inv.max_uses}
                    </TableCell>
                    <TableCell>
                      <Text size={200} className={styles.muted}>
                        {formatDate(inv.expires_at)}
                      </Text>
                    </TableCell>
                    <TableCell>
                      <Text size={200} className={styles.muted}>
                        @{inv.created_by_username}
                      </Text>
                    </TableCell>
                    <TableCell>
                      <div className={styles.actions}>
                        {iconButton(
                          hashed
                            ? t("teams.hashedInviteCopyHint")
                            : copied === inv.token
                              ? t("teams.copiedExclamation")
                              : t("teams.copyLink"),
                          copied === inv.token ? (
                            <CheckmarkRegular />
                          ) : (
                            <CopyRegular />
                          ),
                          () => copyLink(inv),
                          !inv.token || hashed,
                        )}
                        {manageable &&
                          iconButton(t("common.edit"), <EditRegular />, () =>
                            openEdit(inv),
                          )}
                        {manageable &&
                          iconButton(
                            inv.enabled
                              ? t("teams.disableInvite")
                              : t("teams.enableInvite"),
                            inv.enabled ? <PauseRegular /> : <PlayRegular />,
                            () => setEnabled(inv, !inv.enabled),
                          )}
                        {manageable &&
                          iconButton(
                            t("teams.revokeInvite"),
                            <DeleteRegular />,
                            () => revoke(inv),
                          )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
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

      <Dialog
        open={editing !== null}
        onOpenChange={(_, d) => !d.open && setEditing(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("teams.editInviteTitle")}</DialogTitle>
            <DialogContent className={styles.form}>
              <Field label={t("teams.inviteEmailOptional")}>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(_, d) =>
                    setForm((f) => ({ ...f, email: d.value }))
                  }
                />
              </Field>
              <Field label={t("teams.maxUses")} hint={t("teams.maxUsesHint")}>
                <Input
                  type="number"
                  min={0}
                  value={form.max_uses}
                  onChange={(_, d) =>
                    setForm((f) => ({ ...f, max_uses: d.value }))
                  }
                />
              </Field>
              <Field label={t("teams.inviteExpiry")}>
                <Input
                  type="datetime-local"
                  value={form.expires_at}
                  onChange={(_, d) =>
                    setForm((f) => ({ ...f, expires_at: d.value }))
                  }
                />
              </Field>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setEditing(null)}>
                {t("common.cancel")}
              </Button>
              <Button appearance="primary" disabled={saving} onClick={saveEdit}>
                {saving ? <Spinner size="tiny" /> : t("common.saveChanges")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </SettingsCard>
  );
}
