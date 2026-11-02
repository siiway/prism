// Settings → Appearance: the accent colour, custom CSS and footer credit.

import { Field, Textarea } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import { ColorPickerInput } from "../../../components/ColorPickerInput";
import { Segmented } from "../../../components/Segmented";
import {
  SettingsBody,
  SettingsCard,
  SettingsRow,
} from "../../../components/Settings";
import { type SectionProps } from "./shared";

export function AppearanceSection({ draft }: SectionProps) {
  const { t } = useTranslation();
  const { get, set, flag } = draft;

  return (
    <SettingsCard id="admin.cardTheme" title={t("admin.cardTheme")}>
      <SettingsRow label={t("admin.accentColor")}>
        <ColorPickerInput
          value={get("accent_color") ?? "#0078d4"}
          onChange={(color) => set("accent_color", color ?? "#0078d4")}
        />
      </SettingsRow>
      <SettingsBody>
        <Field label={t("admin.customCss")} hint={t("admin.customCssHint")}>
          <Textarea
            value={get("custom_css") ?? ""}
            onChange={(e) => set("custom_css", e.target.value)}
            rows={10}
            placeholder={t("admin.customCssPlaceholder")}
          />
        </Field>
      </SettingsBody>
      <SettingsRow
        label={t("admin.poweredByCredit")}
        description={t("admin.poweredByCreditDesc")}
      >
        <Segmented
          label={t("admin.poweredByCredit")}
          value={flag("show_powered_by", true)}
          options={[
            { value: true, label: t("admin.choiceShown") },
            { value: false, label: t("admin.choiceHidden") },
          ]}
          onChange={(v) => set("show_powered_by", v)}
        />
      </SettingsRow>
    </SettingsCard>
  );
}
