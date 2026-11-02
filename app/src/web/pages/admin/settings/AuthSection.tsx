// Settings → Sign-in & security: sessions and tokens, sign-in rate limits, and
// verification.

import { Field, Textarea } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import {
  SettingsBody,
  SettingsCard,
  SettingsRow,
} from "../../../components/Settings";
import { useSettingsStyles } from "./styles";
import { NumberInput } from "./fields";
import { useSettingRows, type SectionProps } from "./shared";

// Login rate limits: attempts allowed per window, with their defaults.
const LOGIN_RATE_LIMITS = [
  [
    "login_dos_rate_limit",
    "login_dos_rate_window_seconds",
    "admin.loginDosRateLimit",
    120,
    60,
  ],
  [
    "login_ip_rate_limit",
    "login_ip_rate_window_seconds",
    "admin.loginIpRateLimit",
    60,
    60,
  ],
  [
    "login_identifier_rate_limit",
    "login_identifier_rate_window_seconds",
    "admin.loginIdentifierRateLimit",
    30,
    300,
  ],
  [
    "login_totp_rate_limit",
    "login_totp_rate_window_seconds",
    "admin.loginTotpRateLimit",
    15,
    300,
  ],
] as const;

export function AuthSection({ draft }: SectionProps) {
  const { t } = useTranslation();
  const styles = useSettingsStyles();
  const { get, set, num } = draft;
  const { numberRow, required, unit } = useSettingRows(draft);

  return (
    <>
      <SettingsCard id="admin.cardSessions" title={t("admin.cardSessions")}>
        {numberRow("session_ttl_days", 30, "admin.sessionTtl", {
          unit: unit.days,
          min: 1,
        })}
        {numberRow("access_token_ttl_minutes", 60, "admin.accessTokenTtl", {
          unit: unit.minutes,
          min: 1,
        })}
        {numberRow("refresh_token_ttl_days", 30, "admin.refreshTokenTtl", {
          unit: unit.days,
          min: 1,
        })}
        {numberRow("sudo_mode_ttl_minutes", 5, "admin.sudoModeTtl", {
          descKey: "admin.sudoModeTtlHint",
          unit: unit.minutes,
          min: 0,
        })}
      </SettingsCard>
      <SettingsCard
        id="admin.cardSignInProtection"
        title={t("admin.cardSignInProtection")}
        description={t("admin.loginRateLimitsHint")}
      >
        {LOGIN_RATE_LIMITS.map(
          ([limitKey, windowKey, label, defaultLimit, defaultWindow]) => (
            <SettingsRow key={limitKey} label={t(label)}>
              <NumberInput
                label={t("admin.loginRateLimitAttempts")}
                value={num(limitKey, defaultLimit)}
                onChange={(n) => set(limitKey, n)}
                unit={t("admin.unitAttempts")}
                min={1}
                max={86400}
              />
              <span className={styles.unit}>{t("admin.ratePer")}</span>
              <NumberInput
                label={t("admin.loginRateLimitWindow")}
                value={num(windowKey, defaultWindow)}
                onChange={(n) => set(windowKey, n)}
                unit={unit.seconds}
                min={1}
                max={86400}
              />
            </SettingsRow>
          ),
        )}
        {numberRow("ipv6_rate_limit_prefix", 64, "admin.ipv6RateLimitPrefix", {
          descKey: "admin.ipv6RateLimitPrefixHint",
          min: 1,
          max: 128,
        })}
        {required(
          "require_captcha_for_2fa",
          "admin.requireCaptchaFor2fa",
          "admin.requireCaptchaFor2faHint",
        )}
        {numberRow(
          "login_error_retention_days",
          30,
          "admin.loginErrorRetentionDays",
          {
            descKey: "admin.loginErrorRetentionDaysHint",
            unit: unit.days,
            min: 0,
          },
        )}
      </SettingsCard>
      <SettingsCard
        id="admin.cardVerification"
        title={t("admin.cardVerification")}
      >
        {numberRow("domain_reverify_days", 30, "admin.domainReverify", {
          unit: unit.days,
          min: 1,
        })}
        <SettingsBody>
          <Field
            label={t("admin.gpgChallengePrefix")}
            hint={t("admin.gpgChallengePrefixHint")}
          >
            <Textarea
              value={(get("gpg_challenge_prefix") as string) ?? ""}
              onChange={(e) => set("gpg_challenge_prefix", e.target.value)}
              placeholder={t("admin.gpgChallengePrefixPlaceholder")}
              rows={3}
            />
          </Field>
        </SettingsBody>
      </SettingsCard>
    </>
  );
}
