// Admin user management

import {
  Button,
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
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  DeleteRegular,
  EditRegular,
  SearchRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../lib/api";
import { CopyIdButton } from "../../components/CopyIdButton";
import { useAuthStore } from "../../store/auth";
import type { UserProfile } from "../../lib/api";

type AdminUser = UserProfile & { app_count: number; is_active: boolean };

const useStyles = makeStyles({
  toolbar: { display: "flex", gap: "8px", marginBottom: "16px" },
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
  const { t } = useTranslation();
  const { user } = useAuthStore();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [editRole, setEditRole] = useState<string | null>(null);
  const [editActive, setEditActive] = useState<boolean | null>(null);
  const [editVerified, setEditVerified] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users", page, search],
    queryFn: () => api.adminListUsers(page, 20, search),
  });

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

      {isLoading ? (
        <Spinner />
      ) : (
        <Table style={{ tableLayout: "auto" }}>
          <TableHeader>
            <TableRow>
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
                                  background: tokens.colorPaletteRedBackground3,
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
      )}

      {totalPages > 1 && (
        <div className={styles.pagination}>
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
