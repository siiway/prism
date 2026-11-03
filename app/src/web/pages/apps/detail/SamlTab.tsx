// SAML: let the app sign people in with SAML 2.0 as well as OAuth. Prism is
// the identity provider; this tab holds the app's service-provider settings,
// the IdP details to enter on the SP side, and the attributes it receives.
// Saved through its own endpoint (/apps/:id/saml), not the app form.

import {
  Badge,
  Button,
  Field,
  Input,
  Link,
  Text,
  Textarea,
} from "@fluentui/react-components";
import { ArrowDownloadRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type {
  OAuthApp,
  SamlNameIdFormat,
  SamlSignMode,
  SamlUpdateBody,
} from "../../../lib/api";
import { apiErrorText } from "../../../lib/apiError";
import { useApi } from "../../../lib/api-context";
import { useConfirm } from "../../../lib/useConfirm";
import { CopyButton } from "../../../components/CopyButton";
import { Segmented } from "../../../components/Segmented";
import {
  SaveFooter,
  SettingsBody,
  SettingsCard,
  SettingsEmpty,
  SettingsRow,
} from "../../../components/Settings";
import { SkeletonSettingsCard } from "../../../components/Skeletons";
import { useDetailStyles } from "./styles";

interface Props {
  app: OAuthApp;
  showMsg: (type: "success" | "error", text: string) => void;
}

interface SamlForm {
  entity_id: string;
  /** Raw textarea text, one URL per line. */
  acs_text: string;
  name_id_format: SamlNameIdFormat;
  sign: SamlSignMode;
}

const EMPTY: SamlForm = {
  entity_id: "",
  acs_text: "",
  name_id_format: "persistent",
  sign: "assertion",
};

function toBody(f: SamlForm): SamlUpdateBody {
  return {
    entity_id: f.entity_id.trim(),
    acs_urls: f.acs_text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    name_id_format: f.name_id_format,
    sign: f.sign,
  };
}

// Attribute name → its description key, and the scope that releases it.
const ATTRIBUTES: Array<{ name: string; scope: string | null; key: string }> = [
  { name: "uid", scope: null, key: "apps.saml.attrUid" },
  { name: "username", scope: "profile", key: "apps.saml.attrUsername" },
  { name: "name", scope: "profile", key: "apps.saml.attrName" },
  { name: "email", scope: "email", key: "apps.saml.attrEmail" },
  { name: "teams", scope: "teams:read", key: "apps.saml.attrTeams" },
  { name: "groups", scope: "teams:read", key: "apps.saml.attrGroups" },
];

function downloadPem(pem: string) {
  const url = URL.createObjectURL(
    new Blob([pem], { type: "application/x-pem-file" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "prism-saml.pem";
  a.click();
  URL.revokeObjectURL(url);
}

export function SamlTab({ app, showMsg }: Props) {
  const api = useApi();
  const qc = useQueryClient();
  const styles = useDetailStyles();
  const { t, i18n } = useTranslation();
  const { confirm, confirmDialog } = useConfirm();

  const { data, isLoading } = useQuery({
    queryKey: ["app-saml", app.id],
    queryFn: () => api.getAppSaml(app.id),
  });
  const [edits, setEdits] = useState<Partial<SamlForm>>({});
  const [settingUp, setSettingUp] = useState(false);
  const [saving, setSaving] = useState(false);

  if (isLoading || !data) return <SkeletonSettingsCard rows={4} />;

  const saml = data.saml;
  const base: SamlForm = saml
    ? {
        entity_id: saml.entity_id,
        acs_text: saml.acs_urls.join("\n"),
        name_id_format: saml.name_id_format,
        sign: saml.sign,
      }
    : EMPTY;
  const form: SamlForm = { ...base, ...edits };
  const set = <K extends keyof SamlForm>(key: K, value: SamlForm[K]) =>
    setEdits((e) => ({ ...e, [key]: value }));
  const body = toBody(form);
  const dirty = !saml || JSON.stringify(body) !== JSON.stringify(toBody(base));
  const complete = body.entity_id !== "" && body.acs_urls.length > 0;
  const editing = !!saml || settingUp;

  const save = async () => {
    setSaving(true);
    try {
      await api.updateAppSaml(app.id, body);
      await qc.invalidateQueries({ queryKey: ["app-saml", app.id] });
      setEdits({});
      setSettingUp(false);
      showMsg("success", t("apps.saml.saved"));
    } catch (err) {
      showMsg("error", apiErrorText(err, t("common.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const turnOff = async () => {
    const ok = await confirm({
      title: t("apps.saml.turnOffTitle"),
      body: t("apps.saml.turnOffBody", { appName: app.name }),
      confirmLabel: t("apps.saml.turnOff"),
    });
    if (!ok) return;
    try {
      await api.deleteAppSaml(app.id);
      await qc.invalidateQueries({ queryKey: ["app-saml", app.id] });
      setEdits({});
      showMsg("success", t("apps.saml.turnedOff"));
    } catch (err) {
      showMsg("error", apiErrorText(err, t("common.saveFailed")));
    }
  };

  const guideUrl = i18n.language.startsWith("zh")
    ? "https://prism.wss.moe/zh/saml"
    : "https://prism.wss.moe/saml";
  const released = new Set(data.released_scopes);

  return (
    <>
      <SettingsCard
        id="saml"
        title={t("apps.saml.title")}
        badge={
          saml && (
            <Badge appearance="tint" color="success">
              {t("apps.saml.on")}
            </Badge>
          )
        }
        description={
          <>
            {t("apps.saml.desc")}{" "}
            <Link href={guideUrl} target="_blank" rel="noreferrer">
              {t("apps.saml.guide")}
            </Link>
          </>
        }
        action={
          saml && (
            <Button size="small" onClick={() => void turnOff()}>
              {t("apps.saml.turnOff")}
            </Button>
          )
        }
      >
        {!editing ? (
          <SettingsBody>
            <div className={styles.form}>
              <Text className={styles.muted}>{t("apps.saml.off")}</Text>
              <div>
                <Button appearance="primary" onClick={() => setSettingUp(true)}>
                  {t("apps.saml.setUp")}
                </Button>
              </div>
            </div>
          </SettingsBody>
        ) : (
          <>
            <SettingsBody>
              <div className={styles.form}>
                <Field
                  label={t("apps.saml.entityId")}
                  hint={t("apps.saml.entityIdHint")}
                  required
                >
                  <Input
                    value={form.entity_id}
                    onChange={(_, d) => set("entity_id", d.value)}
                    placeholder={t("apps.saml.entityIdPlaceholder")}
                    input={{ className: styles.monoInput }}
                  />
                </Field>
                <Field
                  label={t("apps.saml.acsUrls")}
                  hint={t("apps.saml.acsUrlsHint")}
                  required
                >
                  <Textarea
                    value={form.acs_text}
                    onChange={(_, d) => set("acs_text", d.value)}
                    placeholder={t("apps.saml.acsUrlsPlaceholder")}
                    rows={3}
                    resize="vertical"
                    textarea={{ className: styles.monoInput }}
                  />
                </Field>
                <Field
                  label={t("apps.saml.nameId")}
                  hint={t("apps.saml.nameIdHint")}
                >
                  <Segmented
                    label={t("apps.saml.nameId")}
                    value={form.name_id_format}
                    options={[
                      {
                        value: "persistent",
                        label: t("apps.saml.nameIdPersistent"),
                      },
                      { value: "email", label: t("apps.saml.nameIdEmail") },
                    ]}
                    onChange={(v) => set("name_id_format", v)}
                  />
                </Field>
                <Field
                  label={t("apps.saml.sign")}
                  hint={t("apps.saml.signHint")}
                >
                  <Segmented
                    label={t("apps.saml.sign")}
                    value={form.sign}
                    options={[
                      {
                        value: "assertion",
                        label: t("apps.saml.signAssertion"),
                      },
                      { value: "response", label: t("apps.saml.signResponse") },
                      { value: "both", label: t("apps.saml.signBoth") },
                    ]}
                    onChange={(v) => set("sign", v)}
                  />
                </Field>
              </div>
            </SettingsBody>
            <SaveFooter
              dirty={dirty}
              saving={saving}
              disabled={!complete}
              onDiscard={() => {
                setEdits({});
                setSettingUp(false);
              }}
              onSave={() => void save()}
            />
          </>
        )}
      </SettingsCard>

      {editing && (
        <SettingsCard
          id="saml-idp"
          title={t("apps.saml.idpTitle")}
          description={t("apps.saml.idpDesc")}
        >
          {(
            [
              [t("apps.saml.metadataUrl"), data.idp.metadata_url],
              [t("apps.saml.idpEntityId"), data.idp.entity_id],
              [t("apps.saml.ssoUrl"), data.idp.sso_url],
            ] as const
          ).map(([label, value]) => (
            <SettingsRow
              key={label}
              label={label}
              description={<span className={styles.mono}>{value}</span>}
            >
              <CopyButton text={value} />
            </SettingsRow>
          ))}
          <SettingsRow
            label={t("apps.saml.certificate")}
            description={t("apps.saml.certificateDesc")}
          >
            <CopyButton text={data.idp.certificate} />
            <Button
              size="small"
              icon={<ArrowDownloadRegular />}
              onClick={() => downloadPem(data.idp.certificate)}
            >
              {t("apps.saml.downloadCertificate")}
            </Button>
          </SettingsRow>
        </SettingsCard>
      )}

      {editing && (
        <SettingsCard
          id="saml-attributes"
          title={t("apps.saml.attributesTitle")}
          description={t("apps.saml.attributesDesc")}
        >
          {ATTRIBUTES.filter((a) => !a.scope || released.has(a.scope)).map(
            (a) => (
              <SettingsRow
                key={a.name}
                label={<span className={styles.monoLabel}>{a.name}</span>}
                description={t(a.key)}
              />
            ),
          )}
          {released.size === 0 && (
            <SettingsEmpty>{t("apps.saml.attributesOnlyUid")}</SettingsEmpty>
          )}
        </SettingsCard>
      )}
      {confirmDialog}
    </>
  );
}
