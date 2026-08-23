// Admin app moderation

import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Image,
  Input,
  MessageBar,
  Option,
  Spinner,
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
import {
  ArrowSwapRegular,
  EditRegular,
  OpenRegular,
  PlugDisconnectedRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import { useToastMessage } from "../../lib/useToastMessage";
import { CopyIdButton } from "../../components/CopyIdButton";
import { Pagination } from "../../components/Pagination";
import { SkeletonTableRows } from "../../components/Skeletons";

const useStyles = makeStyles({
  // Let the table scroll sideways on narrow screens instead of
  // overflowing the page
  tableScroll: { overflowX: "auto" },
  detailGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
    "@media (max-width: 500px)": { gridTemplateColumns: "1fr" },
  },
});

export function AdminApps() {
  const styles = useStyles();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const { message, showMsg } = useToastMessage();

  // Moving an app between owners and cutting one off entirely are both
  // incident responses rather than edits, so they live outside the edit
  // dialog with their own confirmations.
  const [transferring, setTransferring] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [transferTarget, setTransferTarget] = useState("");
  const [transferKind, setTransferKind] = useState<"user" | "team">("user");
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [revokeDeactivate, setRevokeDeactivate] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleTransfer = async () => {
    if (!transferring || !transferTarget.trim()) return;
    setBusy(true);
    try {
      const res = await api.adminTransferApp(
        transferring.id,
        transferKind === "team"
          ? { team_id: transferTarget.trim() }
          : { owner_id: transferTarget.trim() },
      );
      await qc.invalidateQueries({ queryKey: ["admin-apps"] });
      setTransferring(null);
      setTransferTarget("");
      showMsg("success", res.message);
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.error"),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    if (!revoking) return;
    setBusy(true);
    try {
      const res = await api.adminRevokeApp(revoking.id, revokeDeactivate);
      await qc.invalidateQueries({ queryKey: ["admin-apps"] });
      setRevoking(null);
      setRevokeDeactivate(false);
      showMsg(
        "success",
        t("admin.revokeAppDone", {
          tokens: res.tokens_revoked,
          consents: res.consents_revoked,
        }),
      );
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.error"),
      );
    } finally {
      setBusy(false);
    }
  };

  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [editOfficial, setEditOfficial] = useState<boolean | null>(null);
  const [editFirstParty, setEditFirstParty] = useState<boolean | null>(null);
  const [editActive, setEditActive] = useState<boolean | null>(null);
  const [editVerified, setEditVerified] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["admin-apps", page],
    queryFn: () => api.adminListApps(page),
  });

  const openEdit = (app: Record<string, unknown>) => {
    setEditing(app);
    setEditOfficial(null);
    setEditFirstParty(null);
    setEditActive(null);
    setEditVerified(null);
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {};
      if (editOfficial !== null) updates.is_official = editOfficial;
      if (editFirstParty !== null) updates.is_first_party = editFirstParty;
      if (editActive !== null) updates.is_active = editActive;
      if (editVerified !== null) updates.is_verified = editVerified;

      if (Object.keys(updates).length > 0) {
        await api.adminUpdateApp(editing.id as string, updates);
        await qc.invalidateQueries({ queryKey: ["admin-apps"] });
      }
      showMsg("success", t("admin.appUpdated"));
      setEditing(null);
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.error"),
      );
    } finally {
      setSaving(false);
    }
  };

  const totalPages = data ? Math.ceil(data.total / 20) : 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {message && (
        <MessageBar intent={message.type === "success" ? "success" : "error"}>
          {message.text}
        </MessageBar>
      )}

      {isLoading ? (
        <SkeletonTableRows rows={8} cols={4} />
      ) : (
        <div className={styles.tableScroll}>
          <Table style={{ tableLayout: "auto" }}>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>{t("admin.appHeader")}</TableHeaderCell>
                <TableHeaderCell>{t("admin.ownerHeader")}</TableHeaderCell>
                <TableHeaderCell>{t("admin.statusHeader")}</TableHeaderCell>
                <TableHeaderCell style={{ width: 1 }} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.apps.map((app) => (
                <TableRow key={app.id}>
                  <TableCell>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      {app.icon_url && (
                        <Image
                          src={app.icon_url}
                          alt={app.name}
                          shape="rounded"
                          fit="cover"
                          width={24}
                          height={24}
                        />
                      )}
                      <div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <Text weight="semibold">{app.name}</Text>
                          {!!app.is_official && (
                            <Badge color="brand" appearance="tint" size="small">
                              {t("admin.officialHeader")}
                            </Badge>
                          )}
                          {!!app.is_first_party && (
                            <Badge
                              color="informative"
                              appearance="tint"
                              size="small"
                            >
                              {t("admin.firstPartyHeader")}
                            </Badge>
                          )}
                        </div>
                        <Text
                          size={200}
                          style={{ color: tokens.colorNeutralForeground3 }}
                        >
                          {app.description?.slice(0, 40)}
                        </Text>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {app.team_id ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        {app.team_avatar_url ? (
                          <Image
                            src={app.team_avatar_url}
                            alt=""
                            shape="rounded"
                            fit="cover"
                            width={16}
                            height={16}
                          />
                        ) : null}
                        <Text size={200} weight="semibold">
                          {app.team_name ?? t("admin.teamHeader")}
                        </Text>
                        <Badge color="brand" appearance="tint" size="small">
                          {t("admin.teamHeader")}
                        </Badge>
                      </div>
                    ) : (
                      <Text size={200}>
                        {app.owner_username ? `@${app.owner_username}` : "—"}
                      </Text>
                    )}
                  </TableCell>
                  <TableCell>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      <Badge
                        color={app.is_active ? "success" : "subtle"}
                        appearance="filled"
                        size="small"
                      >
                        {app.is_active
                          ? t("admin.activeStatus")
                          : t("admin.disabledStatus")}
                      </Badge>
                      <Badge
                        color={app.is_verified ? "success" : "subtle"}
                        appearance="filled"
                        size="small"
                      >
                        {app.is_verified
                          ? t("admin.verifiedBadge")
                          : t("admin.unverifiedBadge")}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div
                      style={{ display: "flex", justifyContent: "flex-end" }}
                    >
                      <CopyIdButton id={app.id} />
                      {/* Admins have full access to every app through the
                          ordinary app API, so the normal detail page is the
                          editor — this dialog only covers moderation flags. */}
                      <Tooltip
                        relationship="label"
                        content={t("admin.openApp")}
                      >
                        <Button
                          size="small"
                          appearance="subtle"
                          icon={<OpenRegular />}
                          onClick={() => navigate(`/apps/${app.id}`)}
                        />
                      </Tooltip>
                      <Tooltip
                        relationship="label"
                        content={t("admin.transferApp")}
                      >
                        <Button
                          size="small"
                          appearance="subtle"
                          icon={<ArrowSwapRegular />}
                          onClick={() =>
                            setTransferring({ id: app.id, name: app.name })
                          }
                        />
                      </Tooltip>
                      <Tooltip
                        relationship="label"
                        content={t("admin.revokeAppTooltip")}
                      >
                        <Button
                          size="small"
                          appearance="subtle"
                          icon={<PlugDisconnectedRegular />}
                          onClick={() =>
                            setRevoking({ id: app.id, name: app.name })
                          }
                        />
                      </Tooltip>
                      <Button
                        size="small"
                        appearance="subtle"
                        icon={<EditRegular />}
                        onClick={() =>
                          openEdit(app as unknown as Record<string, unknown>)
                        }
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 && (
        <Pagination
          page={page}
          pageCount={totalPages}
          onChange={setPage}
          disabled={isLoading || isFetching}
        />
      )}

      {/* Edit app dialog */}
      <Dialog
        open={editing !== null}
        onOpenChange={(_, d) => !d.open && setEditing(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              {t("admin.editApp")} — {editing?.name as string}
            </DialogTitle>
            <DialogContent>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  paddingTop: 8,
                }}
              >
                <div className={styles.detailGrid}>
                  <Field label={t("admin.clientIdHeader")}>
                    <Input
                      value={(editing?.client_id as string) ?? ""}
                      readOnly
                      style={{ fontFamily: "monospace", fontSize: 12 }}
                    />
                  </Field>
                  <Field label={t("admin.ownerHeader")}>
                    <Input
                      value={
                        editing?.team_id
                          ? `${(editing.team_name as string) ?? ""} (${t("admin.teamHeader")})`
                          : editing?.owner_username
                            ? `@${editing.owner_username}`
                            : "—"
                      }
                      readOnly
                    />
                  </Field>
                </div>

                <div className={styles.detailGrid}>
                  <Field label={t("admin.createdHeader")}>
                    <Input
                      value={
                        editing?.created_at
                          ? new Date(
                              (editing.created_at as number) * 1000,
                            ).toLocaleDateString()
                          : "—"
                      }
                      readOnly
                    />
                  </Field>
                </div>

                <Switch
                  checked={
                    editActive ?? (editing?.is_active as boolean) ?? false
                  }
                  onChange={(_, d) => setEditActive(d.checked)}
                  label={t("admin.activeToggle")}
                />

                <Switch
                  checked={
                    editVerified ?? (editing?.is_verified as boolean) ?? false
                  }
                  onChange={(_, d) => setEditVerified(d.checked)}
                  label={t("admin.verifiedToggle")}
                />

                <Switch
                  checked={
                    editOfficial ?? (editing?.is_official as boolean) ?? false
                  }
                  onChange={(_, d) => setEditOfficial(d.checked)}
                  label={t("admin.officialToggle")}
                />

                <Switch
                  checked={
                    editFirstParty ??
                    (editing?.is_first_party as boolean) ??
                    false
                  }
                  onChange={(_, d) => setEditFirstParty(d.checked)}
                  label={t("admin.firstPartyToggle")}
                />
              </div>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setEditing(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                appearance="primary"
                onClick={handleSave}
                disabled={saving}
                icon={saving ? <Spinner size="tiny" /> : undefined}
              >
                {t("common.save")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Transfer. The client_id and secret stay put — the whole point is to
          change who owns the app without breaking what already uses it. */}
      <Dialog
        open={transferring !== null}
        onOpenChange={(_, d) => !d.open && setTransferring(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              {t("admin.transferAppTitle", { name: transferring?.name ?? "" })}
            </DialogTitle>
            <DialogContent>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  paddingTop: 8,
                }}
              >
                <MessageBar intent="info">
                  {t("admin.transferAppHint")}
                </MessageBar>
                <Field label={t("admin.transferTargetKind")}>
                  <Dropdown
                    value={
                      transferKind === "user"
                        ? t("admin.transferToUser")
                        : t("admin.transferToTeam")
                    }
                    selectedOptions={[transferKind]}
                    onOptionSelect={(_, d) =>
                      setTransferKind(
                        (d.optionValue as "user" | "team") ?? "user",
                      )
                    }
                  >
                    <Option value="user" text={t("admin.transferToUser")}>
                      {t("admin.transferToUser")}
                    </Option>
                    <Option value="team" text={t("admin.transferToTeam")}>
                      {t("admin.transferToTeam")}
                    </Option>
                  </Dropdown>
                </Field>
                <Field
                  label={
                    transferKind === "user"
                      ? t("admin.transferUserLabel")
                      : t("admin.transferTeamLabel")
                  }
                >
                  <Input
                    value={transferTarget}
                    onChange={(_, d) => setTransferTarget(d.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleTransfer()}
                  />
                </Field>
              </div>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setTransferring(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                appearance="primary"
                disabled={!transferTarget.trim() || busy}
                onClick={handleTransfer}
              >
                {t("admin.transferApp")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Cut the app off. Consents go with the tokens, or every user walks
          back through the consent screen without being asked again. */}
      <Dialog
        open={revoking !== null}
        onOpenChange={(_, d) => !d.open && setRevoking(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              {t("admin.revokeAppTitle", { name: revoking?.name ?? "" })}
            </DialogTitle>
            <DialogContent>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  paddingTop: 8,
                }}
              >
                <Text block>{t("admin.revokeAppBody")}</Text>
                <Switch
                  checked={revokeDeactivate}
                  onChange={(_, d) => setRevokeDeactivate(d.checked)}
                  label={t("admin.revokeAppDeactivate")}
                />
              </div>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setRevoking(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                appearance="primary"
                style={{ background: tokens.colorPaletteRedBackground3 }}
                disabled={busy}
                onClick={handleRevoke}
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
