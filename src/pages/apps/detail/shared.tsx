// Small controls shared by the app detail tabs.

import { Button, Spinner } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import { SettingsFooter } from "../../../components/Settings";
import type { AppFormApi, Section } from "./form";

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
