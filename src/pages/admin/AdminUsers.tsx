// Admin user management

import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Dropdown,
  Field,
  Input,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
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
  DeleteRegular,
  EditRegular,
  SearchRegular,
  SettingsRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import { useToastMessage } from "../../lib/useToastMessage";
import { CopyIdButton } from "../../components/CopyIdButton";
import { Pagination } from "../../components/Pagination";
import { useAuthStore } from "../../store/auth";
import type { UserProfile } from "../../lib/api";
import { SkeletonTableRows } from "../../components/Skeletons";

type AdminUser = UserProfile & { app_count: number; is_active: boolean };

/** Mirrors the server's own per-request cap so the UI can say why the buttons
 *  are disabled instead of letting the call fail. */
const BULK_LIMIT = 50;

const useStyles = makeStyles({
  toolbar: { display: "flex", gap: "8px", marginBottom: "16px" },
  // Let the table scroll sideways on narrow screens instead of
  // overflowing the page
  tableScroll: { overflowX: "auto" },
  pagination: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    justifyContent: "flex-end",
    marginTop: "16px",
  },
  detailGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
    "@media (max-width: 500px)": { gridTemplateColumns: "1fr" },
  },
});

export function AdminUsers() {
  const styles = useStyles();
  const qc = useQueryClient();
  const navigate = useNavigate();

  // Selection is by explicit id and survives paging, which is why the count
  // in the bar is worth showing — it can exceed what is on screen.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState("");

  const runBulk = async (action: "activate" | "deactivate" | "delete") => {
    setBulkBusy(true);
    try {
      const res = await api.adminBulkUsers([...selected], action);
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
      setSelected(new Set());
      setConfirmingBulkDelete(false);
      setBulkDeleteConfirm("");
      showMsg(
        "success",
        res.skipped.length
          ? t("admin.bulkDoneSkipped", {
              count: res.affected,
              skipped: res.skipped.map((s) => `@${s.username}`).join(", "),
            })
          : t("admin.bulkDone", { count: res.affected }),
      );
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.error"),
      );
    } finally {
      setBulkBusy(false);
    }
  };
  const { t } = useTranslation();
  const { user } = useAuthStore();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const { message, showMsg } = useToastMessage();
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [editRole, setEditRole] = useState<string | null>(null);
  const [editActive, setEditActive] = useState<boolean | null>(null);
  const [editVerified, setEditVerified] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["admin-users", page, search],
    queryFn: () => api.adminListUsers(page, 20, search),
  });

  // The caller's own row is never selectable, so it is excluded from the
  // header checkbox's idea of "all" too — otherwise it reads as indeterminate
  // forever on a page containing yourself.
  const pageIds = (data?.users ?? [])
    .map((u) => u.id)
    .filter((id) => id !== user?.id);

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const openEdit = (u: AdminUser) => {
    setEditing(u);
    setEditRole(null);
    setEditActive(null);
    setEditVerified(null);
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {};
      if (editRole !== null) updates.role = editRole;
      if (editActive !== null) updates.is_active = editActive;
      if (editVerified !== null) updates.email_verified = editVerified;

      if (Object.keys(updates).length > 0) {
        await api.adminUpdateUser(editing.id, updates);
        await qc.invalidateQueries({ queryKey: ["admin-users"] });
      }
      showMsg("success", t("admin.userUpdated"));
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

  const handleDelete = async (id: string) => {
    try {
      await api.adminDeleteUser(id);
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
      showMsg("success", t("admin.userDeleted"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("admin.deleteFailed"),
      );
    }
  };

  const totalPages = data ? Math.ceil(data.total / 20) : 1;

  return (
    <div>
      {message && (
        <MessageBar
          intent={message.type === "success" ? "success" : "error"}
          style={{ marginBottom: 12 }}
        >
          {message.text}
        </MessageBar>
      )}

      <div className={styles.toolbar}>
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t("admin.searchUsers")}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          style={{ flex: 1 }}
        />
        <Button icon={<SearchRegular />} onClick={handleSearch}>
          {t("common.search")}
        </Button>
      </div>

      {/* The bulk bar only exists once something is selected, so the
          destructive actions are never just sitting there. */}
      {selected.size > 0 && (
        <MessageBar intent={selected.size > BULK_LIMIT ? "warning" : "info"}>
          <MessageBarBody>
            {selected.size > BULK_LIMIT
              ? t("admin.bulkOverLimit", {
                  count: selected.size,
                  limit: BULK_LIMIT,
                })
              : t("admin.bulkSelected", { count: selected.size })}
          </MessageBarBody>
          <MessageBarActions>
            <Button
              size="small"
              onClick={() => setSelected(new Set())}
              disabled={bulkBusy}
            >
              {t("common.clear")}
            </Button>
            <Button
              size="small"
              disabled={bulkBusy || selected.size > BULK_LIMIT}
              onClick={() => runBulk("activate")}
            >
              {t("admin.bulkActivate")}
            </Button>
            <Button
              size="small"
              disabled={bulkBusy || selected.size > BULK_LIMIT}
              onClick={() => runBulk("deactivate")}
            >
              {t("admin.bulkDeactivate")}
            </Button>
            <Button
              size="small"
              disabled={bulkBusy || selected.size > BULK_LIMIT}
              onClick={() => setConfirmingBulkDelete(true)}
            >
              {t("admin.bulkDelete")}
            </Button>
          </MessageBarActions>
        </MessageBar>
      )}

      {/* Deleting accounts in bulk asks for the count to be typed back. The
          number is the one thing a mis-click cannot supply. */}
      <Dialog
        open={confirmingBulkDelete}
        onOpenChange={(_, d) => {
          if (!d.open) {
            setConfirmingBulkDelete(false);
            setBulkDeleteConfirm("");
          }
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("admin.bulkDeleteTitle")}</DialogTitle>
            <DialogContent>
              <Text block>
                {t("admin.bulkDeleteBody", { count: selected.size })}
              </Text>
              <Field
                label={t("admin.bulkDeleteConfirmLabel", {
                  count: selected.size,
                })}
                style={{ marginTop: 12 }}
              >
                <Input
                  value={bulkDeleteConfirm}
                  onChange={(_, d) => setBulkDeleteConfirm(d.value)}
                />
              </Field>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirmingBulkDelete(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                appearance="primary"
                style={{ background: tokens.colorPaletteRedBackground3 }}
                disabled={
                  bulkBusy || bulkDeleteConfirm.trim() !== String(selected.size)
                }
                onClick={() => runBulk("delete")}
              >
                {t("common.delete")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {isLoading ? (
        <SkeletonTableRows rows={8} cols={3} />
      ) : (
        <div className={styles.tableScroll}>
          <Table style={{ tableLayout: "auto" }}>
            <TableHeader>
              <TableRow>
                <TableHeaderCell style={{ width: 1 }}>
                  <Checkbox
                    checked={
                      pageIds.length > 0 &&
                      pageIds.every((id) => selected.has(id))
                        ? true
                        : pageIds.some((id) => selected.has(id))
                          ? "mixed"
                          : false
                    }
                    onChange={(_, d) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        // Only this page's rows — a select-all that silently
                        // reached rows you have not seen is how bulk actions
                        // become accidents.
                        for (const id of pageIds) {
                          if (d.checked) next.add(id);
                          else next.delete(id);
                        }
                        return next;
                      })
                    }
                    aria-label={t("admin.selectAllOnPage")}
                  />
                </TableHeaderCell>
                <TableHeaderCell>{t("admin.userHeader")}</TableHeaderCell>
                <TableHeaderCell>{t("admin.emailHeader")}</TableHeaderCell>
                <TableHeaderCell style={{ width: 1 }} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.users.map((u) => {
                const au = u as unknown as AdminUser;
                return (
                  <TableRow key={u.id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(u.id)}
                        disabled={u.id === user?.id}
                        onChange={(_, d) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (d.checked) next.add(u.id);
                            else next.delete(u.id);
                            return next;
                          })
                        }
                        aria-label={u.username}
                      />
                    </TableCell>
                    <TableCell>
                      <div>
                        <Text weight="semibold" block>
                          {u.display_name}
                        </Text>
                        <Text
                          size={200}
                          style={{ color: tokens.colorNeutralForeground3 }}
                        >
                          @{u.username}
                        </Text>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Text size={200}>{u.email}</Text>
                    </TableCell>
                    <TableCell>
                      <div
                        style={{
                          display: "flex",
                          gap: 4,
                          justifyContent: "flex-end",
                        }}
                      >
                        <CopyIdButton id={u.id} />
                        {/* The inline dialog covers the three toggles; the
                            detail page is where credentials, factors, tokens
                            and the account's audit log live. */}
                        <Tooltip
                          relationship="label"
                          content={t("admin.manageUser")}
                        >
                          <Button
                            size="small"
                            appearance="subtle"
                            icon={<SettingsRegular />}
                            onClick={() => navigate(`/admin/users/${u.id}`)}
                          />
                        </Tooltip>
                        <Button
                          size="small"
                          appearance="subtle"
                          icon={<EditRegular />}
                          onClick={() => openEdit(au)}
                        />
                        <Dialog>
                          <DialogTrigger disableButtonEnhancement>
                            <Button
                              size="small"
                              appearance="subtle"
                              icon={<DeleteRegular />}
                              disabled={u.id === user?.id}
                            />
                          </DialogTrigger>
                          <DialogSurface>
                            <DialogBody>
                              <DialogTitle>
                                {t("admin.deleteUserTitle")}
                              </DialogTitle>
                              <DialogContent>
                                {t("admin.deleteUserDesc", {
                                  username: u.username,
                                })}
                              </DialogContent>
                              <DialogActions>
                                <DialogTrigger>
                                  <Button>{t("common.cancel")}</Button>
                                </DialogTrigger>
                                <Button
                                  appearance="primary"
                                  style={{
                                    background:
                                      tokens.colorPaletteRedBackground3,
                                  }}
                                  onClick={() => handleDelete(u.id)}
                                >
                                  {t("common.delete")}
                                </Button>
                              </DialogActions>
                            </DialogBody>
                          </DialogSurface>
                        </Dialog>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
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

      {/* Edit user dialog */}
      <Dialog
        open={editing !== null}
        onOpenChange={(_, d) => !d.open && setEditing(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              {t("admin.editUser")} — @{editing?.username}
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
                  <Field label={t("admin.emailHeader")}>
                    <Input value={editing?.email ?? ""} readOnly />
                  </Field>
                  <Field label={t("admin.joinedHeader")}>
                    <Input
                      value={
                        editing?.created_at
                          ? new Date(
                              editing.created_at * 1000,
                            ).toLocaleDateString()
                          : "—"
                      }
                      readOnly
                    />
                  </Field>
                </div>

                <div className={styles.detailGrid}>
                  <Field label={t("admin.roleHeader")}>
                    <Dropdown
                      value={editRole ?? editing?.role ?? ""}
                      selectedOptions={[editRole ?? editing?.role ?? ""]}
                      disabled={editing?.id === user?.id}
                      onOptionSelect={(_, d) =>
                        setEditRole(d.optionValue as string)
                      }
                    >
                      <Option value="user">User</Option>
                      <Option value="admin">Admin</Option>
                    </Dropdown>
                  </Field>
                  <Field label={t("admin.appsHeader")}>
                    <Input value={String(editing?.app_count ?? 0)} readOnly />
                  </Field>
                </div>

                <Switch
                  checked={editActive ?? editing?.is_active ?? false}
                  disabled={editing?.id === user?.id}
                  onChange={(_, d) => setEditActive(d.checked)}
                  label={t("admin.accountActive")}
                />

                <Switch
                  checked={editVerified ?? editing?.email_verified ?? false}
                  onChange={(_, d) => setEditVerified(d.checked)}
                  label={t("admin.emailVerifiedToggle")}
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
