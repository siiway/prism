// Access: optionally limit who may authorize the app to listed teams and
// users. Saves as soon as it changes.

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
  Tooltip,
} from "@fluentui/react-components";
import {
  AddRegular,
  DismissRegular,
  PeopleRegular,
  PersonRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { type OAuthApp } from "../../../lib/api";
import { apiErrorText } from "../../../lib/apiError";
import { useApi } from "../../../lib/api-context";
import { Segmented } from "../../../components/Segmented";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsRow,
} from "../../../components/Settings";
import { useDetailStyles } from "./styles";
import type { AppFormApi } from "./form";

type MinRole = "owner" | "co-owner" | "admin" | "member";
const ROLES: MinRole[] = ["member", "admin", "co-owner", "owner"];
const ROLE_KEY: Record<MinRole, string> = {
  owner: "accessWhitelist.roleOwner",
  "co-owner": "accessWhitelist.roleCoOwner",
  admin: "accessWhitelist.roleAdmin",
  member: "accessWhitelist.roleMember",
};

interface Props {
  app: OAuthApp;
  formApi: AppFormApi;
  showMsg: (type: "success" | "error", text: string) => void;
}

export function AccessTab({ app, formApi, showMsg }: Props) {
  const api = useApi();
  const styles = useDetailStyles();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const appId = app.id;

  const errorText = (err: unknown) => apiErrorText(err, t("common.saveFailed"));

  const { data: teamsData } = useQuery({
    queryKey: ["teams"],
    queryFn: () => api.listTeams(),
  });
  const teams = teamsData?.teams ?? [];

  const rulesKey = ["app-access-rules", appId];
  const { data: rulesData } = useQuery({
    queryKey: rulesKey,
    queryFn: () => api.listAccessRules(appId),
  });
  const rules = rulesData?.rules ?? [];

  // Through the page's write lock: this update rewrites the whole app row.
  const setEnabled = (enabled: boolean) =>
    formApi.exclusive(async () => {
      try {
        await api.updateApp(appId, { access_whitelist_enabled: enabled });
        await qc.invalidateQueries({ queryKey: ["app", appId] });
      } catch (e) {
        showMsg("error", errorText(e));
      }
    });

  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"team" | "user">("team");
  const [target, setTarget] = useState("");
  const [minRole, setMinRole] = useState<MinRole>("member");
  const [error, setError] = useState("");

  const add = useMutation({
    mutationFn: () =>
      api.createAccessRule(appId, {
        rule_type: type,
        target_id: target.trim(),
        min_role: type === "team" ? minRole : undefined,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: rulesKey });
      setOpen(false);
      setTarget("");
    },
    onError: (e) => setError(errorText(e)),
  });

  const remove = useMutation({
    mutationFn: (ruleId: string) => api.deleteAccessRule(appId, ruleId),
    onSuccess: () => qc.invalidateQueries({ queryKey: rulesKey }),
    onError: (e) => showMsg("error", errorText(e)),
  });

  const enabled = app.access_whitelist_enabled;

  return (
    <>
      <SettingsCard
        id="access"
        title={t("accessWhitelist.title")}
        description={t("accessWhitelist.description")}
        badge={
          <Badge
            appearance="tint"
            size="small"
            color={enabled ? "success" : "subtle"}
          >
            {enabled ? t("security.enabled") : t("security.disabled")}
          </Badge>
        }
        action={
          <Button
            size="small"
            icon={<AddRegular />}
            onClick={() => {
              setError("");
              setOpen(true);
            }}
          >
            {t("accessWhitelist.addRule")}
          </Button>
        }
      >
        <SettingsRow
          label={t("accessWhitelist.enabled")}
          description={
            enabled && rules.length === 0
              ? t("accessWhitelist.enabledNoRules")
              : t("accessWhitelist.enabledDesc")
          }
        >
          <Switch
            aria-label={t("accessWhitelist.enabled")}
            checked={enabled}
            disabled={formApi.saving !== null}
            onChange={(_, d) => void setEnabled(d.checked)}
          />
        </SettingsRow>
        {rules.length === 0 ? (
          <SettingsEmpty>{t("accessWhitelist.noRules")}</SettingsEmpty>
        ) : (
          rules.map((rule) => {
            const isTeam = rule.rule_type === "team";
            const teamName = isTeam
              ? teams.find((tm) => tm.id === rule.target_id)?.name
              : undefined;
            return (
              <SettingsRow
                key={rule.id}
                icon={isTeam ? <PeopleRegular /> : <PersonRegular />}
                label={
                  teamName ?? (
                    <span className={styles.monoLabel}>{rule.target_id}</span>
                  )
                }
                description={
                  isTeam
                    ? t("accessWhitelist.teamRuleDesc", {
                        role: t(
                          ROLE_KEY[(rule.min_role ?? "member") as MinRole],
                        ),
                      })
                    : t("accessWhitelist.ruleTypeUser")
                }
              >
                <Tooltip
                  content={t("common.remove")}
                  relationship="label"
                  withArrow
                >
                  <Button
                    size="small"
                    appearance="subtle"
                    icon={<DismissRegular />}
                    onClick={() => remove.mutate(rule.id)}
                  />
                </Tooltip>
              </SettingsRow>
            );
          })
        )}
      </SettingsCard>

      <Dialog open={open} onOpenChange={(_, d) => setOpen(d.open)}>
        <DialogSurface>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (target.trim()) add.mutate();
            }}
          >
            <DialogBody>
              <DialogTitle>{t("accessWhitelist.addRule")}</DialogTitle>
              <DialogContent className={styles.dialogForm}>
                {error && <MessageBar intent="error">{error}</MessageBar>}
                <Segmented
                  label={t("accessWhitelist.ruleType")}
                  value={type}
                  fill
                  options={[
                    { value: "team", label: t("accessWhitelist.ruleTypeTeam") },
                    { value: "user", label: t("accessWhitelist.ruleTypeUser") },
                  ]}
                  onChange={(v) => {
                    setType(v);
                    setTarget("");
                  }}
                />
                {type === "team" ? (
                  <>
                    <Field
                      label={t("accessWhitelist.ruleTypeTeam")}
                      required
                      validationState={teams.length ? undefined : "warning"}
                      validationMessage={
                        teams.length
                          ? undefined
                          : t("accessWhitelist.teamNotFound")
                      }
                    >
                      <Dropdown
                        placeholder={t("accessWhitelist.selectTeam")}
                        disabled={!teams.length}
                        value={teams.find((tm) => tm.id === target)?.name ?? ""}
                        selectedOptions={target ? [target] : []}
                        onOptionSelect={(_, d) =>
                          setTarget(d.optionValue ?? "")
                        }
                      >
                        {teams.map((tm) => (
                          <Option key={tm.id} value={tm.id}>
                            {tm.name}
                          </Option>
                        ))}
                      </Dropdown>
                    </Field>
                    <Field
                      label={t("accessWhitelist.minRole")}
                      hint={t("accessWhitelist.minRoleHint")}
                    >
                      <Dropdown
                        value={t(ROLE_KEY[minRole])}
                        selectedOptions={[minRole]}
                        onOptionSelect={(_, d) =>
                          setMinRole((d.optionValue as MinRole) ?? "member")
                        }
                      >
                        {ROLES.map((r) => (
                          <Option key={r} value={r}>
                            {t(ROLE_KEY[r])}
                          </Option>
                        ))}
                      </Dropdown>
                    </Field>
                  </>
                ) : (
                  <Field label={t("accessWhitelist.userId")} required>
                    <Input
                      value={target}
                      onChange={(_, d) => setTarget(d.value)}
                      input={{ className: styles.monoInput }}
                    />
                  </Field>
                )}
              </DialogContent>
              <DialogActions>
                <Button type="button" onClick={() => setOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  appearance="primary"
                  disabled={!target.trim() || add.isPending}
                >
                  {add.isPending ? <Spinner size="tiny" /> : t("common.add")}
                </Button>
              </DialogActions>
            </DialogBody>
          </form>
        </DialogSurface>
      </Dialog>
    </>
  );
}
