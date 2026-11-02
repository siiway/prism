// Permissions: the scopes this app offers to other apps, and who may use
// them. Everything here saves as soon as it changes.

import {
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
  Text,
  Textarea,
  Tooltip,
} from "@fluentui/react-components";
import {
  AddRegular,
  ArrowImportRegular,
  DeleteRegular,
  DismissRegular,
  EditRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  type AppScopeAccessRule,
  type AppScopeDefinition,
  type OAuthApp,
} from "../../../lib/api";
import { apiErrorText } from "../../../lib/apiError";
import { useApi } from "../../../lib/api-context";
import { useConfirm } from "../../../lib/useConfirm";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsRow,
  SettingsSubhead,
} from "../../../components/Settings";
import { SkeletonSettingsCard } from "../../../components/Skeletons";
import { CopyButton } from "../../../components/CopyButton";
import { useDetailStyles } from "./styles";
import type { AppFormApi } from "./form";

type RuleType = AppScopeAccessRule["rule_type"];
const RULE_TYPES: RuleType[] = [
  "app_allow",
  "app_deny",
  "owner_allow",
  "owner_deny",
];

type ImportDef = { scope: string; title: string; description?: string };

interface Props {
  app: OAuthApp;
  formApi: AppFormApi;
  showMsg: (type: "success" | "error", text: string) => void;
}

export function PermissionsTab({ app, formApi, showMsg }: Props) {
  const api = useApi();
  const styles = useDetailStyles();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { confirm, confirmDialog } = useConfirm();
  const appId = app.id;

  const errorText = (err: unknown) => apiErrorText(err, t("common.saveFailed"));

  // ── Scope definitions ──────────────────────────────────────────────────────
  const defsKey = ["app-scope-defs", appId];
  const { data: defsData, isLoading: defsLoading } = useQuery({
    queryKey: defsKey,
    queryFn: () => api.listScopeDefinitions(appId),
  });
  const defs = defsData?.definitions ?? [];

  // One dialog for adding and editing; editing keeps the identifier.
  const [defDialog, setDefDialog] = useState<{
    editing: AppScopeDefinition | null;
    scope: string;
    title: string;
    description: string;
  } | null>(null);
  const [defError, setDefError] = useState("");

  const saveDef = useMutation({
    mutationFn: async () => {
      if (!defDialog) return;
      const body = {
        title: defDialog.title.trim(),
        description: defDialog.description.trim(),
      };
      if (defDialog.editing)
        await api.updateScopeDefinition(appId, defDialog.editing.id, body);
      else
        await api.createScopeDefinition(appId, {
          scope: defDialog.scope.trim(),
          ...body,
        });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: defsKey });
      setDefDialog(null);
    },
    onError: (e) => setDefError(errorText(e)),
  });

  const deleteDef = async (def: AppScopeDefinition) => {
    if (
      !(await confirm({
        title: t("apps.deleteScopeTitle"),
        body: t("apps.deleteScopeBody", { scope: def.scope }),
        confirmLabel: t("common.delete"),
      }))
    )
      return;
    try {
      await api.deleteScopeDefinition(appId, def.id);
      await qc.invalidateQueries({ queryKey: defsKey });
    } catch (e) {
      showMsg("error", errorText(e));
    }
  };

  // ── Import ─────────────────────────────────────────────────────────────────
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importRunning, setImportRunning] = useState(false);
  const [importResult, setImportResult] = useState<{
    ok: number;
    total: number;
    failures: { scope: string; error: string }[];
  } | null>(null);

  const parsedImport = (():
    { defs: ImportDef[] } | { error: string } | null => {
    if (!importText.trim()) return null;
    let raw: unknown;
    try {
      raw = JSON.parse(importText);
    } catch (e) {
      return {
        error: t("apps.scopeDefImportInvalidJson", {
          error: e instanceof Error ? e.message : String(e),
        }),
      };
    }
    const list: ImportDef[] = [];
    for (const entry of Array.isArray(raw) ? raw : [raw]) {
      const e = entry as Record<string, unknown> | null;
      if (!e || typeof e.scope !== "string" || typeof e.title !== "string")
        return { error: t("apps.scopeDefImportInvalidShape") };
      list.push({
        scope: e.scope.trim(),
        title: e.title.trim(),
        description:
          typeof e.description === "string" ? e.description.trim() : undefined,
      });
    }
    return { defs: list };
  })();

  const runImport = async () => {
    if (!parsedImport || "error" in parsedImport) return;
    setImportRunning(true);
    setImportResult(null);
    const failures: { scope: string; error: string }[] = [];
    let ok = 0;
    for (const def of parsedImport.defs) {
      try {
        await api.createScopeDefinition(appId, def);
        ok += 1;
      } catch (e) {
        failures.push({ scope: def.scope, error: errorText(e) });
      }
    }
    setImportRunning(false);
    setImportResult({ ok, total: parsedImport.defs.length, failures });
    await qc.invalidateQueries({ queryKey: defsKey });
    if (failures.length === 0) setImportText("");
  };

  // ── Self-management switch ─────────────────────────────────────────────────
  // Through the page's write lock: this update rewrites the whole app row.
  const setSelfManage = (enabled: boolean) =>
    formApi.exclusive(async () => {
      try {
        await api.updateApp(appId, {
          allow_self_manage_exported_permissions: enabled,
        });
        await qc.invalidateQueries({ queryKey: ["app", appId] });
      } catch (e) {
        showMsg("error", errorText(e));
      }
    });

  // ── Access rules ───────────────────────────────────────────────────────────
  const rulesKey = ["app-scope-rules", appId];
  const { data: rulesData, isLoading: rulesLoading } = useQuery({
    queryKey: rulesKey,
    queryFn: () => api.listScopeAccessRules(appId),
  });
  const rules = rulesData?.rules ?? [];

  const [ruleOpen, setRuleOpen] = useState(false);
  const [ruleType, setRuleType] = useState<RuleType>("app_allow");
  const [ruleTarget, setRuleTarget] = useState("");
  const [ruleError, setRuleError] = useState("");

  const addRule = useMutation({
    mutationFn: () =>
      api.createScopeAccessRule(appId, {
        rule_type: ruleType,
        target_id: ruleTarget.trim(),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: rulesKey });
      setRuleOpen(false);
      setRuleTarget("");
    },
    onError: (e) => setRuleError(errorText(e)),
  });

  const deleteRule = useMutation({
    mutationFn: (ruleId: string) => api.deleteScopeAccessRule(appId, ruleId),
    onSuccess: () => qc.invalidateQueries({ queryKey: rulesKey }),
    onError: (e) => showMsg("error", errorText(e)),
  });

  const iconButton = (
    label: string,
    icon: React.ReactElement,
    onClick: () => void,
  ) => (
    <Tooltip content={label} relationship="label" withArrow>
      <Button size="small" appearance="subtle" icon={icon} onClick={onClick} />
    </Tooltip>
  );

  if (defsLoading || rulesLoading)
    return (
      <>
        <SkeletonSettingsCard rows={3} />
        <SkeletonSettingsCard rows={2} />
      </>
    );

  return (
    <>
      <SettingsCard
        id="scope-definitions"
        title={t("apps.scopeDefsTitle")}
        description={t("apps.scopeDefsHint")}
        action={
          <>
            <Button
              size="small"
              icon={<ArrowImportRegular />}
              onClick={() => {
                setImportOpen(true);
                setImportResult(null);
              }}
            >
              {t("apps.scopeDefImport")}
            </Button>
            <Button
              size="small"
              icon={<AddRegular />}
              onClick={() => {
                setDefError("");
                setDefDialog({
                  editing: null,
                  scope: "",
                  title: "",
                  description: "",
                });
              }}
            >
              {t("apps.addScope")}
            </Button>
          </>
        }
      >
        <SettingsRow
          label={t("apps.scopeIdLabel")}
          description={
            <>
              <span className={styles.mono}>{app.client_id}</span>
              <br />
              {t("apps.scopeIdHint")}
            </>
          }
        >
          <CopyButton text={app.client_id} label={t("apps.copyScopeId")} />
        </SettingsRow>
        {defs.length > 0 && (
          <SettingsSubhead>{t("apps.definedScopes")}</SettingsSubhead>
        )}
        {defs.length === 0 ? (
          <SettingsEmpty>{t("apps.noScopeDefs")}</SettingsEmpty>
        ) : (
          defs.map((def) => (
            <SettingsRow
              key={def.id}
              label={
                <>
                  <span className={styles.monoLabel}>{def.scope}</span>
                  <Text className={styles.muted}>· {def.title}</Text>
                </>
              }
              description={def.description || undefined}
            >
              <CopyButton
                text={`app:${app.client_id}:${def.scope}`}
                label={t("apps.copyFullScopeId")}
              />
              {iconButton(t("common.edit"), <EditRegular />, () => {
                setDefError("");
                setDefDialog({
                  editing: def,
                  scope: def.scope,
                  title: def.title,
                  description: def.description,
                });
              })}
              {iconButton(t("common.delete"), <DeleteRegular />, () =>
                deleteDef(def),
              )}
            </SettingsRow>
          ))
        )}
        <SettingsRow
          label={t("apps.selfManageLabel")}
          description={t("apps.selfManageDesc")}
        >
          <Switch
            aria-label={t("apps.selfManageLabel")}
            checked={app.allow_self_manage_exported_permissions}
            disabled={formApi.saving !== null}
            onChange={(_, d) => void setSelfManage(d.checked)}
          />
        </SettingsRow>
      </SettingsCard>

      <SettingsCard
        id="scope-access"
        title={t("apps.scopeAccessRulesTitle")}
        description={t("apps.scopeAccessRulesHint")}
        action={
          <Button
            size="small"
            icon={<AddRegular />}
            onClick={() => {
              setRuleError("");
              setRuleOpen(true);
            }}
          >
            {t("apps.addRule")}
          </Button>
        }
      >
        {rules.length === 0 ? (
          <SettingsEmpty>{t("apps.noRules")}</SettingsEmpty>
        ) : (
          RULE_TYPES.filter((rt) => rules.some((r) => r.rule_type === rt)).map(
            (rt) => (
              <div key={rt}>
                <SettingsSubhead>{t(`apps.ruleType_${rt}`)}</SettingsSubhead>
                {rules
                  .filter((r) => r.rule_type === rt)
                  .map((rule) => (
                    <SettingsRow
                      key={rule.id}
                      label={
                        <span className={styles.monoLabel}>
                          {rule.target_id}
                        </span>
                      }
                    >
                      {iconButton(t("common.remove"), <DismissRegular />, () =>
                        deleteRule.mutate(rule.id),
                      )}
                    </SettingsRow>
                  ))}
              </div>
            ),
          )
        )}
      </SettingsCard>

      {/* Add / edit a scope definition */}
      <Dialog
        open={!!defDialog}
        onOpenChange={(_, d) => !d.open && setDefDialog(null)}
      >
        <DialogSurface>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveDef.mutate();
            }}
          >
            <DialogBody>
              <DialogTitle>
                {defDialog?.editing ? t("apps.editScope") : t("apps.addScope")}
              </DialogTitle>
              <DialogContent className={styles.dialogForm}>
                {defError && <MessageBar intent="error">{defError}</MessageBar>}
                <Field label={t("apps.scopeDefScopeId")} required>
                  <Input
                    autoFocus={!defDialog?.editing}
                    disabled={!!defDialog?.editing}
                    value={defDialog?.scope ?? ""}
                    onChange={(_, d) =>
                      setDefDialog((s) => s && { ...s, scope: d.value })
                    }
                    placeholder="read_posts"
                    input={{ className: styles.monoInput }}
                  />
                </Field>
                <Field label={t("apps.scopeDefTitle")} required>
                  <Input
                    autoFocus={!!defDialog?.editing}
                    value={defDialog?.title ?? ""}
                    onChange={(_, d) =>
                      setDefDialog((s) => s && { ...s, title: d.value })
                    }
                    placeholder={t("apps.scopeDefTitlePlaceholder")}
                  />
                </Field>
                <Field label={t("apps.scopeDefDescription")}>
                  <Textarea
                    value={defDialog?.description ?? ""}
                    onChange={(_, d) =>
                      setDefDialog((s) => s && { ...s, description: d.value })
                    }
                    placeholder={t("apps.scopeDefDescPlaceholder")}
                    rows={2}
                    resize="vertical"
                  />
                </Field>
              </DialogContent>
              <DialogActions>
                <Button type="button" onClick={() => setDefDialog(null)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  appearance="primary"
                  disabled={
                    saveDef.isPending ||
                    !defDialog?.scope.trim() ||
                    !defDialog?.title.trim()
                  }
                >
                  {saveDef.isPending ? (
                    <Spinner size="tiny" />
                  ) : defDialog?.editing ? (
                    t("common.save")
                  ) : (
                    t("common.add")
                  )}
                </Button>
              </DialogActions>
            </DialogBody>
          </form>
        </DialogSurface>
      </Dialog>

      {/* Import scope definitions */}
      <Dialog open={importOpen} onOpenChange={(_, d) => setImportOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("apps.scopeDefImportTitle")}</DialogTitle>
            <DialogContent className={styles.dialogForm}>
              <span className={styles.muted}>
                {t("apps.scopeDefImportHint")}
              </span>
              <Textarea
                value={importText}
                onChange={(_, d) => {
                  setImportText(d.value);
                  setImportResult(null);
                }}
                placeholder={t("apps.scopeDefImportPlaceholder")}
                rows={12}
                resize="vertical"
                textarea={{ className: styles.monoInput }}
              />
              {parsedImport && "error" in parsedImport && (
                <MessageBar intent="error">{parsedImport.error}</MessageBar>
              )}
              {importResult && (
                <MessageBar
                  intent={
                    importResult.failures.length === 0 ? "success" : "warning"
                  }
                >
                  <div>
                    {importResult.failures.length === 0
                      ? t("apps.scopeDefImportResultOk", {
                          total: importResult.total,
                        })
                      : t("apps.scopeDefImportResultPartial", {
                          ok: importResult.ok,
                          total: importResult.total,
                          failed: importResult.failures.length,
                        })}
                    {importResult.failures.map((f) => (
                      <div key={f.scope}>
                        <span className={styles.mono}>{f.scope}</span>:{" "}
                        {f.error}
                      </div>
                    ))}
                  </div>
                </MessageBar>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setImportOpen(false)}>
                {t("common.close")}
              </Button>
              <Button
                appearance="primary"
                icon={
                  importRunning ? (
                    <Spinner size="tiny" />
                  ) : (
                    <ArrowImportRegular />
                  )
                }
                disabled={
                  importRunning ||
                  !parsedImport ||
                  "error" in parsedImport ||
                  parsedImport.defs.length === 0
                }
                onClick={runImport}
              >
                {importRunning
                  ? t("apps.scopeDefImportRunning")
                  : t("apps.scopeDefImportButton", {
                      count:
                        parsedImport && !("error" in parsedImport)
                          ? parsedImport.defs.length
                          : 0,
                    })}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Add a scope access rule */}
      <Dialog open={ruleOpen} onOpenChange={(_, d) => setRuleOpen(d.open)}>
        <DialogSurface>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (ruleTarget.trim()) addRule.mutate();
            }}
          >
            <DialogBody>
              <DialogTitle>{t("apps.addRule")}</DialogTitle>
              <DialogContent className={styles.dialogForm}>
                {ruleError && (
                  <MessageBar intent="error">{ruleError}</MessageBar>
                )}
                <Field label={t("apps.ruleType")}>
                  <Dropdown
                    value={t(`apps.ruleType_${ruleType}`)}
                    selectedOptions={[ruleType]}
                    onOptionSelect={(_, d) =>
                      setRuleType((d.optionValue as RuleType) ?? "app_allow")
                    }
                  >
                    {RULE_TYPES.map((rt) => (
                      <Option key={rt} value={rt}>
                        {t(`apps.ruleType_${rt}`)}
                      </Option>
                    ))}
                  </Dropdown>
                </Field>
                <Field
                  label={
                    ruleType.startsWith("app_")
                      ? t("apps.clientId")
                      : t("apps.ruleTargetUserIdPlaceholder")
                  }
                  required
                >
                  <Input
                    value={ruleTarget}
                    onChange={(_, d) => setRuleTarget(d.value)}
                    placeholder={ruleType.startsWith("app_") ? "prism_..." : ""}
                    input={{ className: styles.monoInput }}
                  />
                </Field>
              </DialogContent>
              <DialogActions>
                <Button type="button" onClick={() => setRuleOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  appearance="primary"
                  disabled={!ruleTarget.trim() || addRule.isPending}
                >
                  {addRule.isPending ? (
                    <Spinner size="tiny" />
                  ) : (
                    t("common.add")
                  )}
                </Button>
              </DialogActions>
            </DialogBody>
          </form>
        </DialogSurface>
      </Dialog>

      {confirmDialog}
    </>
  );
}
