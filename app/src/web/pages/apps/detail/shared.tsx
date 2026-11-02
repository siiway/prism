// Small controls shared by the app detail tabs.

import { SaveFooter } from "../../../components/Settings";
import type { AppFormApi, Section } from "./form";

/** Discard + Save for one section; Save is enabled only with changes. */
export function SectionFooter({
  section,
  api,
}: {
  section: Section;
  api: AppFormApi;
}) {
  return (
    <SaveFooter
      dirty={api.dirty(section)}
      saving={api.saving === section}
      // Any save in flight blocks the rest, so saves never overlap.
      disabled={api.saving !== null}
      onDiscard={() => api.discard(section)}
      onSave={() => api.save(section)}
    />
  );
}
