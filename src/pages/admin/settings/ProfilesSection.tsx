// Settings → Public profiles: whether users and teams can publish one, and
// which fields show by default.

import { Field, Text } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import { PasswordInput } from "../../../components/PasswordInput";
import { Segmented } from "../../../components/Segmented";
import {
  SettingsBody,
  SettingsCard,
  SettingsRow,
  SettingsSubhead,
} from "../../../components/Settings";
import { useSettingsStyles } from "./styles";
import { CheckGrid } from "./fields";
import { useSettingRows, type SectionProps } from "./shared";

// Public profile fields and whether each is shown when a user hasn't chosen.
const PROFILE_FIELDS = [
  [
    "default_profile_show_display_name",
    "admin.defaultProfileShowDisplayName",
    true,
  ],
  ["default_profile_show_avatar", "admin.defaultProfileShowAvatar", true],
  ["default_profile_show_email", "admin.defaultProfileShowEmail", false],
  ["default_profile_show_joined_at", "admin.defaultProfileShowJoinedAt", true],
  ["default_profile_show_gpg_keys", "admin.defaultProfileShowGpgKeys", true],
  [
    "default_profile_show_authorized_apps",
    "admin.defaultProfileShowAuthorizedApps",
    false,
  ],
  [
    "default_profile_show_owned_apps",
    "admin.defaultProfileShowOwnedApps",
    true,
  ],
  ["default_profile_show_domains", "admin.defaultProfileShowDomains", true],
  [
    "default_profile_show_joined_teams",
    "admin.defaultProfileShowJoinedTeams",
    false,
  ],
  ["default_profile_show_readme", "admin.defaultProfileShowReadme", true],
] as const;

const TEAM_PROFILE_FIELDS = [
  [
    "default_team_profile_show_description",
    "admin.defaultTeamProfileShowDescription",
    true,
  ],
  [
    "default_team_profile_show_avatar",
    "admin.defaultTeamProfileShowAvatar",
    true,
  ],
  [
    "default_team_profile_show_owner",
    "admin.defaultTeamProfileShowOwner",
    false,
  ],
  [
    "default_team_profile_show_member_count",
    "admin.defaultTeamProfileShowMemberCount",
    true,
  ],
  ["default_team_profile_show_apps", "admin.defaultTeamProfileShowApps", true],
  [
    "default_team_profile_show_domains",
    "admin.defaultTeamProfileShowDomains",
    true,
  ],
  [
    "default_team_profile_show_members",
    "admin.defaultTeamProfileShowMembers",
    false,
  ],
] as const;

export function ProfilesSection({ draft }: SectionProps) {
  const { t } = useTranslation();
  const styles = useSettingsStyles();
  const { get, set, flag } = draft;
  const { numberRow, check, unit } = useSettingRows(draft);

  const subTeams = flag("enable_sub_teams", true);
  const publicProfiles = flag("enable_public_profiles", true);

  return (
    <>
      <SettingsCard
        id="admin.publicProfilesTitle"
        title={t("admin.publicProfilesTitle")}
        description={t("admin.publicProfilesDesc")}
      >
        <SettingsRow label={t("admin.enablePublicProfiles")}>
          <Segmented
            label={t("admin.enablePublicProfiles")}
            value={publicProfiles ? "on" : "off"}
            options={[
              { value: "off", label: t("admin.choiceNotAllowed") },
              { value: "on", label: t("admin.choiceAllowed") },
            ]}
            onChange={(v) => set("enable_public_profiles", v === "on")}
          />
        </SettingsRow>
        {publicProfiles && (
          <>
            <SettingsSubhead>
              {t("admin.publicProfilesFieldDefaultsHint")}
            </SettingsSubhead>
            <SettingsBody>
              <CheckGrid label={t("admin.publicProfilesFieldDefaultsHint")}>
                {PROFILE_FIELDS.map(([key, label, fallback]) =>
                  check(key, label, fallback),
                )}
              </CheckGrid>
              <Text size={200} className={styles.muted}>
                {t("admin.profileFieldsNote")}
              </Text>
            </SettingsBody>
          </>
        )}
      </SettingsCard>
      {publicProfiles && (
        <SettingsCard
          id="admin.cardProfileReadme"
          title={t("admin.cardProfileReadme")}
        >
          {numberRow(
            "profile_readme_max_bytes",
            64 * 1024,
            "admin.profileReadmeMaxBytes",
            {
              descKey: "admin.profileReadmeMaxBytesHint",
              unit: unit.bytes,
              min: 1024,
              max: 1024 * 1024,
            },
          )}
          {numberRow(
            "github_readme_cache_ttl_seconds",
            3600,
            "admin.githubReadmeCacheTtl",
            {
              descKey: "admin.githubReadmeCacheTtlHint",
              unit: unit.seconds,
              min: 60,
              max: 7 * 86400,
            },
          )}
          <SettingsBody>
            <Field
              label={t("admin.githubReadmeToken")}
              hint={t("admin.githubReadmeTokenHint")}
            >
              <PasswordInput
                value={String(get("github_readme_token") ?? "")}
                placeholder={t("admin.githubReadmeTokenPlaceholder")}
                onChange={(_, d) => set("github_readme_token", d.value)}
              />
            </Field>
          </SettingsBody>
        </SettingsCard>
      )}
      {publicProfiles && (
        <SettingsCard
          id="admin.cardTeamProfiles"
          title={t("admin.cardTeamProfiles")}
          description={t("admin.teamProfileDefaultsHint")}
        >
          <SettingsBody>
            <CheckGrid label={t("admin.cardTeamProfiles")}>
              {TEAM_PROFILE_FIELDS.map(([key, label, fallback]) =>
                check(key, label, fallback),
              )}
              {subTeams &&
                check(
                  "default_team_profile_show_sub_teams",
                  "admin.defaultTeamProfileShowSubTeams",
                  true,
                )}
            </CheckGrid>
            <Text size={200} className={styles.muted}>
              {t("admin.teamFieldsNote")}
            </Text>
          </SettingsBody>
        </SettingsCard>
      )}
    </>
  );
}
