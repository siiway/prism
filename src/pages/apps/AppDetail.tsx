// OAuth App detail / settings page

import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  MessageBar,
  Select,
  Spinner,
  Tab,
  TabList,
  Text,
  Textarea,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowLeftRegular,
  CopyRegular,
  DeleteRegular,
  PeopleRegular,
  ShieldRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../lib/api";
import { ImageUrlInput } from "../../components/ImageUrlInput";

const useStyles = makeStyles({
  header: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginBottom: "24px",
  },
  card: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "8px",
    padding: "24px",
    background: tokens.colorNeutralBackground2,
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  form: { display: "flex", flexDirection: "column", gap: "12px" },
  secretRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 12px",
    background: tokens.colorNeutralBackground3,
    borderRadius: "4px",
    fontFamily: "monospace",
    fontSize: tokens.fontSizeBase200,
  },
  scopeGrid: { display: "flex", flexWrap: "wrap", gap: "8px" },
});

const SCOPES = [
  "openid",
  "profile",
  "profile:write",
  "email",
  "apps:read",
  "apps:write",
  "teams:read",
  "teams:write",
  "teams:create",
  "teams:delete",
  "domains:read",
  "domains:write",
  "admin:users:read",
  "admin:users:write",
  "admin:users:delete",
  "admin:config:read",
  "admin:config:write",
  "admin:invites:read",
  "admin:invites:create",
  "admin:invites:delete",
  "offline_access",
];

export function AppDetail() {
  const styles = useStyles();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();

  const { data, isLoading } = useQuery({
    queryKey: ["app", id],
    queryFn: () => api.getApp(id!),
  });
  const app = data?.app;

  const { data: teamsData } = useQuery({
    queryKey: ["teams"],
    queryFn: api.listTeams,
  });

  const [tab, setTab] = useState("settings");
  const [form, setForm] = useState<{
    name: string;
    description: string;
    icon_url: string;
    website_url: string;
    redirect_uris: string;
    allowed_scopes: string[];
    is_public: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [secretRotating, setSecretRotating] = useState(false);
  const [newSecret, setNewSecret] = useState("");
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [copied, setCopied] = useState<string>("");

  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(""), 2000);
  };

  const initForm = () => {
    if (!app || form) return;
    setForm({
      name: app.name,
      description: app.description,
      icon_url: app.icon_url ?? "",
      website_url: app.website_url ?? "",
      redirect_uris: app.redirect_uris.join("\n"),
      allowed_scopes: app.allowed_scopes,
      is_public: app.is_public,
    });
  };

  const handleSave = async () => {
    if (!form || !id) return;
    setSaving(true);
    try {
      await api.updateApp(id, {
        name: form.name,
        description: form.description,
        icon_url: form.icon_url || undefined,
        website_url: form.website_url || undefined,
        redirect_uris: form.redirect_uris
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        allowed_scopes: form.allowed_scopes,
        is_public: form.is_public,
      });
      await qc.invalidateQueries({ queryKey: ["app", id] });
      showMsg("success", t("apps.appUpdated"));
    } catch (err) {
      showMsg("error", err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  };

  const handleRotateSecret = async () => {
    if (!id) return;
    setSecretRotating(true);
    try {
      const res = await api.rotateSecret(id);
      setNewSecret(res.client_secret);
      showMsg("success", t("apps.secretRotated"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : "Rotation failed",
      );
    } finally {
      setSecretRotating(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      await api.deleteApp(id);
      await qc.invalidateQueries({ queryKey: ["apps"] });
      navigate("/apps");
    } catch (err) {
      showMsg("error", err instanceof ApiError ? err.message : "Delete failed");
    }
  };

  // ── Team migration ──────────────────────────────────────────────────────────
  const [moveOpen, setMoveOpen] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [moving, setMoving] = useState(false);

  // Teams where the user is admin or owner
  const manageableTeams = (teamsData?.teams ?? []).filter(
    (t) => t.role === "owner" || t.role === "admin",
  );

  const handleMoveToTeam = async () => {
    if (!id || !selectedTeamId) return;
    setMoving(true);
    try {
      await api.transferAppToTeam(selectedTeamId, id);
      await qc.invalidateQueries({ queryKey: ["app", id] });
      await qc.invalidateQueries({ queryKey: ["apps"] });
      setMoveOpen(false);
      setSelectedTeamId("");
      showMsg("success", t("apps.appMovedToTeam"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("apps.failedMoveApp"),
      );
    } finally {
      setMoving(false);
    }
  };

  const handleRemoveFromTeam = async () => {
    if (!id || !app?.team_id) return;
    try {
      await api.removeAppFromTeam(app.team_id, id);
      await qc.invalidateQueries({ queryKey: ["app", id] });
      await qc.invalidateQueries({ queryKey: ["apps"] });
      showMsg("success", t("apps.appRemovedFromTeam"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("apps.failedRemoveFromTeam"),
      );
    }
  };

  if (isLoading) return <Spinner />;
  if (!app) return <Text>{t("apps.appNotFound")}</Text>;

  if (!form) initForm();

  return (
    <div>
      <div className={styles.header}>
        <Button
          appearance="subtle"
          icon={<ArrowLeftRegular />}
          onClick={() =>
            app.team_id ? navigate(`/teams/${app.team_id}`) : navigate("/apps")
          }
        />
        <Title2>{app.name}</Title2>
        {app.is_verified && (
          <Badge color="success" appearance="filled">
            <ShieldRegular /> {t("apps.verified")}
          </Badge>
        )}
        {!app.is_active && (
          <Badge color="subtle" appearance="filled">
            {t("apps.disabled")}
          </Badge>
        )}
      </div>

      {message && (
        <MessageBar
          intent={message.type === "success" ? "success" : "error"}
          style={{ marginBottom: 16 }}
        >
          {message.text}
        </MessageBar>
      )}

      <TabList
        selectedValue={tab}
        onTabSelect={(_, d) => setTab(d.value as string)}
        style={{ marginBottom: 24 }}
      >
        <Tab value="settings">{t("apps.settingsTab")}</Tab>
        <Tab value="credentials">{t("apps.credentialsTab")}</Tab>
        <Tab value="danger">{t("apps.dangerTab")}</Tab>
      </TabList>

      {tab === "settings" && form && (
        <div className={styles.card}>
          <div className={styles.form}>
            <Field label={t("apps.appNameField")}>
              <Input
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f!, name: e.target.value }))
                }
              />
            </Field>
            <Field label={t("apps.description")}>
              <Input
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f!, description: e.target.value }))
                }
              />
            </Field>
            <ImageUrlInput
              label={t("apps.iconUrl")}
              value={form.icon_url}
              onChange={(v) => setForm((f) => ({ ...f!, icon_url: v }))}
            />
            <Field label={t("apps.websiteUrl")}>
              <Input
                value={form.website_url}
                onChange={(e) =>
                  setForm((f) => ({ ...f!, website_url: e.target.value }))
                }
              />
            </Field>
            <Field
              label={t("apps.redirectUris")}
              hint={t("apps.redirectUrisHint")}
            >
              <Textarea
                value={form.redirect_uris}
                onChange={(e) =>
                  setForm((f) => ({ ...f!, redirect_uris: e.target.value }))
                }
                rows={4}
              />
            </Field>
            <Field label={t("apps.allowedScopes")}>
              <div className={styles.scopeGrid}>
                {SCOPES.map((s) => (
                  <Checkbox
                    key={s}
                    label={s}
                    checked={form.allowed_scopes.includes(s)}
                    onChange={(_, d) => {
                      const scopes = d.checked
                        ? [...form.allowed_scopes, s]
                        : form.allowed_scopes.filter((x) => x !== s);
                      setForm((f) => ({ ...f!, allowed_scopes: scopes }));
                    }}
                  />
                ))}
              </div>
            </Field>
            <Checkbox
              label={t("apps.publicClient")}
              checked={form.is_public}
              onChange={(_, d) =>
                setForm((f) => ({ ...f!, is_public: !!d.checked }))
              }
            />
            <Button appearance="primary" onClick={handleSave} disabled={saving}>
              {saving ? <Spinner size="tiny" /> : t("common.saveChanges")}
            </Button>
          </div>
        </div>
      )}

      {tab === "credentials" && (
        <div className={styles.card}>
          <Text weight="semibold" block>
            {t("apps.clientCredentials")}
          </Text>

          <Field label={t("apps.clientId")}>
            <div className={styles.secretRow}>
              <Text style={{ flex: 1, fontFamily: "monospace" }}>
                {app.client_id}
              </Text>
              <Button
                icon={<CopyRegular />}
                size="small"
                appearance="subtle"
                onClick={() => copy(app.client_id, "id")}
              >
                {copied === "id" ? t("apps.copied") : ""}
              </Button>
            </div>
          </Field>

          {!app.is_public && (
            <Field label={t("apps.clientSecret")}>
              {newSecret ? (
                <div>
                  <div className={styles.secretRow}>
                    <Text style={{ flex: 1, fontFamily: "monospace" }}>
                      {newSecret}
                    </Text>
                    <Button
                      icon={<CopyRegular />}
                      size="small"
                      appearance="subtle"
                      onClick={() => copy(newSecret, "secret")}
                    >
                      {copied === "secret" ? t("apps.copied") : ""}
                    </Button>
                  </div>
                  <MessageBar intent="warning" style={{ marginTop: 8 }}>
                    {t("apps.saveSecretWarning")}
                  </MessageBar>
                </div>
              ) : (
                <Text style={{ color: tokens.colorNeutralForeground3 }}>
                  {app.client_secret ? "••••••••••••••••" : t("apps.noSecret")}
                </Text>
              )}
              <Button
                appearance="outline"
                onClick={handleRotateSecret}
                disabled={secretRotating}
                style={{ marginTop: 8, width: "fit-content" }}
              >
                {secretRotating ? (
                  <Spinner size="tiny" />
                ) : (
                  t("apps.rotateSecret")
                )}
              </Button>
            </Field>
          )}

          <div>
            <Text weight="semibold" block style={{ marginBottom: 8 }}>
              {t("apps.oauthEndpoints")}
            </Text>
            {[
              ["Authorization", `/api/oauth/authorize`],
              ["Token", `/api/oauth/token`],
              ["UserInfo", `/api/oauth/userinfo`],
            ].map(([label, path]) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  gap: 8,
                  marginBottom: 6,
                  alignItems: "center",
                }}
              >
                <Text
                  size={200}
                  style={{ width: 100, color: tokens.colorNeutralForeground3 }}
                >
                  {label}
                </Text>
                <Text size={200} style={{ fontFamily: "monospace", flex: 1 }}>
                  {window.location.origin}
                  {path}
                </Text>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "danger" && (
        <div className={styles.card}>
          {/* Team membership */}
          <Text weight="semibold" size={400}>
            {t("apps.team")}
          </Text>
          {app.team_id ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <PeopleRegular fontSize={20} />
              <Text>{t("apps.appBelongsToTeam")}</Text>
              <Button
                appearance="outline"
                size="small"
                onClick={() => navigate(`/teams/${app.team_id}`)}
              >
                {t("apps.viewTeam")}
              </Button>
              <Button
                appearance="outline"
                size="small"
                style={{ color: tokens.colorPaletteRedForeground1 }}
                onClick={handleRemoveFromTeam}
              >
                {t("apps.removeFromTeam")}
              </Button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Text style={{ color: tokens.colorNeutralForeground3 }}>
                {t("apps.personalApp")}
              </Text>
              {manageableTeams.length > 0 && (
                <Dialog
                  open={moveOpen}
                  onOpenChange={(_, d) => setMoveOpen(d.open)}
                >
                  <DialogTrigger disableButtonEnhancement>
                    <Button
                      appearance="outline"
                      size="small"
                      icon={<PeopleRegular />}
                    >
                      {t("apps.moveToTeam")}
                    </Button>
                  </DialogTrigger>
                  <DialogSurface>
                    <DialogBody>
                      <DialogTitle>{t("apps.moveAppToTeam")}</DialogTitle>
                      <DialogContent>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                          }}
                        >
                          <Field label={t("apps.selectTeam")} required>
                            <Select
                              value={selectedTeamId}
                              onChange={(_, d) => setSelectedTeamId(d.value)}
                            >
                              <option value="">{t("apps.chooseTeam")}</option>
                              {manageableTeams.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <Text
                            size={200}
                            style={{ color: tokens.colorNeutralForeground3 }}
                          >
                            {t("apps.allAdminsCanManage")}
                          </Text>
                        </div>
                      </DialogContent>
                      <DialogActions>
                        <DialogTrigger>
                          <Button>{t("common.cancel")}</Button>
                        </DialogTrigger>
                        <Button
                          appearance="primary"
                          onClick={handleMoveToTeam}
                          disabled={moving || !selectedTeamId}
                        >
                          {moving ? (
                            <Spinner size="tiny" />
                          ) : (
                            t("apps.moveToTeam")
                          )}
                        </Button>
                      </DialogActions>
                    </DialogBody>
                  </DialogSurface>
                </Dialog>
              )}
            </div>
          )}

          <Text
            weight="semibold"
            size={400}
            style={{ color: tokens.colorPaletteRedForeground1 }}
          >
            {t("apps.dangerTab")}
          </Text>
          <Dialog>
            <DialogTrigger disableButtonEnhancement>
              <Button
                appearance="outline"
                icon={<DeleteRegular />}
                style={{
                  color: tokens.colorPaletteRedForeground1,
                  width: "fit-content",
                }}
              >
                {t("apps.deleteApplication")}
              </Button>
            </DialogTrigger>
            <DialogSurface>
              <DialogBody>
                <DialogTitle>
                  {t("apps.deleteAppTitle", { name: app.name })}
                </DialogTitle>
                <DialogContent>{t("apps.deleteAppDesc")}</DialogContent>
                <DialogActions>
                  <DialogTrigger>
                    <Button>{t("common.cancel")}</Button>
                  </DialogTrigger>
                  <Button
                    appearance="primary"
                    style={{ background: tokens.colorPaletteRedBackground3 }}
                    onClick={handleDelete}
                  >
                    {t("apps.deletePermanently")}
                  </Button>
                </DialogActions>
              </DialogBody>
            </DialogSurface>
          </Dialog>
        </div>
      )}
    </div>
  );
}
