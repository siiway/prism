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
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Title3,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { CopyRegular, DeleteRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError, type SiteInvite } from "../../lib/api";

const useStyles = makeStyles({
  section: { display: "flex", flexDirection: "column", gap: "16px" },
  form: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
    padding: "16px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "8px",
  },
  formFull: { gridColumn: "1 / -1" },
  actions: {
    gridColumn: "1 / -1",
    display: "flex",
    justifyContent: "flex-end",
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
});

function formatDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString();
}

export function AdminInvites() {
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();

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

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "invites"],
    queryFn: api.adminListInvites,
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    setCreating(true);
    try {
      const res = await api.adminCreateInvite({
        email: form.email || undefined,
        note: form.note || undefined,
        max_uses: form.max_uses ? parseInt(form.max_uses, 10) : undefined,
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

  const now = Math.floor(Date.now() / 1000);

  return (
    <div className={styles.section}>
      <Title3>{t("admin.invites")}</Title3>

      {/* Create form */}
      <form onSubmit={handleCreate} className={styles.form}>
        <Field label={t("admin.inviteEmail")} hint={t("admin.inviteEmailHint")}>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
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
            value={form.max_uses}
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
              <span className={styles.urlBox}>{newInviteUrl}</span>
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

      {/* Invite list */}
      {isLoading ? (
        <Spinner />
      ) : !data?.invites.length ? (
        <Text style={{ color: tokens.colorNeutralForeground3 }}>
          {t("admin.inviteNoInvites")}
        </Text>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>{t("admin.inviteEmail")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.inviteNote")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.inviteUsed")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.inviteCreatedBy")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.inviteExpiresIn")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.inviteLink")}</TableHeaderCell>
              <TableHeaderCell />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.invites.map((inv) => {
              const expired = inv.expires_at !== null && inv.expires_at < now;
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
                    <Button
                      icon={<CopyRegular />}
                      appearance="subtle"
                      size="small"
                      onClick={() => handleCopy(inviteUrl)}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      icon={<DeleteRegular />}
                      appearance="subtle"
                      size="small"
                      onClick={() => setRevokeTarget(inv)}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* Revoke confirm dialog */}
      <Dialog
        open={!!revokeTarget}
        onOpenChange={(_, s) => !s.open && setRevokeTarget(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("admin.inviteRevokeConfirm")}</DialogTitle>
            <DialogContent>
              {revokeTarget?.email && (
                <Text>
                  {revokeTarget.email}
                  {revokeTarget.note && ` — ${revokeTarget.note}`}
                </Text>
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
