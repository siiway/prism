// The scopes an app may request. OAuth asks for them at sign-in, and SAML
// sends the attributes they cover (profile, email, teams:read).

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
  Option,
  Tooltip,
} from "@fluentui/react-components";
import { AddRegular, DismissRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PLATFORM_SCOPES } from "../../../../shared/scopes";
import { Segmented } from "../../../components/Segmented";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsRow,
  SettingsSubhead,
} from "../../../components/Settings";
import { AllowedScopesImporter } from "./AllowedScopesImporter";
import { SectionFooter } from "./shared";
import { useDetailStyles } from "./styles";
import { type AppFormApi } from "./form";

// A delegated scope is app:<client_id>:<scope>; the inner scope is the
// target app's own identifier or a platform scope such as teams:read.
const CLIENT_ID_RE = /^[a-zA-Z0-9_.-]+$/;
const INNER_SCOPE_RE = /^[a-zA-Z0-9_.:-]+$/;

export function ScopesCard({ formApi }: { formApi: AppFormApi }) {
  const styles = useDetailStyles();
  const { t } = useTranslation();
  const { form, set } = formApi;

  const platformScopes = form.allowed_scopes.filter(
    (s) => !s.startsWith("app:"),
  );
  const appScopes = form.allowed_scopes.filter((s) => s.startsWith("app:"));
  const addable = PLATFORM_SCOPES.filter(
    (s) => !form.allowed_scopes.includes(s),
  );

  const setAllowed = (next: string[]) => {
    set("allowed_scopes", next);
    set(
      "optional_scopes",
      form.optional_scopes.filter((s) => next.includes(s)),
    );
  };
  const setOptional = (scope: string, optional: boolean) =>
    set(
      "optional_scopes",
      optional
        ? [...form.optional_scopes, scope]
        : form.optional_scopes.filter((s) => s !== scope),
    );
  const removeScope = (scope: string) =>
    setAllowed(form.allowed_scopes.filter((s) => s !== scope));

  // "Another app's scope" dialog.
  const [appScopeOpen, setAppScopeOpen] = useState(false);
  const [targetClientId, setTargetClientId] = useState("");
  const [targetScope, setTargetScope] = useState("");
  const appScopeValid =
    CLIENT_ID_RE.test(targetClientId.trim()) &&
    INNER_SCOPE_RE.test(targetScope.trim());
  const addAppScope = () => {
    if (!appScopeValid) return;
    const scope = `app:${targetClientId.trim()}:${targetScope.trim()}`;
    if (!form.allowed_scopes.includes(scope))
      setAllowed([...form.allowed_scopes, scope]);
    setAppScopeOpen(false);
    setTargetClientId("");
    setTargetScope("");
  };

  const removeButton = (label: string, onClick: () => void) => (
    <Tooltip content={label} relationship="label" withArrow>
      <Button
        size="small"
        appearance="subtle"
        icon={<DismissRegular />}
        onClick={onClick}
      />
    </Tooltip>
  );

  return (
    <>
      <SettingsCard
        id="scopes"
        title={t("apps.scopesTitle")}
        description={t("apps.scopesDesc")}
        action={
          <AllowedScopesImporter
            current={form.allowed_scopes}
            onMerge={setAllowed}
          />
        }
      >
        {form.allowed_scopes.length === 0 && (
          <SettingsEmpty>{t("apps.scopesEmpty")}</SettingsEmpty>
        )}
        {platformScopes.map((s) => (
          <SettingsRow
            key={s}
            label={<span className={styles.monoLabel}>{s}</span>}
          >
            <Segmented
              label={s}
              value={form.optional_scopes.includes(s)}
              options={[
                { value: false, label: t("apps.scopeRequired") },
                { value: true, label: t("apps.scopeOptional") },
              ]}
              onChange={(v) => setOptional(s, v)}
            />
            {removeButton(t("common.remove"), () => removeScope(s))}
          </SettingsRow>
        ))}
        {appScopes.length > 0 && (
          <SettingsSubhead>{t("apps.otherAppScopes")}</SettingsSubhead>
        )}
        {appScopes.map((s) => {
          const [, clientId, ...rest] = s.split(":");
          return (
            <SettingsRow
              key={s}
              label={<span className={styles.monoLabel}>{rest.join(":")}</span>}
              description={<span className={styles.mono}>{clientId}</span>}
            >
              {removeButton(t("common.remove"), () => removeScope(s))}
            </SettingsRow>
          );
        })}
        <SettingsRow label={t("apps.addScope")}>
          <div className={styles.control}>
            <Dropdown
              className={styles.dropdown}
              size="small"
              placeholder={t("apps.chooseScope")}
              value=""
              selectedOptions={[]}
              disabled={addable.length === 0}
              onOptionSelect={(_, d) => {
                if (d.optionValue)
                  setAllowed([...form.allowed_scopes, d.optionValue]);
              }}
            >
              {addable.map((s) => (
                <Option key={s} value={s}>
                  {s}
                </Option>
              ))}
            </Dropdown>
          </div>
          <Button
            size="small"
            icon={<AddRegular />}
            onClick={() => setAppScopeOpen(true)}
          >
            {t("apps.addOtherAppScope")}
          </Button>
        </SettingsRow>
        <SectionFooter section="scopes" api={formApi} />
      </SettingsCard>

      <Dialog
        open={appScopeOpen}
        onOpenChange={(_, d) => setAppScopeOpen(d.open)}
      >
        <DialogSurface>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addAppScope();
            }}
          >
            <DialogBody>
              <DialogTitle>{t("apps.addOtherAppScope")}</DialogTitle>
              <DialogContent className={styles.dialogForm}>
                <span className={styles.muted}>
                  {t("apps.otherAppScopeHint")}
                </span>
                <Field label={t("apps.appPermissionsClientId")} required>
                  <Input
                    autoFocus
                    value={targetClientId}
                    onChange={(_, d) => setTargetClientId(d.value)}
                    placeholder="prism_..."
                    input={{ className: styles.monoInput }}
                  />
                </Field>
                <Field label={t("apps.appPermissionsScope")} required>
                  <Input
                    value={targetScope}
                    onChange={(_, d) => setTargetScope(d.value)}
                    placeholder="read_posts"
                    input={{ className: styles.monoInput }}
                  />
                </Field>
              </DialogContent>
              <DialogActions>
                <Button type="button" onClick={() => setAppScopeOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  appearance="primary"
                  disabled={!appScopeValid}
                >
                  {t("common.add")}
                </Button>
              </DialogActions>
            </DialogBody>
          </form>
        </DialogSurface>
      </Dialog>
    </>
  );
}
