// Admin site settings — customization, integrations, captcha, etc.

import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Dropdown,
  Field,
  Input,
  MessageBar,
  Option,
  Spinner,
  Switch,
  Tab,
  TabList,
  Text,
  Textarea,
  Title3,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../lib/api";
import { useAuthStore } from "../../store/auth";
import type { SiteConfig } from "../../types";
import { ImageUrlInput } from "../../components/ImageUrlInput";
import { SkeletonFormCard } from "../../components/Skeletons";

const useStyles = makeStyles({
  card: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "8px",
    padding: "24px",
    background: tokens.colorNeutralBackground2,
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  form: { display: "flex", flexDirection: "column", gap: "12px" },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
    alignItems: "start",
    "& > *": {
      minWidth: 0,
    },
    "& input": {
      width: "100%",
      boxSizing: "border-box",
    },
    "@media (max-width: 600px)": {
      gridTemplateColumns: "1fr",
    },
  },
  tabsWrap: {
    minWidth: 0,
    overflowX: "auto",
    overflowY: "hidden",
    WebkitOverflowScrolling: "touch",
  },
  tabs: {
    minWidth: "max-content",
  },
  actions: { display: "flex", gap: "8px", marginTop: "4px" },
});

export function AdminSettings() {
  const styles = useStyles();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { clearAuth } = useAuthStore();
  const { t } = useTranslation();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-config"],
    queryFn: api.adminConfig,
  });

  const { data: oauthSourcesData } = useQuery({
    queryKey: ["admin-oauth-sources"],
    queryFn: api.adminListOAuthSources,
  });
  const telegramSources = (oauthSourcesData?.sources ?? []).filter(
    (s) => s.provider === "telegram" && s.enabled,
  );
  const config = data?.config as SiteConfig | undefined;

  const [localConfig, setLocalConfig] = useState<Partial<SiteConfig>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [tab, setTab] = useState("general");
  const [testingEmail, setTestingEmail] = useState(false);
  const [testingEmailReceiving, setTestingEmailReceiving] = useState(false);
  const [emailSubTab, setEmailSubTab] = useState("send");
  const [resetting, setResetting] = useState(false);
  const [migratingCodes, setMigratingCodes] = useState(false);
  const [migratingSecrets, setMigratingSecrets] = useState(false);
  const [migratingTeamsAsUsers, setMigratingTeamsAsUsers] = useState(false);

  const { data: secretsStatus, refetch: refetchSecretsStatus } = useQuery({
    queryKey: ["admin-secrets-status"],
    queryFn: api.adminSecretsStatus,
  });

  const { data: teamsAsUsersStatus, refetch: refetchTeamsAsUsersStatus } =
    useQuery({
      queryKey: ["admin-teams-as-users-status"],
      queryFn: api.adminTeamsAsUsersStatus,
    });

  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const get = <K extends keyof SiteConfig>(key: K): SiteConfig[K] => {
    if (key in localConfig) return localConfig[key] as SiteConfig[K];
    return config?.[key] as SiteConfig[K];
  };

  const set = (key: keyof SiteConfig, value: unknown) =>
    setLocalConfig((c) => ({ ...c, [key]: value }));

  const handleTestEmail = async () => {
    setTestingEmail(true);
    try {
      const result = await api.adminTestEmail();
      showMsg("success", result.message);
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.error"),
      );
    } finally {
      setTestingEmail(false);
    }
  };

  const handleTestEmailReceiving = async () => {
    setTestingEmailReceiving(true);
    try {
      const result = await api.adminTestEmailReceiving();
      showMsg("success", result.message);
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.error"),
      );
    } finally {
      setTestingEmailReceiving(false);
    }
  };

  const handleMigrateSecrets = async () => {
    setMigratingSecrets(true);
    try {
      const res = await api.adminMigrateSecrets();
      const total =
        res.encrypted.oauth_apps +
        res.encrypted.oauth_sources +
        res.encrypted.user_github_pats +
        res.encrypted.config_keys.length;
      showMsg("success", t("admin.secretsMigrateSuccess", { count: total }));
      await refetchSecretsStatus();
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("admin.secretsMigrateFailed"),
      );
    } finally {
      setMigratingSecrets(false);
    }
  };

  const handleMigrateRecoveryCodes = async () => {
    setMigratingCodes(true);
    try {
      const res = await api.adminMigrateRecoveryCodes();
      showMsg(
        "success",
        t("admin.migrateRecoveryCodesSuccess", { count: res.migrated }),
      );
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError
          ? err.message
          : t("admin.migrateRecoveryCodesFailed"),
      );
    } finally {
      setMigratingCodes(false);
    }
  };

  const handleMigrateTeamsAsUsers = async () => {
    setMigratingTeamsAsUsers(true);
    try {
      const res = await api.adminMigrateTeamsAsUsers();
      showMsg(
        "success",
        t("admin.migrateTeamsAsUsersSuccess", {
          teams: res.teams_mirrored,
          apps: res.apps_realigned,
        }),
      );
      await refetchTeamsAsUsersStatus();
      await qc.invalidateQueries({ queryKey: ["admin-apps"] });
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError
          ? err.message
          : t("admin.migrateTeamsAsUsersFailed"),
      );
    } finally {
      setMigratingTeamsAsUsers(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      await api.adminReset();
      clearAuth();
      navigate("/init", { replace: true });
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("admin.resetFailed"),
      );
      setResetting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.adminUpdateConfig(localConfig as Record<string, unknown>);
      await qc.invalidateQueries({ queryKey: ["admin-config"] });
      await qc.invalidateQueries({ queryKey: ["site"] });
      setLocalConfig({});
      showMsg("success", t("admin.settingsSaved"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("admin.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <SkeletonFormCard rows={6} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {message && (
        <MessageBar intent={message.type === "success" ? "success" : "error"}>
          {message.text}
        </MessageBar>
      )}

      <div className={styles.tabsWrap}>
        <TabList
          className={styles.tabs}
          selectedValue={tab}
          onTabSelect={(_, d) => setTab(d.value as string)}
        >
          <Tab value="general">{t("admin.generalTab")}</Tab>
          <Tab value="auth">{t("admin.authTab")}</Tab>
          <Tab value="captcha">{t("admin.captchaTab")}</Tab>
          <Tab value="email">{t("admin.emailTab")}</Tab>
          <Tab value="appearance">{t("admin.appearanceTab")}</Tab>
          <Tab value="danger">{t("admin.dangerTab")}</Tab>
        </TabList>
      </div>

      {tab === "general" && (
        <div className={styles.card}>
          <Title3>{t("admin.generalTitle")}</Title3>
          <div className={styles.form}>
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
            <Field label={t("admin.registrationMode")}>
              <Dropdown
                value={
                  get("allow_registration")
                    ? get("invite_only")
                      ? t("admin.regModeInviteOnly")
                      : t("admin.regModeOpen")
                    : t("admin.regModeClosed")
                }
                selectedOptions={[
                  get("allow_registration")
                    ? get("invite_only")
                      ? "invite_only"
                      : "open"
                    : "closed",
                ]}
                onOptionSelect={(_, d) => {
                  if (d.optionValue === "open") {
                    set("allow_registration", true);
                    set("invite_only", false);
                  } else if (d.optionValue === "invite_only") {
                    set("allow_registration", true);
                    set("invite_only", true);
                  } else {
                    set("allow_registration", false);
                    set("invite_only", false);
                  }
                }}
              >
                <Option value="open">{t("admin.regModeOpen")}</Option>
                <Option value="invite_only">
                  {t("admin.regModeInviteOnly")}
                </Option>
                <Option value="closed">{t("admin.regModeClosed")}</Option>
              </Dropdown>
            </Field>
            <Switch
              label={t("admin.requireEmailVerification")}
              checked={!!get("require_email_verification")}
              onChange={(_, d) => set("require_email_verification", d.checked)}
            />
            <Field
              label={t("admin.socialVerifyTtl")}
              hint={t("admin.socialVerifyTtlHint")}
            >
              <Input
                type="number"
                min={0}
                value={String(get("social_verify_ttl_days") ?? 0)}
                onChange={(_, d) =>
                  set("social_verify_ttl_days", parseInt(d.value) || 0)
                }
              />
            </Field>
            <Switch
              label={t("admin.allowAltEmailLogin")}
              checked={get("allow_alt_email_login") ?? true}
              onChange={(_, d) => set("allow_alt_email_login", d.checked)}
            />
            <Switch
              label={t("admin.disableUserCreateTeam")}
              checked={!!get("disable_user_create_team")}
              onChange={(_, d) => set("disable_user_create_team", d.checked)}
            />
            <Switch
              label={t("admin.disableUserCreateApp")}
              checked={!!get("disable_user_create_app")}
              onChange={(_, d) => set("disable_user_create_app", d.checked)}
            />
            <Field
              label={t("admin.ipv6RateLimitPrefix")}
              hint={t("admin.ipv6RateLimitPrefixHint")}
            >
              <Input
                type="number"
                min={1}
                max={128}
                value={String(get("ipv6_rate_limit_prefix") ?? 64)}
                onChange={(e) =>
                  set("ipv6_rate_limit_prefix", Number(e.target.value))
                }
                style={{ width: 100 }}
              />
            </Field>
          </div>
        </div>
      )}

      {tab === "general" && (
        <div className={styles.card}>
          <Title3>{t("admin.publicProfilesTitle")}</Title3>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {t("admin.publicProfilesDesc")}
          </Text>
          <div className={styles.form}>
            <Switch
              label={t("admin.enablePublicProfiles")}
              checked={get("enable_public_profiles") ?? true}
              onChange={(_, d) => set("enable_public_profiles", d.checked)}
            />
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {t("admin.publicProfilesFieldDefaultsHint")}
            </Text>
            <Switch
              label={t("admin.defaultProfileShowDisplayName")}
              checked={get("default_profile_show_display_name") ?? true}
              disabled={!(get("enable_public_profiles") ?? true)}
              onChange={(_, d) =>
                set("default_profile_show_display_name", d.checked)
              }
            />
            <Switch
              label={t("admin.defaultProfileShowAvatar")}
              checked={get("default_profile_show_avatar") ?? true}
              disabled={!(get("enable_public_profiles") ?? true)}
              onChange={(_, d) => set("default_profile_show_avatar", d.checked)}
            />
            <Switch
              label={t("admin.defaultProfileShowEmail")}
              checked={get("default_profile_show_email") ?? false}
              disabled={!(get("enable_public_profiles") ?? true)}
              onChange={(_, d) => set("default_profile_show_email", d.checked)}
            />
            <Switch
              label={t("admin.defaultProfileShowJoinedAt")}
              checked={get("default_profile_show_joined_at") ?? true}
              disabled={!(get("enable_public_profiles") ?? true)}
              onChange={(_, d) =>
                set("default_profile_show_joined_at", d.checked)
              }
            />
            <Switch
              label={t("admin.defaultProfileShowGpgKeys")}
              checked={get("default_profile_show_gpg_keys") ?? true}
              disabled={!(get("enable_public_profiles") ?? true)}
              onChange={(_, d) =>
                set("default_profile_show_gpg_keys", d.checked)
              }
            />
            <Switch
              label={t("admin.defaultProfileShowAuthorizedApps")}
              checked={get("default_profile_show_authorized_apps") ?? false}
              disabled={!(get("enable_public_profiles") ?? true)}
              onChange={(_, d) =>
                set("default_profile_show_authorized_apps", d.checked)
              }
            />
            <Switch
              label={t("admin.defaultProfileShowOwnedApps")}
              checked={get("default_profile_show_owned_apps") ?? true}
              disabled={!(get("enable_public_profiles") ?? true)}
              onChange={(_, d) =>
                set("default_profile_show_owned_apps", d.checked)
              }
            />
            <Switch
              label={t("admin.defaultProfileShowDomains")}
              checked={get("default_profile_show_domains") ?? true}
              disabled={!(get("enable_public_profiles") ?? true)}
              onChange={(_, d) =>
                set("default_profile_show_domains", d.checked)
              }
            />
            <Switch
              label={t("admin.defaultProfileShowJoinedTeams")}
              checked={get("default_profile_show_joined_teams") ?? false}
              disabled={!(get("enable_public_profiles") ?? true)}
              onChange={(_, d) =>
                set("default_profile_show_joined_teams", d.checked)
              }
            />
            <Switch
              label={t("admin.defaultProfileShowReadme")}
              checked={get("default_profile_show_readme") ?? true}
              disabled={!(get("enable_public_profiles") ?? true)}
              onChange={(_, d) => set("default_profile_show_readme", d.checked)}
            />
            <Field
              label={t("admin.profileReadmeMaxBytes")}
              hint={t("admin.profileReadmeMaxBytesHint")}
            >
              <Input
                type="number"
                min={1024}
                max={1024 * 1024}
                value={String(get("profile_readme_max_bytes") ?? 64 * 1024)}
                disabled={!(get("enable_public_profiles") ?? true)}
                onChange={(_, d) => {
                  const n = parseInt(d.value, 10);
                  if (Number.isFinite(n)) set("profile_readme_max_bytes", n);
                }}
              />
            </Field>
            <Field
              label={t("admin.githubReadmeToken")}
              hint={t("admin.githubReadmeTokenHint")}
            >
              <Input
                type="password"
                value={String(get("github_readme_token") ?? "")}
                disabled={!(get("enable_public_profiles") ?? true)}
                placeholder="ghp_… (optional)"
                onChange={(_, d) => set("github_readme_token", d.value)}
              />
            </Field>
            <Field
              label={t("admin.githubReadmeCacheTtl")}
              hint={t("admin.githubReadmeCacheTtlHint")}
            >
              <Input
                type="number"
                min={60}
                max={7 * 86400}
                value={String(get("github_readme_cache_ttl_seconds") ?? 3600)}
                disabled={!(get("enable_public_profiles") ?? true)}
                onChange={(_, d) => {
                  const n = parseInt(d.value, 10);
                  if (Number.isFinite(n))
                    set("github_readme_cache_ttl_seconds", n);
                }}
              />
            </Field>
            <Text
              size={200}
              style={{
                color: tokens.colorNeutralForeground3,
                marginTop: 8,
                marginBottom: -4,
              }}
            >
              {t("admin.teamProfileDefaultsHint")}
            </Text>
            <Switch
              label={t("admin.defaultTeamProfileShowDescription")}
              checked={get("default_team_profile_show_description") ?? true}
              disabled={!(get("enable_public_profiles") ?? true)}
              onChange={(_, d) =>
                set("default_team_profile_show_description", d.checked)
              }
            />
            <Switch
              label={t("admin.defaultTeamProfileShowAvatar")}
              checked={get("default_team_profile_show_avatar") ?? true}
              disabled={!(get("enable_public_profiles") ?? true)}
              onChange={(_, d) =>
                set("default_team_profile_show_avatar", d.checked)
              }
            />
            <Switch
              label={t("admin.defaultTeamProfileShowOwner")}
              checked={get("default_team_profile_show_owner") ?? false}
              disabled={!(get("enable_public_profiles") ?? true)}
              onChange={(_, d) =>
                set("default_team_profile_show_owner", d.checked)
              }
            />
            <Switch
              label={t("admin.defaultTeamProfileShowMemberCount")}
              checked={get("default_team_profile_show_member_count") ?? true}
              disabled={!(get("enable_public_profiles") ?? true)}
              onChange={(_, d) =>
                set("default_team_profile_show_member_count", d.checked)
              }
            />
            <Switch
              label={t("admin.defaultTeamProfileShowApps")}
              checked={get("default_team_profile_show_apps") ?? true}
              disabled={!(get("enable_public_profiles") ?? true)}
              onChange={(_, d) =>
                set("default_team_profile_show_apps", d.checked)
              }
            />
            <Switch
              label={t("admin.defaultTeamProfileShowDomains")}
              checked={get("default_team_profile_show_domains") ?? true}
              disabled={!(get("enable_public_profiles") ?? true)}
              onChange={(_, d) =>
                set("default_team_profile_show_domains", d.checked)
              }
            />
            <Switch
              label={t("admin.defaultTeamProfileShowMembers")}
              checked={get("default_team_profile_show_members") ?? false}
              disabled={!(get("enable_public_profiles") ?? true)}
              onChange={(_, d) =>
                set("default_team_profile_show_members", d.checked)
              }
            />
          </div>
        </div>
      )}

      {tab === "auth" && (
        <div className={styles.card}>
          <Title3>{t("admin.authTitle")}</Title3>
          <div className={styles.form}>
            <div className={styles.row}>
              <Field label={t("admin.sessionTtl")}>
                <Input
                  type="number"
                  value={String(get("session_ttl_days") ?? 30)}
                  onChange={(e) =>
                    set("session_ttl_days", parseInt(e.target.value))
                  }
                />
              </Field>
              <Field label={t("admin.accessTokenTtl")}>
                <Input
                  type="number"
                  value={String(get("access_token_ttl_minutes") ?? 60)}
                  onChange={(e) =>
                    set("access_token_ttl_minutes", parseInt(e.target.value))
                  }
                />
              </Field>
            </div>
            <div className={styles.row}>
              <Field label={t("admin.refreshTokenTtl")}>
                <Input
                  type="number"
                  value={String(get("refresh_token_ttl_days") ?? 30)}
                  onChange={(e) =>
                    set("refresh_token_ttl_days", parseInt(e.target.value))
                  }
                />
              </Field>
              <Field label={t("admin.domainReverify")}>
                <Input
                  type="number"
                  value={String(get("domain_reverify_days") ?? 30)}
                  onChange={(e) =>
                    set("domain_reverify_days", parseInt(e.target.value))
                  }
                />
              </Field>
            </div>
            <Field
              label={t("admin.loginErrorRetentionDays")}
              hint={t("admin.loginErrorRetentionDaysHint")}
            >
              <Input
                type="number"
                value={String(get("login_error_retention_days") ?? 30)}
                onChange={(e) =>
                  set("login_error_retention_days", parseInt(e.target.value))
                }
              />
            </Field>
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
            <Field
              label={t("admin.sudoModeTtl")}
              hint={t("admin.sudoModeTtlHint")}
            >
              <Input
                type="number"
                value={String(get("sudo_mode_ttl_minutes") ?? 5)}
                onChange={(e) =>
                  set(
                    "sudo_mode_ttl_minutes",
                    Math.max(0, parseInt(e.target.value) || 0),
                  )
                }
              />
            </Field>
            <Field hint={t("admin.requireCaptchaFor2faHint")}>
              <Switch
                label={t("admin.requireCaptchaFor2fa")}
                checked={!!get("require_captcha_for_2fa")}
                onChange={(_, d) => set("require_captcha_for_2fa", d.checked)}
              />
            </Field>
          </div>
        </div>
      )}

      {tab === "captcha" && (
        <div className={styles.card}>
          <Title3>{t("admin.captchaTitle")}</Title3>
          <div className={styles.form}>
            <Field label={t("admin.captchaProvider")}>
              <Dropdown
                value={get("captcha_provider") ?? "none"}
                selectedOptions={[get("captcha_provider") ?? "none"]}
                onOptionSelect={(_, d) =>
                  set("captcha_provider", d.optionValue)
                }
              >
                <Option value="none">{t("admin.captchaNone")}</Option>
                <Option value="turnstile">{t("admin.captchaTurnstile")}</Option>
                <Option value="hcaptcha">{t("admin.captchaHcaptcha")}</Option>
                <Option value="recaptcha">{t("admin.captchaRecaptcha")}</Option>
                <Option value="pow">{t("admin.captchaPow")}</Option>
              </Dropdown>
            </Field>
            {get("captcha_provider") !== "none" &&
              get("captcha_provider") !== "pow" && (
                <>
                  <Field label={t("admin.captchaSiteKey")}>
                    <Input
                      value={get("captcha_site_key") ?? ""}
                      onChange={(e) => set("captcha_site_key", e.target.value)}
                    />
                  </Field>
                  <Field label={t("admin.captchaSecretKey")}>
                    <Input
                      type="password"
                      value={get("captcha_secret_key") ?? ""}
                      onChange={(e) =>
                        set("captcha_secret_key", e.target.value)
                      }
                    />
                  </Field>
                </>
              )}
            {get("captcha_provider") === "pow" && (
              <Field label={t("admin.powDifficulty")}>
                <Input
                  type="number"
                  value={String(get("pow_difficulty") ?? 20)}
                  onChange={(e) =>
                    set("pow_difficulty", parseInt(e.target.value))
                  }
                />
              </Field>
            )}
          </div>
        </div>
      )}

      {tab === "email" && (
        <div className={styles.card}>
          <Title3>{t("admin.emailTitle")}</Title3>
          <TabList
            size="small"
            selectedValue={emailSubTab}
            onTabSelect={(_, d) => setEmailSubTab(d.value as string)}
            style={{ marginBottom: 4 }}
          >
            <Tab value="send">{t("admin.emailSendTab")}</Tab>
            <Tab value="receive">{t("admin.emailReceiveTab")}</Tab>
            <Tab value="telegram">{t("admin.emailTelegramTab")}</Tab>
          </TabList>

          {emailSubTab === "send" && (
            <div className={styles.form}>
              <Field label={t("admin.emailProvider")}>
                <Dropdown
                  value={get("email_provider") ?? "none"}
                  selectedOptions={[get("email_provider") ?? "none"]}
                  onOptionSelect={(_, d) =>
                    set("email_provider", d.optionValue)
                  }
                >
                  <Option value="none">{t("admin.emailNone")}</Option>
                  <Option value="resend">{t("admin.emailResend")}</Option>
                  <Option value="mailchannels">
                    {t("admin.emailMailchannels")}
                  </Option>
                  <Option value="smtp">{t("admin.emailSmtp")}</Option>
                </Dropdown>
              </Field>
              {(get("email_provider") === "resend" ||
                get("email_provider") === "mailchannels") && (
                <Field label={t("admin.emailApiKey")}>
                  <Input
                    type="password"
                    value={get("email_api_key") ?? ""}
                    onChange={(e) => set("email_api_key", e.target.value)}
                    placeholder={t("admin.unchanged")}
                  />
                </Field>
              )}
              {get("email_provider") === "smtp" && (
                <>
                  <Field label={t("admin.smtpHost")}>
                    <Input
                      value={get("smtp_host") ?? ""}
                      onChange={(e) => set("smtp_host", e.target.value)}
                      placeholder={t("admin.smtpHostPlaceholder")}
                    />
                  </Field>
                  <Field label={t("admin.smtpPort")}>
                    <Input
                      type="number"
                      value={String(get("smtp_port") ?? 587)}
                      onChange={(e) => set("smtp_port", Number(e.target.value))}
                    />
                  </Field>
                  <Field label={t("admin.smtpEncryption")}>
                    <Dropdown
                      value={get("smtp_secure") ? "ssl" : "starttls"}
                      selectedOptions={[
                        get("smtp_secure") ? "ssl" : "starttls",
                      ]}
                      onOptionSelect={(_, d) =>
                        set("smtp_secure", d.optionValue === "ssl")
                      }
                    >
                      <Option value="starttls">
                        {t("admin.smtpStarttls")}
                      </Option>
                      <Option value="ssl">{t("admin.smtpSsl")}</Option>
                    </Dropdown>
                  </Field>
                  <Field label={t("admin.smtpUsername")}>
                    <Input
                      value={get("smtp_user") ?? ""}
                      onChange={(e) => set("smtp_user", e.target.value)}
                      placeholder="user@example.com"
                    />
                  </Field>
                  <Field label={t("admin.smtpPassword")}>
                    <Input
                      type="password"
                      value={get("smtp_password") ?? ""}
                      onChange={(e) => set("smtp_password", e.target.value)}
                      placeholder={t("admin.unchanged")}
                    />
                  </Field>
                </>
              )}
              <Field label={t("admin.emailFrom")}>
                <Input
                  value={get("email_from") ?? ""}
                  onChange={(e) => set("email_from", e.target.value)}
                  placeholder={t("admin.emailFromPlaceholder")}
                />
              </Field>
              {get("email_provider") !== "none" && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button onClick={handleTestEmail} disabled={testingEmail}>
                    {testingEmail ? (
                      <Spinner size="tiny" />
                    ) : (
                      t("admin.sendTestEmail")
                    )}
                  </Button>
                  <Text
                    size={200}
                    style={{
                      color: tokens.colorNeutralForeground3,
                      alignSelf: "center",
                    }}
                  >
                    {t("admin.testEmailDesc")}
                  </Text>
                </div>
              )}
            </div>
          )}

          {emailSubTab === "receive" && (
            <div className={styles.form}>
              <Field label={t("admin.emailVerifyMethods")}>
                <Dropdown
                  value={
                    get("email_verify_methods") === "link"
                      ? t("admin.verifyMethodLink")
                      : get("email_verify_methods") === "send"
                        ? t("admin.verifyMethodSend")
                        : t("admin.verifyMethodBoth")
                  }
                  selectedOptions={[get("email_verify_methods") ?? "both"]}
                  onOptionSelect={(_, d) =>
                    set("email_verify_methods", d.optionValue)
                  }
                >
                  <Option value="both">{t("admin.verifyMethodBoth")}</Option>
                  <Option value="link">{t("admin.verifyMethodLink")}</Option>
                  <Option value="send">{t("admin.verifyMethodSend")}</Option>
                </Dropdown>
              </Field>
              <Field label={t("admin.emailReceiveProvider")}>
                <Dropdown
                  value={
                    get("email_receive_provider") === "imap"
                      ? t("admin.receiveImap")
                      : get("email_receive_provider") === "none"
                        ? t("admin.receiveNone")
                        : t("admin.receiveCloudflare")
                  }
                  selectedOptions={[
                    get("email_receive_provider") ?? "cloudflare",
                  ]}
                  onOptionSelect={(_, d) =>
                    set("email_receive_provider", d.optionValue)
                  }
                >
                  <Option value="cloudflare">
                    {t("admin.receiveCloudflare")}
                  </Option>
                  <Option value="imap">{t("admin.receiveImap")}</Option>
                  <Option value="none">{t("admin.receiveNone")}</Option>
                </Dropdown>
              </Field>
              <Field
                label={t("admin.emailReceiveHost")}
                hint={t("admin.emailReceiveHostHint")}
              >
                <Input
                  value={get("email_receive_host") ?? ""}
                  onChange={(e) => set("email_receive_host", e.target.value)}
                  placeholder="mail.example.com"
                />
              </Field>
              {get("email_receive_provider") === "imap" && (
                <>
                  <Field label={t("admin.imapHost")}>
                    <Input
                      value={get("imap_host") ?? ""}
                      onChange={(e) => set("imap_host", e.target.value)}
                      placeholder="imap.example.com"
                    />
                  </Field>
                  <Field label={t("admin.imapPort")}>
                    <Input
                      type="number"
                      value={String(get("imap_port") ?? 993)}
                      onChange={(e) => set("imap_port", Number(e.target.value))}
                    />
                  </Field>
                  <Field label={t("admin.imapEncryption")}>
                    <Dropdown
                      value={get("imap_secure") ? "ssl" : "starttls"}
                      selectedOptions={[
                        get("imap_secure") ? "ssl" : "starttls",
                      ]}
                      onOptionSelect={(_, d) =>
                        set("imap_secure", d.optionValue === "ssl")
                      }
                    >
                      <Option value="ssl">{t("admin.imapSsl")}</Option>
                      <Option value="starttls">
                        {t("admin.imapStarttls")}
                      </Option>
                    </Dropdown>
                  </Field>
                  <Field label={t("admin.imapUsername")}>
                    <Input
                      value={get("imap_user") ?? ""}
                      onChange={(e) => set("imap_user", e.target.value)}
                      placeholder="user@example.com"
                    />
                  </Field>
                  <Field label={t("admin.imapPassword")}>
                    <Input
                      type="password"
                      value={get("imap_password") ?? ""}
                      onChange={(e) => set("imap_password", e.target.value)}
                      placeholder={t("admin.unchanged")}
                    />
                  </Field>
                </>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button
                  appearance="outline"
                  onClick={handleTestEmailReceiving}
                  disabled={testingEmailReceiving}
                >
                  {testingEmailReceiving ? (
                    <Spinner size="tiny" />
                  ) : (
                    t("admin.testEmailReceiving")
                  )}
                </Button>
              </div>
            </div>
          )}

          {emailSubTab === "telegram" && (
            <div className={styles.form}>
              <Text style={{ color: tokens.colorNeutralForeground3 }}>
                {t("admin.tgNotifyDesc")}
              </Text>
              <Field label={t("admin.tgNotifyBot")}>
                <Dropdown
                  value={
                    telegramSources.find(
                      (s) => s.slug === (get("tg_notify_source_slug") ?? ""),
                    )?.name ?? t("admin.tgNotifyNone")
                  }
                  selectedOptions={[get("tg_notify_source_slug") ?? ""]}
                  onOptionSelect={(_, d) =>
                    set("tg_notify_source_slug", d.optionValue)
                  }
                >
                  <Option value="">{t("admin.tgNotifyNone")}</Option>
                  {telegramSources.map((s) => (
                    <Option key={s.slug} value={s.slug}>
                      {s.name}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
              {telegramSources.length === 0 && (
                <Text
                  size={200}
                  style={{ color: tokens.colorNeutralForeground3 }}
                >
                  {t("admin.tgNotifyNoSources")}
                </Text>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "appearance" && (
        <div className={styles.card}>
          <Title3>{t("admin.appearanceTitle")}</Title3>
          <div className={styles.form}>
            <Field label={t("admin.accentColor")}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="color"
                  value={get("accent_color") ?? "#0078d4"}
                  onChange={(e) => set("accent_color", e.target.value)}
                  style={{
                    width: 48,
                    height: 36,
                    border: "none",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                />
                <Input
                  value={get("accent_color") ?? "#0078d4"}
                  onChange={(e) => set("accent_color", e.target.value)}
                  style={{ flex: 1 }}
                />
              </div>
            </Field>
            <Field label={t("admin.customCss")} hint={t("admin.customCssHint")}>
              <Textarea
                value={get("custom_css") ?? ""}
                onChange={(e) => set("custom_css", e.target.value)}
                rows={8}
                placeholder=":root { /* custom styles */ }"
              />
            </Field>
          </div>
        </div>
      )}

      {tab === "danger" && (
        <div
          className={styles.card}
          style={{ borderColor: tokens.colorPaletteRedBorder2 }}
        >
          <Title3>{t("admin.dangerTitle")}</Title3>
          <Text>{t("admin.dangerDesc")}</Text>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              alignItems: "flex-start",
            }}
          >
            <Text weight="semibold">{t("admin.secretsMigrateTitle")}</Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {t("admin.secretsMigrateDesc")}
            </Text>
            {secretsStatus && (
              <Text
                size={200}
                style={{
                  color: secretsStatus.binding_configured
                    ? tokens.colorNeutralForeground2
                    : tokens.colorPaletteYellowForeground1,
                  fontFamily: "monospace",
                }}
              >
                {secretsStatus.binding_configured
                  ? t("admin.secretsMigrateStatusBound", {
                      apps: secretsStatus.oauth_apps_plaintext,
                      sources: secretsStatus.oauth_sources_plaintext,
                      pats: secretsStatus.user_github_pats_plaintext,
                      cfg: secretsStatus.config_sensitive_plaintext,
                    })
                  : t("admin.secretsMigrateStatusUnbound")}
              </Text>
            )}
            <Button
              appearance="outline"
              onClick={handleMigrateSecrets}
              disabled={
                migratingSecrets ||
                !secretsStatus?.binding_configured ||
                (secretsStatus.oauth_apps_plaintext === 0 &&
                  secretsStatus.oauth_sources_plaintext === 0 &&
                  secretsStatus.user_github_pats_plaintext === 0 &&
                  secretsStatus.config_sensitive_plaintext === 0)
              }
              icon={migratingSecrets ? <Spinner size="tiny" /> : undefined}
            >
              {t("admin.secretsMigrateButton")}
            </Button>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              alignItems: "flex-start",
            }}
          >
            <Text weight="semibold">
              {t("admin.migrateRecoveryCodesTitle")}
            </Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {t("admin.migrateRecoveryCodesDesc")}
            </Text>
            <Button
              appearance="outline"
              onClick={handleMigrateRecoveryCodes}
              disabled={migratingCodes}
              icon={migratingCodes ? <Spinner size="tiny" /> : undefined}
            >
              {t("admin.migrateRecoveryCodes")}
            </Button>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              alignItems: "flex-start",
            }}
          >
            <Text weight="semibold">{t("admin.migrateTeamsAsUsersTitle")}</Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {t("admin.migrateTeamsAsUsersDesc")}
            </Text>
            {teamsAsUsersStatus && (
              <Text
                size={200}
                style={{ color: tokens.colorNeutralForeground3 }}
              >
                {t("admin.migrateTeamsAsUsersStatus", {
                  mirrored: teamsAsUsersStatus.teams_mirrored,
                  teamsTotal: teamsAsUsersStatus.teams_total,
                  aligned: teamsAsUsersStatus.team_apps_aligned,
                  appsTotal: teamsAsUsersStatus.team_apps_total,
                })}
              </Text>
            )}
            <Button
              appearance="outline"
              onClick={handleMigrateTeamsAsUsers}
              disabled={
                migratingTeamsAsUsers ||
                (!!teamsAsUsersStatus &&
                  teamsAsUsersStatus.teams_mirrored ===
                    teamsAsUsersStatus.teams_total &&
                  teamsAsUsersStatus.team_apps_aligned ===
                    teamsAsUsersStatus.team_apps_total)
              }
              icon={migratingTeamsAsUsers ? <Spinner size="tiny" /> : undefined}
            >
              {t("admin.migrateTeamsAsUsersButton")}
            </Button>
          </div>
          <div>
            <Dialog>
              <DialogTrigger disableButtonEnhancement>
                <Button
                  appearance="primary"
                  style={{ background: tokens.colorPaletteRedBackground3 }}
                >
                  {t("admin.resetEverything")}
                </Button>
              </DialogTrigger>
              <DialogSurface>
                <DialogBody>
                  <DialogTitle>{t("admin.resetEverythingTitle")}</DialogTitle>
                  <DialogContent>
                    {t("admin.resetEverythingDesc")}
                  </DialogContent>
                  <DialogActions>
                    <DialogTrigger disableButtonEnhancement>
                      <Button appearance="secondary">
                        {t("common.cancel")}
                      </Button>
                    </DialogTrigger>
                    <Button
                      appearance="primary"
                      style={{ background: tokens.colorPaletteRedBackground3 }}
                      onClick={handleReset}
                      disabled={resetting}
                    >
                      {resetting ? (
                        <Spinner size="tiny" />
                      ) : (
                        t("admin.yesResetEverything")
                      )}
                    </Button>
                  </DialogActions>
                </DialogBody>
              </DialogSurface>
            </Dialog>
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <Button
          appearance="primary"
          onClick={handleSave}
          disabled={saving || Object.keys(localConfig).length === 0}
        >
          {saving ? <Spinner size="tiny" /> : t("admin.saveSettings")}
        </Button>
        {Object.keys(localConfig).length > 0 && (
          <Button onClick={() => setLocalConfig({})}>
            {t("common.discard")}
          </Button>
        )}
      </div>
    </div>
  );
}
