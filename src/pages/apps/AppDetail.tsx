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
  Dropdown,
  Field,
  Input,
  MessageBar,
  Option,
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
  AddRegular,
  CopyRegular,
  DeleteRegular,
  DismissRegular,
  PeopleRegular,
  ShieldRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  api,
  ApiError,
  type AppScopeDefinition,
  type AppScopeAccessRule,
} from "../../lib/api";
import { ImageUrlInput } from "../../components/ImageUrlInput";
import {
  SkeletonFormCard,
  SkeletonTableRows,
} from "../../components/Skeletons";

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
});

const PLATFORM_SCOPES = [
  "openid",
  "profile",
  "profile:write",
  "email",
  "offline_access",
  "apps:read",
  "apps:write",
  "teams:read",
  "teams:write",
  "teams:create",
  "teams:delete",
  "domains:read",
  "domains:write",
  "gpg:read",
  "gpg:write",
  "social:read",
  "social:write",
  "webhooks:read",
  "webhooks:write",
  "admin:users:read",
  "admin:users:write",
  "admin:users:delete",
  "admin:config:read",
  "admin:config:write",
  "admin:invites:read",
  "admin:invites:create",
  "admin:invites:delete",
  "admin:webhooks:read",
  "admin:webhooks:write",
  "admin:webhooks:delete",
  "site:user:read",
  "site:user:write",
  "site:user:delete",
  "site:team:read",
  "site:team:write",
  "site:team:delete",
  "site:config:read",
  "site:config:write",
  "site:token:revoke",
  "team:read",
  "team:write",
  "team:delete",
  "team:member:read",
  "team:member:write",
  "team:member:profile:read",
];

// Keep SCOPES alias for the app-permissions field (needs all non-offline scopes)
const SCOPES = PLATFORM_SCOPES;

// ─── App-delegation permissions UI ───────────────────────────────────────────

interface AppPermissionsFieldProps {
  allowedScopes: string[];
  onChange: (scopes: string[]) => void;
}

function AppPermissionsField({
  allowedScopes,
  onChange,
}: AppPermissionsFieldProps) {
  const { t } = useTranslation();
  const [clientId, setClientId] = useState("");
  const [innerScope, setInnerScope] = useState(SCOPES[0]);

  const appScopes = allowedScopes.filter((s) => s.startsWith("app:"));

  const add = () => {
    const trimmed = clientId.trim();
    if (!trimmed || !innerScope) return;
    const scope = `app:${trimmed}:${innerScope}`;
    if (allowedScopes.includes(scope)) return;
    onChange([...allowedScopes, scope]);
    setClientId("");
  };

  const remove = (scope: string) =>
    onChange(allowedScopes.filter((s) => s !== scope));

  return (
    <Field
      label={t("apps.appPermissionsField")}
      hint={t("apps.appPermissionsHint")}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {appScopes.map((s) => {
          const [, cid, ...rest] = s.split(":");
          const inner = rest.join(":");
          return (
            <div
              key={s}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 8px",
                background: tokens.colorNeutralBackground3,
                borderRadius: 4,
                fontFamily: "monospace",
                fontSize: tokens.fontSizeBase200,
              }}
            >
              <Text
                size={200}
                style={{
                  flex: 1,
                  fontFamily: "monospace",
                  wordBreak: "break-all",
                }}
              >
                {cid}
                <Text
                  size={200}
                  style={{
                    color: tokens.colorNeutralForeground3,
                    marginLeft: 4,
                  }}
                >
                  · {inner}
                </Text>
              </Text>
              <Button
                appearance="subtle"
                icon={<DismissRegular />}
                size="small"
                onClick={() => remove(s)}
              />
            </div>
          );
        })}
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          <Field label={t("apps.appPermissionsClientId")} style={{ flex: 1 }}>
            <Input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="prism_..."
              size="small"
              onKeyDown={(e) => e.key === "Enter" && add()}
            />
          </Field>
          <Field
            label={t("apps.appPermissionsScope")}
            style={{ minWidth: 160 }}
          >
            <Dropdown
              value={innerScope}
              selectedOptions={[innerScope]}
              onOptionSelect={(_, d) =>
                setInnerScope(d.optionValue ?? SCOPES[0])
              }
              size="small"
            >
              {SCOPES.filter((s) => s !== "offline_access").map((s) => (
                <Option key={s} value={s}>
                  {s}
                </Option>
              ))}
            </Dropdown>
          </Field>
          <Button size="small" onClick={add} disabled={!clientId.trim()}>
            {t("apps.appPermissionsAdd")}
          </Button>
        </div>
      </div>
    </Field>
  );
}

// ─── Scope picker field ───────────────────────────────────────────────────────

interface ScopePickerFieldProps {
  label: string;
  hint?: string;
  scopes: string[];
  availableScopes: string[];
  onChange: (scopes: string[]) => void;
}

function ScopePickerField({
  label,
  hint,
  scopes,
  availableScopes,
  onChange,
}: ScopePickerFieldProps) {
  const { t } = useTranslation();
  const addScope = (s: string) => {
    if (!scopes.includes(s)) onChange([...scopes, s]);
  };
  const removeScope = (s: string) => onChange(scopes.filter((x) => x !== s));
  const platformOpts = availableScopes.filter((s) => !scopes.includes(s));

  return (
    <Field label={label} hint={hint}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {scopes
          .filter((s) => !s.startsWith("app:"))
          .map((s) => (
            <div
              key={s}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 8px",
                background: tokens.colorNeutralBackground3,
                borderRadius: 4,
              }}
            >
              <Text size={200} style={{ flex: 1, fontFamily: "monospace" }}>
                {s}
              </Text>
              <Button
                appearance="subtle"
                icon={<DismissRegular />}
                size="small"
                onClick={() => removeScope(s)}
              />
            </div>
          ))}
        {platformOpts.length > 0 && (
          <Dropdown
            placeholder={t("apps.allowedScopesPlaceholder")}
            onOptionSelect={(_, d) => {
              if (d.optionValue) addScope(d.optionValue);
            }}
            size="small"
            selectedOptions={[]}
            value=""
          >
            {platformOpts.map((s) => (
              <Option key={s} value={s}>
                {s}
              </Option>
            ))}
          </Dropdown>
        )}
      </div>
    </Field>
  );
}

// ─── Scope definitions panel ──────────────────────────────────────────────────

function ScopeDefinitionsPanel({ appId }: { appId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [newScope, setNewScope] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [err, setErr] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["app-scope-defs", appId],
    queryFn: () => api.listScopeDefinitions(appId),
  });

  const createMut = useMutation({
    mutationFn: () =>
      api.createScopeDefinition(appId, {
        scope: newScope.trim(),
        title: newTitle.trim(),
        description: newDesc.trim(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-scope-defs", appId] });
      setNewScope("");
      setNewTitle("");
      setNewDesc("");
      setErr("");
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : "Failed"),
  });

  const updateMut = useMutation({
    mutationFn: (defId: string) =>
      api.updateScopeDefinition(appId, defId, {
        title: editTitle.trim(),
        description: editDesc.trim(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-scope-defs", appId] });
      setEditId(null);
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : "Failed"),
  });

  const deleteMut = useMutation({
    mutationFn: (defId: string) => api.deleteScopeDefinition(appId, defId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["app-scope-defs", appId] }),
  });

  const startEdit = (def: AppScopeDefinition) => {
    setEditId(def.id);
    setEditTitle(def.title);
    setEditDesc(def.description);
  };

  if (isLoading) return <SkeletonTableRows rows={3} cols={2} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Text weight="semibold">{t("apps.scopeDefsTitle")}</Text>
      <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
        {t("apps.scopeDefsHint")}
      </Text>

      {err && <MessageBar intent="error">{err}</MessageBar>}

      {(data?.definitions ?? []).map((def) =>
        editId === def.id ? (
          <div
            key={def.id}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: "12px",
              background: tokens.colorNeutralBackground3,
              borderRadius: 6,
            }}
          >
            <Field label={t("apps.scopeDefTitle")}>
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                size="small"
              />
            </Field>
            <Field label={t("apps.scopeDefDescription")}>
              <Input
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                size="small"
              />
            </Field>
            <div style={{ display: "flex", gap: 6 }}>
              <Button
                size="small"
                appearance="primary"
                onClick={() => updateMut.mutate(def.id)}
                disabled={updateMut.isPending}
              >
                {t("common.save")}
              </Button>
              <Button size="small" onClick={() => setEditId(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <div
            key={def.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              padding: "10px 12px",
              background: tokens.colorNeutralBackground3,
              borderRadius: 6,
            }}
          >
            <div style={{ flex: 1 }}>
              <Text
                weight="semibold"
                size={300}
                style={{ fontFamily: "monospace" }}
              >
                {def.scope}
              </Text>
              <Text block size={300}>
                {def.title}
              </Text>
              {def.description && (
                <Text
                  size={200}
                  style={{ color: tokens.colorNeutralForeground3 }}
                >
                  {def.description}
                </Text>
              )}
            </div>
            <Button
              size="small"
              appearance="subtle"
              onClick={() => startEdit(def)}
            >
              {t("common.edit")}
            </Button>
            <Button
              size="small"
              appearance="subtle"
              icon={<DeleteRegular />}
              onClick={() => deleteMut.mutate(def.id)}
            />
          </div>
        ),
      )}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: "12px",
          border: `1px dashed ${tokens.colorNeutralStroke1}`,
          borderRadius: 6,
        }}
      >
        <Text size={200} weight="semibold">
          {t("apps.scopeDefAdd")}
        </Text>
        <div style={{ display: "flex", gap: 6 }}>
          <Field label={t("apps.scopeDefScopeId")} style={{ flex: 1 }}>
            <Input
              value={newScope}
              onChange={(e) => setNewScope(e.target.value)}
              placeholder="read_posts"
              size="small"
            />
          </Field>
          <Field label={t("apps.scopeDefTitle")} style={{ flex: 2 }}>
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={t("apps.scopeDefTitlePlaceholder")}
              size="small"
            />
          </Field>
        </div>
        <Field label={t("apps.scopeDefDescription")}>
          <Input
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder={t("apps.scopeDefDescPlaceholder")}
            size="small"
          />
        </Field>
        <Button
          size="small"
          icon={<AddRegular />}
          onClick={() => createMut.mutate()}
          disabled={!newScope.trim() || !newTitle.trim() || createMut.isPending}
        >
          {t("apps.scopeDefAdd")}
        </Button>
      </div>
    </div>
  );
}

// ─── Scope access rules panel ─────────────────────────────────────────────────

const RULE_TYPE_LABELS: Record<string, string> = {
  owner_allow: "owner_allow",
  owner_deny: "owner_deny",
  app_allow: "app_allow",
  app_deny: "app_deny",
};

function ScopeAccessRulesPanel({ appId }: { appId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [ruleType, setRuleType] =
    useState<AppScopeAccessRule["rule_type"]>("app_allow");
  const [targetId, setTargetId] = useState("");
  const [err, setErr] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["app-scope-rules", appId],
    queryFn: () => api.listScopeAccessRules(appId),
  });

  const createMut = useMutation({
    mutationFn: () =>
      api.createScopeAccessRule(appId, {
        rule_type: ruleType,
        target_id: targetId.trim(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-scope-rules", appId] });
      setTargetId("");
      setErr("");
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : "Failed"),
  });

  const deleteMut = useMutation({
    mutationFn: (ruleId: string) => api.deleteScopeAccessRule(appId, ruleId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["app-scope-rules", appId] }),
  });

  const rules = data?.rules ?? [];
  const grouped = {
    app_allow: rules.filter((r) => r.rule_type === "app_allow"),
    app_deny: rules.filter((r) => r.rule_type === "app_deny"),
    owner_allow: rules.filter((r) => r.rule_type === "owner_allow"),
    owner_deny: rules.filter((r) => r.rule_type === "owner_deny"),
  };

  if (isLoading) return <SkeletonTableRows rows={4} cols={2} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Text weight="semibold">{t("apps.scopeAccessRulesTitle")}</Text>
      <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
        {t("apps.scopeAccessRulesHint")}
      </Text>

      {err && <MessageBar intent="error">{err}</MessageBar>}

      {(["app_allow", "app_deny", "owner_allow", "owner_deny"] as const).map(
        (rt) => (
          <div key={rt}>
            <Text
              block
              weight="semibold"
              size={200}
              style={{
                textTransform: "uppercase",
                letterSpacing: 1,
                color: tokens.colorNeutralForeground3,
                marginBottom: 4,
              }}
            >
              {t(`apps.ruleType_${rt}`)}
            </Text>
            {grouped[rt].length === 0 ? (
              <Text
                block
                size={200}
                style={{ color: tokens.colorNeutralForeground4 }}
              >
                {t("apps.noRules")}
              </Text>
            ) : (
              grouped[rt].map((rule) => (
                <div
                  key={rule.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "4px 0",
                  }}
                >
                  <Text size={200} style={{ flex: 1, fontFamily: "monospace" }}>
                    {rule.target_id}
                  </Text>
                  <Button
                    size="small"
                    appearance="subtle"
                    icon={<DismissRegular />}
                    onClick={() => deleteMut.mutate(rule.id)}
                  />
                </div>
              ))
            )}
          </div>
        ),
      )}

      <div
        style={{
          display: "flex",
          gap: 6,
          alignItems: "flex-end",
          padding: "12px",
          border: `1px dashed ${tokens.colorNeutralStroke1}`,
          borderRadius: 6,
        }}
      >
        <Field label={t("apps.ruleType")} style={{ minWidth: 160 }}>
          <Dropdown
            value={t(`apps.ruleType_${ruleType}`)}
            selectedOptions={[ruleType]}
            onOptionSelect={(_, d) =>
              setRuleType(
                (d.optionValue ??
                  "app_allow") as AppScopeAccessRule["rule_type"],
              )
            }
            size="small"
          >
            {(
              Object.keys(RULE_TYPE_LABELS) as Array<
                keyof typeof RULE_TYPE_LABELS
              >
            ).map((rt) => (
              <Option key={rt} value={rt}>
                {t(`apps.ruleType_${rt}`)}
              </Option>
            ))}
          </Dropdown>
        </Field>
        <Field label={t("apps.ruleTargetId")} style={{ flex: 1 }}>
          <Input
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            placeholder={
              ruleType.startsWith("app_")
                ? "prism_..."
                : t("apps.ruleTargetUserIdPlaceholder")
            }
            size="small"
            onKeyDown={(e) =>
              e.key === "Enter" && targetId.trim() && createMut.mutate()
            }
          />
        </Field>
        <Button
          size="small"
          icon={<AddRegular />}
          onClick={() => createMut.mutate()}
          disabled={!targetId.trim() || createMut.isPending}
        >
          {t("apps.addRule")}
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

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
    optional_scopes: string[];
    is_public: boolean;
    use_jwt_tokens: boolean;
    allow_self_manage_exported_permissions: boolean;
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
      icon_url: app.unproxied_icon_url ?? "",
      website_url: app.website_url ?? "",
      redirect_uris: app.redirect_uris.join("\n"),
      allowed_scopes: app.allowed_scopes,
      optional_scopes: app.optional_scopes ?? [],
      is_public: app.is_public,
      use_jwt_tokens: app.use_jwt_tokens,
      allow_self_manage_exported_permissions:
        app.allow_self_manage_exported_permissions,
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
        optional_scopes: form.optional_scopes,
        is_public: form.is_public,
        use_jwt_tokens: form.use_jwt_tokens,
        allow_self_manage_exported_permissions:
          form.allow_self_manage_exported_permissions,
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
  const [migrateOpen, setMigrateOpen] = useState(false);
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
      setMigrateOpen(false);
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

  if (isLoading) return <SkeletonFormCard rows={6} />;
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
        <Tab value="permissions">{t("apps.permissionsTab")}</Tab>
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
            <ScopePickerField
              label={t("apps.allowedScopes")}
              hint={t("apps.allowedScopesHint")}
              scopes={form.allowed_scopes.filter((s) => !s.startsWith("app:"))}
              availableScopes={PLATFORM_SCOPES}
              onChange={(scopes) =>
                setForm((f) => ({
                  ...f!,
                  allowed_scopes: [
                    ...scopes,
                    ...f!.allowed_scopes.filter((s) => s.startsWith("app:")),
                  ],
                  optional_scopes: f!.optional_scopes.filter((s) =>
                    scopes.includes(s),
                  ),
                }))
              }
            />

            <ScopePickerField
              label={t("apps.optionalScopes")}
              hint={t("apps.optionalScopesHint")}
              scopes={form.optional_scopes}
              availableScopes={form.allowed_scopes.filter(
                (s) => !s.startsWith("app:"),
              )}
              onChange={(scopes) =>
                setForm((f) => ({ ...f!, optional_scopes: scopes }))
              }
            />

            <AppPermissionsField
              allowedScopes={form.allowed_scopes}
              onChange={(scopes) =>
                setForm((f) => ({ ...f!, allowed_scopes: scopes }))
              }
            />
            <Checkbox
              id={"is-public"}
              label={t("apps.publicClient")}
              checked={form.is_public}
              onChange={(_, d) =>
                setForm((f) => ({ ...f!, is_public: !!d.checked }))
              }
            />
            <Checkbox
              id={"use-jwt-tokens"}
              label={t("apps.useJwtTokens")}
              checked={form.use_jwt_tokens}
              onChange={(_, d) =>
                setForm((f) => ({ ...f!, use_jwt_tokens: !!d.checked }))
              }
            />
            <Checkbox
              id={"allow-self-manage-exported-permissions"}
              label={t("apps.allowSelfManageExportedPermissions")}
              checked={form.allow_self_manage_exported_permissions}
              onChange={(_, d) =>
                setForm((f) => ({
                  ...f!,
                  allow_self_manage_exported_permissions: !!d.checked,
                }))
              }
            />
            <Button appearance="primary" onClick={handleSave} disabled={saving}>
              {saving ? <Spinner size="tiny" /> : t("common.saveChanges")}
            </Button>
          </div>
        </div>
      )}

      {tab === "permissions" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          <div className={styles.card}>
            <Field label={t("apps.scopeIdLabel")} hint={t("apps.scopeIdHint")}>
              <div className={styles.secretRow}>
                <Text style={{ flex: 1, fontFamily: "monospace" }}>
                  {app.client_id}
                </Text>
                <Button
                  icon={<CopyRegular />}
                  size="small"
                  appearance="subtle"
                  onClick={() => copy(app.client_id, "scope-id")}
                >
                  {copied === "scope-id"
                    ? t("apps.copied")
                    : t("apps.copyScopeId")}
                </Button>
              </div>
            </Field>
          </div>
          <div className={styles.card}>
            <ScopeDefinitionsPanel appId={id!} />
          </div>
          <div className={styles.card}>
            <ScopeAccessRulesPanel appId={id!} />
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
            </div>
          )}

          {/* Migrate app to team */}
          {manageableTeams.filter((tm) => tm.id !== app.team_id).length > 0 && (
            <Dialog
              open={migrateOpen}
              onOpenChange={(_, d) => {
                setMigrateOpen(d.open);
                if (!d.open) setSelectedTeamId("");
              }}
            >
              <DialogTrigger disableButtonEnhancement>
                <Button
                  appearance="outline"
                  icon={<PeopleRegular />}
                  style={{ width: "fit-content" }}
                >
                  {t("apps.migrateToTeam")}
                </Button>
              </DialogTrigger>
              <DialogSurface>
                <DialogBody>
                  <DialogTitle>{t("apps.migrateAppToTeam")}</DialogTitle>
                  <DialogContent>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      <Field label={t("apps.selectTeam")} required>
                        <Dropdown
                          placeholder={t("apps.chooseTeam")}
                          value={
                            manageableTeams.find(
                              (tm) => tm.id === selectedTeamId,
                            )?.name ?? ""
                          }
                          selectedOptions={
                            selectedTeamId ? [selectedTeamId] : []
                          }
                          onOptionSelect={(_, d) =>
                            setSelectedTeamId(d.optionValue ?? "")
                          }
                        >
                          {manageableTeams
                            .filter((tm) => tm.id !== app.team_id)
                            .map((tm) => (
                              <Option key={tm.id} value={tm.id}>
                                {tm.name}
                              </Option>
                            ))}
                        </Dropdown>
                      </Field>
                      <Text
                        size={200}
                        style={{ color: tokens.colorNeutralForeground3 }}
                      >
                        {t("apps.migrateAppDesc")}
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
                        t("apps.migrateToTeam")
                      )}
                    </Button>
                  </DialogActions>
                </DialogBody>
              </DialogSurface>
            </Dialog>
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
