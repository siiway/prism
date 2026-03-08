// Admin: OAuth source management — configure multiple sources of the same provider kind

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
  Title3,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { AddRegular, DeleteRegular, EditRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError, type OAuthSource } from "../../lib/api";

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
    gap: "8px",
  },
  hint: {
    color: tokens.colorNeutralForeground3,
    fontSize: "12px",
    marginTop: "4px",
  },
});

const PROVIDER_OPTIONS = ["github", "google", "microsoft", "discord"];

const EMPTY_FORM = {
  slug: "",
  provider: "github",
  name: "",
  client_id: "",
  client_secret: "",
};

export function AdminConnections() {
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const [editTarget, setEditTarget] = useState<OAuthSource | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    client_id: "",
    client_secret: "",
  });
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<OAuthSource | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "oauth-sources"],
    queryFn: api.adminListOAuthSources,
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    setCreating(true);
    try {
      await api.adminCreateOAuthSource(form);
      setForm(EMPTY_FORM);
      qc.invalidateQueries({ queryKey: ["admin", "oauth-sources"] });
      qc.invalidateQueries({ queryKey: ["site"] });
    } catch (err) {
      setCreateError(
        err instanceof ApiError ? err.message : t("common.saveFailed"),
      );
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (src: OAuthSource) => {
    setEditTarget(src);
    setEditForm({ name: src.name, client_id: "", client_secret: "" });
    setEditError("");
  };

  const handleSave = async () => {
    if (!editTarget) return;
    setSaving(true);
    setEditError("");
    try {
      await api.adminUpdateOAuthSource(editTarget.id, {
        name: editForm.name || undefined,
        client_id: editForm.client_id || undefined,
        client_secret: editForm.client_secret || undefined,
      });
      qc.invalidateQueries({ queryKey: ["admin", "oauth-sources"] });
      qc.invalidateQueries({ queryKey: ["site"] });
      setEditTarget(null);
    } catch (err) {
      setEditError(
        err instanceof ApiError ? err.message : t("common.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (src: OAuthSource) => {
    await api.adminUpdateOAuthSource(src.id, { enabled: src.enabled === 0 });
    qc.invalidateQueries({ queryKey: ["admin", "oauth-sources"] });
    qc.invalidateQueries({ queryKey: ["site"] });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.adminDeleteOAuthSource(deleteTarget.id);
      qc.invalidateQueries({ queryKey: ["admin", "oauth-sources"] });
      qc.invalidateQueries({ queryKey: ["site"] });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  return (
    <div className={styles.section}>
      <Title3>{t("admin.oauthSources")}</Title3>
      <Text style={{ color: tokens.colorNeutralForeground3 }}>
        {t("admin.oauthSourcesHint")}
      </Text>

      {/* Create form */}
      <form onSubmit={handleCreate} className={styles.form}>
        <Field
          label={t("admin.oauthSlug")}
          hint={t("admin.oauthSlugHint")}
          required
        >
          <Input
            value={form.slug}
            onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
            placeholder="github-work"
          />
        </Field>

        <Field label={t("admin.oauthProvider")} required>
          <Dropdown
            value={form.provider}
            selectedOptions={[form.provider]}
            onOptionSelect={(_, d) =>
              setForm((f) => ({ ...f, provider: d.optionValue ?? "github" }))
            }
          >
            {PROVIDER_OPTIONS.map((p) => (
              <Option key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </Option>
            ))}
          </Dropdown>
        </Field>

        <Field
          label={t("admin.oauthName")}
          hint={t("admin.oauthNameHint")}
          required
        >
          <Input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="GitHub (Work)"
          />
        </Field>

        <Field label={t("admin.oauthClientId")} required>
          <Input
            value={form.client_id}
            onChange={(e) =>
              setForm((f) => ({ ...f, client_id: e.target.value }))
            }
          />
        </Field>

        <div className={styles.formFull}>
          <Field label={t("admin.oauthClientSecret")} required>
            <Input
              type="password"
              value={form.client_secret}
              onChange={(e) =>
                setForm((f) => ({ ...f, client_secret: e.target.value }))
              }
            />
          </Field>
        </div>

        {createError && (
          <div className={styles.formFull}>
            <MessageBar intent="error">{createError}</MessageBar>
          </div>
        )}

        <div className={styles.actions}>
          <Button
            appearance="primary"
            type="submit"
            icon={creating ? <Spinner size="tiny" /> : <AddRegular />}
            disabled={creating}
          >
            {t("admin.oauthAddSource")}
          </Button>
        </div>
      </form>

      {/* Source list */}
      {isLoading ? (
        <Spinner />
      ) : !data?.sources.length ? (
        <Text style={{ color: tokens.colorNeutralForeground3 }}>
          {t("admin.oauthNoSources")}
        </Text>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>{t("admin.oauthSlug")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.oauthProvider")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.oauthName")}</TableHeaderCell>
              <TableHeaderCell>{t("common.enabled")}</TableHeaderCell>
              <TableHeaderCell />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.sources.map((src) => (
              <TableRow key={src.id}>
                <TableCell>
                  <code style={{ fontFamily: "monospace" }}>{src.slug}</code>
                </TableCell>
                <TableCell>
                  <Badge color="informative">{src.provider}</Badge>
                </TableCell>
                <TableCell>{src.name}</TableCell>
                <TableCell>
                  <Switch
                    checked={src.enabled === 1}
                    onChange={() => handleToggle(src)}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    icon={<EditRegular />}
                    appearance="subtle"
                    size="small"
                    onClick={() => openEdit(src)}
                  />
                  <Button
                    icon={<DeleteRegular />}
                    appearance="subtle"
                    size="small"
                    onClick={() => setDeleteTarget(src)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Edit dialog */}
      <Dialog
        open={!!editTarget}
        onOpenChange={(_, s) => !s.open && setEditTarget(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("admin.oauthEditSource")}</DialogTitle>
            <DialogContent
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <Field label={t("admin.oauthName")}>
                <Input
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, name: e.target.value }))
                  }
                />
              </Field>
              <Field
                label={t("admin.oauthClientId")}
                hint={t("admin.oauthLeaveBlankToKeep")}
              >
                <Input
                  value={editForm.client_id}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, client_id: e.target.value }))
                  }
                />
              </Field>
              <Field
                label={t("admin.oauthClientSecret")}
                hint={t("admin.oauthLeaveBlankToKeep")}
              >
                <Input
                  type="password"
                  value={editForm.client_secret}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      client_secret: e.target.value,
                    }))
                  }
                />
              </Field>
              {editError && <MessageBar intent="error">{editError}</MessageBar>}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setEditTarget(null)}>
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

      {/* Delete confirm */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(_, s) => !s.open && setDeleteTarget(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("admin.oauthDeleteConfirm")}</DialogTitle>
            <DialogContent>
              <Text>
                {deleteTarget?.name} ({deleteTarget?.slug})
              </Text>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDeleteTarget(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                appearance="primary"
                onClick={handleDelete}
                disabled={deleting}
                icon={deleting ? <Spinner size="tiny" /> : undefined}
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
