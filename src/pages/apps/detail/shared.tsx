// Small controls shared by the app detail tabs.

import { Button, Spinner, Tooltip } from "@fluentui/react-components";
import { CheckmarkRegular, CopyRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsFooter } from "../../../components/Settings";
import type { AppFormApi, Section } from "./form";

/** An icon button that copies `text` and briefly shows a check. */
export function CopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const name = label ?? t("common.copy");
  return (
    <Tooltip
      content={copied ? t("apps.copied") : name}
      relationship="label"
      withArrow
    >
      <Button
        size="small"
        appearance="subtle"
        icon={copied ? <CheckmarkRegular /> : <CopyRegular />}
        onClick={() => {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      />
    </Tooltip>
  );
}

/** Discard + Save for one section; Save is enabled only with changes. */
export function SectionFooter({
  section,
  api,
}: {
  section: Section;
  api: AppFormApi;
}) {
  const { t } = useTranslation();
  const dirty = api.dirty(section);
  const saving = api.saving === section;
  // Any save in flight blocks the rest, so saves never overlap.
  const busy = api.saving !== null;
  return (
    <SettingsFooter>
      {dirty && !saving && (
        <Button appearance="subtle" onClick={() => api.discard(section)}>
          {t("common.discard")}
        </Button>
      )}
      <Button
        appearance="primary"
        disabled={!dirty || busy}
        onClick={() => api.save(section)}
      >
        {saving ? <Spinner size="tiny" /> : t("common.saveChanges")}
      </Button>
    </SettingsFooter>
  );
}
