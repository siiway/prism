// Admin site settings, one section per page (/admin/settings/<section>).
//
// Laid out like the account settings pages: cards of rows, label on the
// left and the control on the right. Every section but Legal and Danger
// Zone edits one draft, saved from the bar that appears once something
// changes. Because nothing applies until that save, there are no switches
// here: a setting with named values gets a segmented choice, a set of
// related options gets a group of checkboxes, and options that only matter
// once something else is on stay hidden until it is.
//
// Each section is its own file in ./settings. This page holds what they
// share: the config, the draft, the toast and the save bar. The search
// index (vite/searchIndex.ts) follows the {tab === "x" && <XSection} lines
// below to each section's file.

import { Button, Spinner, Text } from "@fluentui/react-components";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { isSettingsSection } from "./adminNav";
import { useApi } from "../../lib/api-context";
import { useToastMessage } from "../../lib/useToastMessage";
import type { SiteConfig } from "../../types";
import { SkeletonSettingsPage } from "../../components/Skeletons";
import { SettingsToast } from "../../components/Settings";
import { useConfigDraft, useFail } from "./settings/shared";
import { useSettingsStyles } from "./settings/styles";
import { GeneralSection } from "./settings/GeneralSection";
import { SignupSection } from "./settings/SignupSection";
import { AuthSection } from "./settings/AuthSection";
import { TeamsSection } from "./settings/TeamsSection";
import { ProfilesSection } from "./settings/ProfilesSection";
import { CaptchaSection } from "./settings/CaptchaSection";
import { EmailSection } from "./settings/EmailSection";
import { AppearanceSection } from "./settings/AppearanceSection";
import { LegalSection } from "./settings/LegalSection";
import { DangerSection } from "./settings/DangerSection";

export function AdminSettings() {
  const api = useApi();
  const styles = useSettingsStyles();
  const qc = useQueryClient();
  const { t } = useTranslation();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-config"],
    queryFn: api.adminConfig,
  });
  const config = data?.config as SiteConfig | undefined;
  const draft = useConfigDraft(config);
  const [saving, setSaving] = useState(false);
  const { message, showMsg } = useToastMessage();
  const fail = useFail(showMsg);
  // The section comes from the URL; the sidebar lists them (adminNav.ts).
  const { tab: tabParam } = useParams();
  const tab = isSettingsSection(tabParam) ? tabParam : "general";

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.adminUpdateConfig(draft.localConfig as Record<string, unknown>);
      await qc.invalidateQueries({ queryKey: ["admin-config"] });
      await qc.invalidateQueries({ queryKey: ["site"] });
      draft.reset();
      showMsg("success", t("admin.settingsSaved"));
    } catch (err) {
      fail(err, "admin.saveFailed");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <SkeletonSettingsPage cards={[3, 2]} form />;

  const props = { draft, showMsg };
  return (
    <div className={styles.page}>
      <SettingsToast message={message} />

      {tab === "general" && <GeneralSection {...props} />}
      {tab === "signup" && <SignupSection {...props} />}
      {tab === "auth" && <AuthSection {...props} />}
      {tab === "teams" && <TeamsSection {...props} />}
      {tab === "profiles" && <ProfilesSection {...props} />}
      {tab === "captcha" && <CaptchaSection {...props} />}
      {tab === "email" && <EmailSection {...props} />}
      {tab === "appearance" && <AppearanceSection {...props} />}
      {tab === "legal" && <LegalSection {...props} />}
      {tab === "danger" && <DangerSection {...props} />}

      {/* Legal saves its own drafts; Danger Zone only runs actions. */}
      {tab !== "legal" && tab !== "danger" && draft.dirty && (
        <div
          className={styles.saveBar}
          role="region"
          aria-label={t("admin.unsavedChanges")}
        >
          <Text className={styles.saveBarText}>
            {t("admin.unsavedChanges")}
          </Text>
          <Button disabled={saving} onClick={draft.reset}>
            {t("common.discard")}
          </Button>
          <Button
            appearance="primary"
            onClick={() => void handleSave()}
            disabled={saving}
            icon={saving ? <Spinner size="tiny" /> : undefined}
          >
            {t("admin.saveSettings")}
          </Button>
        </div>
      )}
    </div>
  );
}
