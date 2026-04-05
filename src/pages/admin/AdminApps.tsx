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
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { EditRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError, proxyImageUrl } from "../../lib/api";
import { CopyIdButton } from "../../components/CopyIdButton";

const useStyles = makeStyles({
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
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [editOfficial, setEditOfficial] = useState<boolean | null>(null);
  const [editFirstParty, setEditFirstParty] = useState<boolean | null>(null);
  const [editActive, setEditActive] = useState<boolean | null>(null);
  const [editVerified, setEditVerified] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-apps", page],
    queryFn: () => api.adminListApps(page),
  });

  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

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
        <Spinner />
      ) : (
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
                      <img
                        src={proxyImageUrl(app.icon_url)}
                        alt={app.name}
                        width={24}
                        height={24}
                        style={{ borderRadius: 4 }}
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
                  <Text size={200}>@{app.owner_username}</Text>
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
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <CopyIdButton id={app.id} />
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
      )}

      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            justifyContent: "flex-end",
          }}
        >
          <Button
            size="small"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("common.previous")}
          </Button>
          <Text size={200}>
            {t("common.pageOf", { page, total: totalPages })}
          </Text>
          <Button
            size="small"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("common.next")}
          </Button>
        </div>
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
                        editing?.owner_username
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
    </div>
  );
}
