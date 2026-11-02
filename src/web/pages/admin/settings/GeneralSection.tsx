// Settings → General: the site name, description and icon, the security.txt
// contact, and how pages render.

import { Field, Input } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import { ImageUrlInput } from "../../../components/ImageUrlInput";
import { Segmented } from "../../../components/Segmented";
import {
  SettingsBody,
  SettingsCard,
  SettingsRow,
} from "../../../components/Settings";
import { type SectionProps } from "./shared";

export function GeneralSection({ draft }: SectionProps) {
  const { t } = useTranslation();
  const { get, set, flag } = draft;

  return (
    <>
      <SettingsCard id="admin.cardSite" title={t("admin.cardSite")}>
        <SettingsBody>
          <Field label={t("admin.siteName")}>
            <Input
              value={get("site_name") ?? ""}
              onChange={(e) => set("site_name", e.target.value)}
            />
          </Field>
          <Field label={t("admin.siteDescription")}>
            <Input
              value={get("site_description") ?? ""}
              onChange={(e) => set("site_description", e.target.value)}
            />
          </Field>
          <ImageUrlInput
            label={t("admin.siteIconUrl")}
            value={get("site_icon_url") ?? ""}
            onChange={(v) => set("site_icon_url", v || null)}
          />
        </SettingsBody>
      </SettingsCard>
      <SettingsCard
        id="admin.securityTxtTitle"
        title={t("admin.securityTxtTitle")}
        description={t("admin.securityTxtDesc")}
      >
        <SettingsBody>
          <Field
            label={t("admin.securityContact")}
            hint={t("admin.securityContactHint")}
          >
            <Input
              value={get("security_contact") ?? ""}
              onChange={(e) => set("security_contact", e.target.value)}
              placeholder="mailto:security@example.com"
            />
          </Field>
          <Field
            label={t("admin.securityPolicyUrl")}
            hint={t("admin.securityPolicyUrlHint")}
          >
            <Input
              value={get("security_policy_url") ?? ""}
              onChange={(e) => set("security_policy_url", e.target.value)}
              placeholder="https://example.com/security-policy"
            />
          </Field>
        </SettingsBody>
      </SettingsCard>
      <SettingsCard id="admin.cardAdvanced" title={t("admin.cardAdvanced")}>
        <SettingsRow
          label={t("admin.disableSsr")}
          description={t("admin.disableSsrHint")}
        >
          <Segmented
            label={t("admin.disableSsr")}
            value={flag("disable_ssr") ? "browser" : "server"}
            options={[
              { value: "server", label: t("admin.renderServer") },
              { value: "browser", label: t("admin.renderBrowser") },
            ]}
            onChange={(v) => set("disable_ssr", v === "browser")}
          />
        </SettingsRow>
      </SettingsCard>
    </>
  );
}
