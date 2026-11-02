// Settings → Users & teams: what users can create, the requirements every
// team has, and sub-teams.

import { useTranslation } from "react-i18next";
import { Segmented } from "../../../components/Segmented";
import {
  SettingsBody,
  SettingsCard,
  SettingsRow,
  SettingsSubhead,
} from "../../../components/Settings";
import { CheckGrid } from "./fields";
import { useSettingRows, type SectionProps } from "./shared";

export function TeamsSection({ draft }: SectionProps) {
  const { t } = useTranslation();
  const { set, flag } = draft;
  const { numberRow, check } = useSettingRows(draft);

  const subTeams = flag("enable_sub_teams", true);

  return (
    <>
      <SettingsCard
        id="admin.cardCreation"
        title={t("admin.cardCreation")}
        description={t("admin.cardCreationDesc")}
      >
        {(
          [
            ["disable_user_create_team", "admin.disableUserCreateTeam"],
            ["disable_user_create_app", "admin.disableUserCreateApp"],
          ] as const
        ).map(([key, label]) => (
          <SettingsRow key={key} label={t(label)}>
            <Segmented
              label={t(label)}
              value={flag(key) ? "admins" : "everyone"}
              options={[
                { value: "everyone", label: t("admin.createEveryone") },
                { value: "admins", label: t("admin.createAdminsOnly") },
              ]}
              onChange={(v) => set(key, v === "admins")}
            />
          </SettingsRow>
        ))}
      </SettingsCard>
      <SettingsCard
        id="admin.cardTeamRequirements"
        title={t("admin.cardTeamRequirements")}
        description={t("admin.teamJoinRequirementsHint")}
      >
        <SettingsBody>
          <CheckGrid label={t("admin.cardTeamRequirements")}>
            {check(
              "default_team_require_verified_email",
              "admin.defaultTeamRequireVerifiedEmail",
              false,
            )}
            {check(
              "default_team_require_2fa",
              "admin.defaultTeamRequire2FA",
              false,
            )}
          </CheckGrid>
        </SettingsBody>
      </SettingsCard>
      <SettingsCard
        id="admin.cardSubTeams"
        title={t("admin.cardSubTeams")}
        description={t("admin.subTeamConfigHint")}
      >
        <SettingsRow label={t("admin.enableSubTeams")}>
          <Segmented
            label={t("admin.enableSubTeams")}
            value={subTeams ? "on" : "off"}
            options={[
              { value: "off", label: t("admin.choiceNotAllowed") },
              { value: "on", label: t("admin.choiceAllowed") },
            ]}
            onChange={(v) => set("enable_sub_teams", v === "on")}
          />
        </SettingsRow>
        {subTeams && (
          <>
            {numberRow("max_team_depth", 5, "admin.maxTeamDepth", {
              descKey: "admin.maxTeamDepthHint",
              min: 1,
              max: 20,
            })}
            <SettingsSubhead>{t("admin.inheritLabel")}</SettingsSubhead>
            <SettingsBody>
              <CheckGrid label={t("admin.inheritLabel")}>
                {check(
                  "inherit_team_membership",
                  "admin.inheritTeamMembership",
                  true,
                )}
                {check(
                  "inherit_team_domains",
                  "admin.inheritTeamDomains",
                  true,
                )}
              </CheckGrid>
            </SettingsBody>
          </>
        )}
      </SettingsCard>
    </>
  );
}
