// Settings → Sign-up: who can register, verification, and what invite-registered
// (restricted) accounts may do.

import { Checkbox, Text } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import { Segmented } from "../../../components/Segmented";
import { Select } from "../../../components/Select";
import {
  SettingsBody,
  SettingsCard,
  SettingsRow,
  SettingsSubhead,
} from "../../../components/Settings";
import { useSettingsStyles } from "./styles";
import { CheckGrid } from "./fields";
import { useSettingRows, type SectionProps } from "./shared";

// Features an invite-registered (restricted) account may be granted.
const RESTRICTED_CAPS = [
  ["team:create", "admin.capTeamCreate"],
  ["app:create", "admin.capAppCreate"],
  ["domain:create", "admin.capDomainCreate"],
  ["pat:create", "admin.capPatCreate"],
  ["profile:public", "admin.capProfilePublic"],
  ["gpg:manage", "admin.capGpgManage"],
  ["self:convert", "admin.capSelfConvert"],
] as const;

export function SignupSection({ draft }: SectionProps) {
  const { t } = useTranslation();
  const styles = useSettingsStyles();
  const { get, set, flag } = draft;
  const { numberRow, required, unit } = useSettingRows(draft);

  return (
    <>
      <SettingsCard
        id="admin.cardRegistration"
        title={t("admin.cardRegistration")}
      >
        <SettingsRow label={t("admin.registrationMode")}>
          <Select
            aria-label={t("admin.registrationMode")}
            className={styles.select}
            value={
              get("allow_registration")
                ? get("invite_only")
                  ? "invite_only"
                  : "open"
                : "closed"
            }
            onChange={(_, d) => {
              set("allow_registration", d.value !== "closed");
              set("invite_only", d.value === "invite_only");
            }}
          >
            <option value="open">{t("admin.regModeOpen")}</option>
            <option value="invite_only">{t("admin.regModeInviteOnly")}</option>
            <option value="closed">{t("admin.regModeClosed")}</option>
          </Select>
        </SettingsRow>
        {required(
          "require_email_verification",
          "admin.requireEmailVerification",
          "admin.requireEmailVerificationDesc",
        )}
        {numberRow("social_verify_ttl_days", 0, "admin.socialVerifyTtl", {
          descKey: "admin.socialVerifyTtlHint",
          unit: unit.days,
          min: 0,
        })}
        <SettingsRow
          label={t("admin.allowAltEmailLogin")}
          description={t("admin.allowAltEmailLoginDesc")}
        >
          <Segmented
            label={t("admin.allowAltEmailLogin")}
            value={flag("allow_alt_email_login", true) ? "any" : "primary"}
            options={[
              { value: "primary", label: t("admin.altEmailPrimaryOnly") },
              { value: "any", label: t("admin.altEmailAny") },
            ]}
            onChange={(v) => set("allow_alt_email_login", v === "any")}
          />
        </SettingsRow>
      </SettingsCard>
      <SettingsCard
        id="admin.cardInviteSignup"
        title={t("admin.cardInviteSignup")}
        description={t("admin.inviteSignupDesc")}
      >
        {numberRow(
          "team_invite_registration_max_uses_cap",
          1000,
          "admin.inviteRegMaxUsesCap",
          { descKey: "admin.inviteRegMaxUsesCapHint", min: 1 },
        )}
        {numberRow(
          "team_invite_registration_rate_per_hour",
          200,
          "admin.inviteRegRatePerHour",
          { descKey: "admin.inviteRegRatePerHourHint", min: 1 },
        )}
      </SettingsCard>
      <SettingsCard
        id="admin.cardRestricted"
        title={t("admin.cardRestricted")}
        description={t("admin.cardRestrictedDesc")}
      >
        {numberRow(
          "restricted_pending_ttl_hours",
          72,
          "admin.pendingTtlHours",
          {
            descKey: "admin.pendingTtlHoursHint",
            unit: unit.hours,
            min: 1,
          },
        )}
        {numberRow(
          "restricted_dissolve_grace_hours",
          168,
          "admin.dissolveGraceHours",
          {
            descKey: "admin.dissolveGraceHoursHint",
            unit: unit.hours,
            min: 1,
          },
        )}
        <SettingsSubhead>{t("admin.restrictedCapsLabel")}</SettingsSubhead>
        <SettingsBody>
          <CheckGrid label={t("admin.restrictedCapsLabel")}>
            {RESTRICTED_CAPS.map(([key, label]) => {
              const caps =
                (get("restricted_user_capabilities") as Record<
                  string,
                  boolean
                > | null) ?? {};
              return (
                <Checkbox
                  key={key}
                  label={t(label)}
                  checked={caps[key] ?? false}
                  onChange={(_, d) =>
                    set("restricted_user_capabilities", {
                      ...caps,
                      [key]: !!d.checked,
                    })
                  }
                />
              );
            })}
          </CheckGrid>
          <Text size={200} className={styles.muted}>
            {t("admin.restrictedCapsNote")}
          </Text>
        </SettingsBody>
      </SettingsCard>
    </>
  );
}
