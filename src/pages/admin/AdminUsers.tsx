// Admin user management

import {
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
  DeleteRegular,
  PersonProhibitedRegular,
  SearchRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";

const useStyles = makeStyles({
  toolbar: { display: "flex", gap: "8px", marginBottom: "16px" },
  pagination: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    justifyContent: "flex-end",
    marginTop: "16px",
  },
});

export function AdminUsers() {
  const styles = useStyles();
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

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

  const handleRoleChange = async (id: string, role: string) => {
    try {
      await api.adminUpdateUser(id, { role });
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
      showMsg("success", "Role updated");
    } catch (err) {
      showMsg("error", err instanceof ApiError ? err.message : "Update failed");
    }
  };

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    try {
      await api.adminUpdateUser(id, { is_active: !currentActive });
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
      showMsg("success", currentActive ? "User disabled" : "User enabled");
    } catch (err) {
      showMsg("error", err instanceof ApiError ? err.message : "Update failed");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.adminDeleteUser(id);
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
      showMsg("success", "User deleted");
    } catch (err) {
      showMsg("error", err instanceof ApiError ? err.message : "Delete failed");
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
          placeholder="Search users…"
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          style={{ flex: 1 }}
        />
        <Button icon={<SearchRegular />} onClick={handleSearch}>
          Search
        </Button>
      </div>

      {isLoading ? (
        <Spinner />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>User</TableHeaderCell>
              <TableHeaderCell>Email</TableHeaderCell>
              <TableHeaderCell>Role</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Apps</TableHeaderCell>
              <TableHeaderCell>Joined</TableHeaderCell>
              <TableHeaderCell>Actions</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.users.map((u) => (
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
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 4 }}
                  >
                    {u.email}
                    {u.email_verified && (
                      <Badge color="success" appearance="tint" size="small">
                        ✓
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Dropdown
                    value={u.role}
                    selectedOptions={[u.role]}
                    onOptionSelect={(_, d) =>
                      handleRoleChange(u.id, d.optionValue as string)
                    }
                    style={{ minWidth: 90 }}
                  >
                    <Option value="user">User</Option>
                    <Option value="admin">Admin</Option>
                  </Dropdown>
                </TableCell>
                <TableCell>
                  <Badge
                    color={
                      (u as unknown as { is_active: boolean }).is_active
                        ? "success"
                        : "subtle"
                    }
                    appearance="filled"
                  >
                    {(u as unknown as { is_active: boolean }).is_active
                      ? "Active"
                      : "Disabled"}
                  </Badge>
                </TableCell>
                <TableCell>
                  {(u as unknown as { app_count: number }).app_count}
                </TableCell>
                <TableCell>
                  {u.created_at
                    ? new Date(u.created_at * 1000).toLocaleDateString()
                    : "—"}
                </TableCell>
                <TableCell>
                  <div style={{ display: "flex", gap: 4 }}>
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<PersonProhibitedRegular />}
                      title={
                        (u as unknown as { is_active: boolean }).is_active
                          ? "Disable"
                          : "Enable"
                      }
                      onClick={() =>
                        handleToggleActive(
                          u.id,
                          (u as unknown as { is_active: boolean }).is_active,
                        )
                      }
                    />
                    <Dialog>
                      <DialogTrigger disableButtonEnhancement>
                        <Button
                          size="small"
                          appearance="subtle"
                          icon={<DeleteRegular />}
                        />
                      </DialogTrigger>
                      <DialogSurface>
                        <DialogBody>
                          <DialogTitle>Delete user?</DialogTitle>
                          <DialogContent>
                            Delete <strong>{u.username}</strong> and all their
                            data? This cannot be undone.
                          </DialogContent>
                          <DialogActions>
                            <DialogTrigger>
                              <Button>Cancel</Button>
                            </DialogTrigger>
                            <Button
                              appearance="primary"
                              style={{
                                background: tokens.colorPaletteRedBackground3,
                              }}
                              onClick={() => handleDelete(u.id)}
                            >
                              Delete
                            </Button>
                          </DialogActions>
                        </DialogBody>
                      </DialogSurface>
                    </Dialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
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
            Previous
          </Button>
          <Text size={200}>
            {page} / {totalPages}
          </Text>
          <Button
            size="small"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
