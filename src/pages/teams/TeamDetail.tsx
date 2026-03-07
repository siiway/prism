// Team detail page — members, apps, settings tabs

import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MessageBar,
  Select,
  Spinner,
  Tab,
  TabList,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Title2,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  AppsRegular,
  DeleteRegular,
  GlobeRegular,
  MoreHorizontalRegular,
  PeopleRegular,
  SettingsRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type OAuthApp } from "../../lib/api";
import { useAuthStore } from "../../store/auth";

const useStyles = makeStyles({
  header: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    marginBottom: "24px",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: "16px",
    marginTop: "16px",
  },
  appCard: {
    cursor: "pointer",
    transition: "box-shadow 0.15s",
    ":hover": { boxShadow: tokens.shadow8 },
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  danger: {
    border: `1px solid ${tokens.colorPaletteRedBorder2}`,
    borderRadius: "8px",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
});

const ROLE_COLORS: Record<string, "brand" | "success" | "subtle"> = {
  owner: "brand",
  admin: "success",
  member: "subtle",
};

type Tab = "members" | "apps" | "settings";

export function TeamDetail() {
  const styles = useStyles();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user: me } = useAuthStore();

  const [tab, setTab] = useState<Tab>("members");
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["team", id],
    queryFn: () => api.getTeam(id!),
    enabled: !!id,
  });

  const { data: appsData, isLoading: appsLoading } = useQuery({
    queryKey: ["team-apps", id],
    queryFn: () => api.listTeamApps(id!),
    enabled: !!id && tab === "apps",
  });

  const team = data?.team;
  const members = data?.members ?? [];
  const myRole = team?.my_role ?? "member";
  const canManage = myRole === "owner" || myRole === "admin";
  const isOwner = myRole === "owner";

  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  // ── Add member ──────────────────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ username: "", role: "member" });
  const [adding, setAdding] = useState(false);

  const handleAddMember = async () => {
    if (!addForm.username.trim() || !id) return;
    setAdding(true);
    try {
      await api.addTeamMember(id, {
        username: addForm.username.trim(),
        role: addForm.role,
      });
      await qc.invalidateQueries({ queryKey: ["team", id] });
      setAddOpen(false);
      setAddForm({ username: "", role: "member" });
      showMsg("success", "Member added");
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : "Failed to add member",
      );
    } finally {
      setAdding(false);
    }
  };

  const handleChangeRole = async (userId: string, role: string) => {
    if (!id) return;
    try {
      await api.changeTeamMemberRole(id, userId, role);
      await qc.invalidateQueries({ queryKey: ["team", id] });
      showMsg("success", "Role updated");
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : "Failed to update role",
      );
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!id) return;
    try {
      await api.removeTeamMember(id, userId);
      await qc.invalidateQueries({ queryKey: ["team", id] });
      showMsg("success", "Member removed");
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : "Failed to remove member",
      );
    }
  };

  const handleTransferOwnership = async (userId: string) => {
    if (!id) return;
    try {
      await api.transferOwnership(id, userId);
      await qc.invalidateQueries({ queryKey: ["team", id] });
      showMsg("success", "Ownership transferred");
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : "Failed to transfer ownership",
      );
    }
  };

  // ── Create app ──────────────────────────────────────────────────────────────
  const [appOpen, setAppOpen] = useState(false);
  const [appForm, setAppForm] = useState({
    name: "",
    description: "",
    website_url: "",
    redirect_uris: "",
  });
  const [creatingApp, setCreatingApp] = useState(false);

  const updateApp =
    (k: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setAppForm((f) => ({ ...f, [k]: e.target.value }));

  const handleCreateApp = async () => {
    if (!id || !appForm.name.trim()) return;
    const uris = appForm.redirect_uris
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!uris.length) {
      showMsg("error", "At least one redirect URI required");
      return;
    }
    setCreatingApp(true);
    try {
      const res = await api.createTeamApp(id, {
        name: appForm.name.trim(),
        description: appForm.description || undefined,
        website_url: appForm.website_url || undefined,
        redirect_uris: uris,
      });
      await qc.invalidateQueries({ queryKey: ["team-apps", id] });
      setAppOpen(false);
      setAppForm({
        name: "",
        description: "",
        website_url: "",
        redirect_uris: "",
      });
      navigate(`/apps/${res.app.id}`);
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : "Failed to create app",
      );
    } finally {
      setCreatingApp(false);
    }
  };

  // ── Settings ────────────────────────────────────────────────────────────────
  const [settingsForm, setSettingsForm] = useState({
    name: "",
    description: "",
    avatar_url: "",
  });
  const [saving, setSaving] = useState(false);

  const updateSettings =
    (k: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setSettingsForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSaveSettings = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await api.updateTeam(id, {
        name: settingsForm.name || undefined,
        description: settingsForm.description || undefined,
        avatar_url: settingsForm.avatar_url || undefined,
      });
      await qc.invalidateQueries({ queryKey: ["team", id] });
      showMsg("success", "Team updated");
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : "Failed to update team",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTeam = async () => {
    if (!id) return;
    try {
      await api.deleteTeam(id);
      await qc.invalidateQueries({ queryKey: ["teams"] });
      navigate("/teams");
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : "Failed to delete team",
      );
    }
  };

  if (isLoading) return <Spinner />;
  if (!team) return <Text>Team not found</Text>;

  return (
    <div>
      {message && (
        <MessageBar
          intent={message.type === "success" ? "success" : "error"}
          style={{ marginBottom: 16 }}
        >
          {message.text}
        </MessageBar>
      )}

      {/* Header */}
      <div className={styles.header}>
        {team.avatar_url ? (
          <Avatar image={{ src: team.avatar_url }} name={team.name} size={48} />
        ) : (
          <Avatar name={team.name} size={48} />
        )}
        <div>
          <Title2>{team.name}</Title2>
          {team.description && (
            <Text style={{ color: tokens.colorNeutralForeground3 }}>
              {team.description}
            </Text>
          )}
        </div>
        <Badge color={ROLE_COLORS[myRole] ?? "subtle"} appearance="filled">
          {myRole}
        </Badge>
      </div>

      <TabList
        selectedValue={tab}
        onTabSelect={(_, d) => {
          setTab(d.value as Tab);
          if (d.value === "settings") {
            setSettingsForm({
              name: team.name,
              description: team.description,
              avatar_url: team.avatar_url ?? "",
            });
          }
        }}
        style={{ marginBottom: 24 }}
      >
        <Tab value="members" icon={<PeopleRegular />}>
          Members ({members.length})
        </Tab>
        <Tab value="apps" icon={<AppsRegular />}>
          Apps
        </Tab>
        {canManage && (
          <Tab value="settings" icon={<SettingsRegular />}>
            Settings
          </Tab>
        )}
      </TabList>

      {/* Members tab */}
      {tab === "members" && (
        <div>
          {canManage && (
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginBottom: 12,
              }}
            >
              <Dialog
                open={addOpen}
                onOpenChange={(_, d) => setAddOpen(d.open)}
              >
                <DialogTrigger disableButtonEnhancement>
                  <Button
                    appearance="primary"
                    icon={<AddRegular />}
                    size="small"
                  >
                    Add member
                  </Button>
                </DialogTrigger>
                <DialogSurface>
                  <DialogBody>
                    <DialogTitle>Add Team Member</DialogTitle>
                    <DialogContent>
                      <div className={styles.form}>
                        <Field label="Username" required>
                          <Input
                            value={addForm.username}
                            onChange={(e) =>
                              setAddForm((f) => ({
                                ...f,
                                username: e.target.value,
                              }))
                            }
                            placeholder="username"
                          />
                        </Field>
                        <Field label="Role">
                          <Select
                            value={addForm.role}
                            onChange={(_, d) =>
                              setAddForm((f) => ({ ...f, role: d.value }))
                            }
                          >
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                          </Select>
                        </Field>
                      </div>
                    </DialogContent>
                    <DialogActions>
                      <DialogTrigger>
                        <Button>Cancel</Button>
                      </DialogTrigger>
                      <Button
                        appearance="primary"
                        onClick={handleAddMember}
                        disabled={adding}
                      >
                        {adding ? <Spinner size="tiny" /> : "Add"}
                      </Button>
                    </DialogActions>
                  </DialogBody>
                </DialogSurface>
              </Dialog>
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Member</TableHeaderCell>
                <TableHeaderCell>Role</TableHeaderCell>
                <TableHeaderCell>Joined</TableHeaderCell>
                {canManage && <TableHeaderCell />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.user_id}>
                  <TableCell>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <Avatar
                        name={m.display_name}
                        image={m.avatar_url ? { src: m.avatar_url } : undefined}
                        size={24}
                      />
                      <div>
                        <Text weight="semibold" block>
                          {m.display_name}
                        </Text>
                        <Text
                          size={200}
                          style={{ color: tokens.colorNeutralForeground3 }}
                        >
                          @{m.username}
                        </Text>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      color={ROLE_COLORS[m.role] ?? "subtle"}
                      appearance="filled"
                      size="small"
                    >
                      {m.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {new Date(m.joined_at * 1000).toLocaleDateString()}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      {m.user_id !== me?.id && m.role !== "owner" && (
                        <Menu>
                          <MenuTrigger disableButtonEnhancement>
                            <Button
                              appearance="subtle"
                              icon={<MoreHorizontalRegular />}
                              size="small"
                            />
                          </MenuTrigger>
                          <MenuPopover>
                            <MenuList>
                              {isOwner && m.role === "member" && (
                                <MenuItem
                                  onClick={() =>
                                    handleChangeRole(m.user_id, "admin")
                                  }
                                >
                                  Promote to admin
                                </MenuItem>
                              )}
                              {isOwner && m.role === "admin" && (
                                <MenuItem
                                  onClick={() =>
                                    handleChangeRole(m.user_id, "member")
                                  }
                                >
                                  Demote to member
                                </MenuItem>
                              )}
                              {isOwner && (
                                <MenuItem
                                  onClick={() =>
                                    handleTransferOwnership(m.user_id)
                                  }
                                >
                                  Transfer ownership
                                </MenuItem>
                              )}
                              <MenuItem
                                icon={<DeleteRegular />}
                                onClick={() => handleRemoveMember(m.user_id)}
                                style={{
                                  color: tokens.colorPaletteRedForeground1,
                                }}
                              >
                                Remove
                              </MenuItem>
                            </MenuList>
                          </MenuPopover>
                        </Menu>
                      )}
                      {m.user_id === me?.id && m.role !== "owner" && (
                        <Button
                          appearance="subtle"
                          size="small"
                          onClick={() => handleRemoveMember(m.user_id)}
                        >
                          Leave
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Apps tab */}
      {tab === "apps" && (
        <div>
          {canManage && (
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginBottom: 12,
              }}
            >
              <Dialog
                open={appOpen}
                onOpenChange={(_, d) => setAppOpen(d.open)}
              >
                <DialogTrigger disableButtonEnhancement>
                  <Button
                    appearance="primary"
                    icon={<AddRegular />}
                    size="small"
                  >
                    New app
                  </Button>
                </DialogTrigger>
                <DialogSurface>
                  <DialogBody>
                    <DialogTitle>Create Team App</DialogTitle>
                    <DialogContent>
                      <div className={styles.form}>
                        <Field label="App name" required>
                          <Input
                            value={appForm.name}
                            onChange={updateApp("name")}
                            placeholder="My App"
                          />
                        </Field>
                        <Field label="Description">
                          <Input
                            value={appForm.description}
                            onChange={updateApp("description")}
                          />
                        </Field>
                        <Field label="Website URL">
                          <Input
                            value={appForm.website_url}
                            onChange={updateApp("website_url")}
                            placeholder="https://example.com"
                          />
                        </Field>
                        <Field
                          label="Redirect URIs"
                          hint="One per line"
                          required
                        >
                          <Textarea
                            value={appForm.redirect_uris}
                            onChange={updateApp("redirect_uris")}
                            rows={3}
                            placeholder="https://example.com/callback"
                          />
                        </Field>
                      </div>
                    </DialogContent>
                    <DialogActions>
                      <DialogTrigger>
                        <Button>Cancel</Button>
                      </DialogTrigger>
                      <Button
                        appearance="primary"
                        onClick={handleCreateApp}
                        disabled={creatingApp}
                      >
                        {creatingApp ? <Spinner size="tiny" /> : "Create"}
                      </Button>
                    </DialogActions>
                  </DialogBody>
                </DialogSurface>
              </Dialog>
            </div>
          )}

          {appsLoading && <Spinner />}
          {!appsLoading && appsData?.apps.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <GlobeRegular
                fontSize={40}
                style={{ color: tokens.colorNeutralForeground3 }}
              />
              <Text
                block
                style={{ marginTop: 12, color: tokens.colorNeutralForeground3 }}
              >
                No apps in this team yet.
              </Text>
            </div>
          )}

          <div className={styles.grid}>
            {appsData?.apps.map((app: OAuthApp) => (
              <Card
                key={app.id}
                className={styles.appCard}
                onClick={() => navigate(`/apps/${app.id}`)}
              >
                <CardHeader
                  image={
                    app.icon_url ? (
                      <img
                        src={app.icon_url}
                        alt={app.name}
                        width={32}
                        height={32}
                        style={{ borderRadius: 4 }}
                      />
                    ) : (
                      <GlobeRegular fontSize={32} />
                    )
                  }
                  header={<Text weight="semibold">{app.name}</Text>}
                  description={app.description || app.client_id}
                />
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Settings tab */}
      {tab === "settings" && canManage && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
            maxWidth: 480,
          }}
        >
          <div className={styles.form}>
            <Field label="Team name">
              <Input
                value={settingsForm.name}
                onChange={updateSettings("name")}
              />
            </Field>
            <Field label="Description">
              <Textarea
                value={settingsForm.description}
                onChange={updateSettings("description")}
                rows={3}
              />
            </Field>
            <Field label="Avatar URL">
              <Input
                value={settingsForm.avatar_url}
                onChange={updateSettings("avatar_url")}
                placeholder="https://example.com/logo.png"
              />
            </Field>
            <div>
              <Button
                appearance="primary"
                onClick={handleSaveSettings}
                disabled={saving}
              >
                {saving ? <Spinner size="tiny" /> : "Save changes"}
              </Button>
            </div>
          </div>

          {isOwner && (
            <div className={styles.danger}>
              <Text
                weight="semibold"
                style={{ color: tokens.colorPaletteRedForeground1 }}
              >
                Danger zone
              </Text>
              <Text
                size={200}
                style={{ color: tokens.colorNeutralForeground3 }}
              >
                Deleting this team will disown all team apps (they will return
                to their creators). This action cannot be undone.
              </Text>
              <div>
                <Button
                  appearance="outline"
                  icon={<DeleteRegular />}
                  style={{
                    color: tokens.colorPaletteRedForeground1,
                    borderColor: tokens.colorPaletteRedBorder2,
                  }}
                  onClick={handleDeleteTeam}
                >
                  Delete team
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
