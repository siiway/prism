// Admin site settings, one section per page (/admin/settings/<section>).
//
// Laid out like the account settings pages: cards of rows, label on the
// left and the control on the right. Every section but Legal and Danger
// Zone edits one draft, saved from the bar that appears once something
// changes. Because nothing applies until that save, there are no switches
// here: a setting with named values gets a segmented choice, a set of
// related options gets a group of checkboxes, and options that only matter
// once something else is on stay hidden until it is.

import {
  Button,
  Checkbox,
  Field,
  Input,
  Link,
  Spinner,
  Text,
  Textarea,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { ArrowDownRegular, ArrowUpRegular } from "@fluentui/react-icons";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { isSettingsSection } from "./adminNav";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import { useConfirm } from "../../lib/useConfirm";
import { useToastMessage } from "../../lib/useToastMessage";
import { useAuthStore } from "../../store/auth";
import type { SiteConfig, CaptchaProvider } from "../../types";
import { ImageUrlInput } from "../../components/ImageUrlInput";
import { PasswordInput } from "../../components/PasswordInput";
import { Segmented } from "../../components/Segmented";
import { Select } from "../../components/Select";
import { SkeletonSettingsPage } from "../../components/Skeletons";
import { ColorPickerInput } from "../../components/ColorPickerInput";
import {
  SettingsBody,
  SettingsCard,
  SettingsFooter,
  SettingsRow,
  SettingsSubhead,
  SettingsToast,
} from "../../components/Settings";

const useStyles = makeStyles({
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "16px",
    alignItems: "start",
    "& > *": { minWidth: 0 },
    "@media (max-width: 640px)": { gridTemplateColumns: "1fr" },
  },
  // Checkboxes in columns; Fluent pads each box, so pull the first column
  // back to the card's text edge.
  checks: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    columnGap: "16px",
    marginLeft: "-8px",
  },
  // The captcha alternates: a tight list, boxes on the text edge.
  alternates: {
    display: "flex",
    flexDirection: "column",
    marginLeft: "-8px",
  },
  alternate: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minHeight: "32px",
  },
  order: { marginLeft: "auto", display: "flex", gap: "2px" },
  // Full width like the other admin pages, not the account pages' column.
  page: { display: "flex", flexDirection: "column", gap: "20px" },
  num: { width: "120px" },
  select: { width: "260px", maxWidth: "100%" },
  unit: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "nowrap",
  },
  muted: { color: tokens.colorNeutralForeground3 },
  status: {
    display: "block",
    marginTop: "4px",
    color: tokens.colorNeutralForeground2,
  },
  warn: { color: tokens.colorPaletteYellowForeground1 },
  danger: {
    background: tokens.colorPaletteRedBackground3,
    ":hover": { background: tokens.colorPaletteRedForeground1 },
    ":hover:active": { background: tokens.colorPaletteRedForeground1 },
  },
  saveBar: {
    position: "sticky",
    bottom: "16px",
    zIndex: 2,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: "8px",
    padding: "12px 16px 12px 24px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusXLarge,
    background: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow8,
  },
  saveBarText: {
    marginRight: "auto",
    color: tokens.colorNeutralForeground2,
  },
});

// Turnstile challenge-endpoint modes, in the order they are offered. Each one
// labels itself from `admin.turnstileEndpoint_<mode>`, so the list stays the
// single place a mode is named.
const TURNSTILE_ENDPOINT_MODES: SiteConfig["turnstile_endpoint_mode"][] = [
  "global",
  "china",
  "client_language",
  "server_region",
  "client_region",
];

// Selectable captcha providers (excludes "none", which is handled separately as
// "captcha off"). Each is labelled from `admin.captcha_<provider>`.
const CAPTCHA_PROVIDERS: CaptchaProvider[] = [
  "turnstile",
  "hcaptcha",
  "recaptcha",
  "pow",
  "geetest",
  "cap",
];

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

/** A copy of `obj` without `key`. */
function dropKey<T extends object>(obj: T, key: string): T {
  const next = { ...obj };
  delete next[key as keyof T];
  return next;
}

/** A number input that may be empty while typing.
 *
 *  `Number("")` is 0, which for a usage cap or a TTL is a live setting, not
 *  a blank; so the draft only takes finite numbers, and what's typed stays
 *  on screen until the field loses focus. */
function NumberInput({
  label,
  value,
  onChange,
  unit,
  min,
  max,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  const styles = useStyles();
  const [text, setText] = useState<string | null>(null);
  return (
    <Input
      type="number"
      className={styles.num}
      aria-label={label}
      min={min}
      max={max}
      disabled={disabled}
      value={text ?? String(value)}
      contentAfter={unit ? <span className={styles.unit}>{unit}</span> : null}
      onChange={(_, d) => {
        setText(d.value);
        const n = Number(d.value);
        if (d.value.trim() !== "" && Number.isFinite(n)) onChange(n);
      }}
      onBlur={() => setText(null)}
    />
  );
}

/** Checkboxes in columns, for a set of related on/off options. */
function CheckGrid({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const styles = useStyles();
  return (
    <div role="group" aria-label={label} className={styles.checks}>
      {children}
    </div>
  );
}

export function AdminSettings() {
  const api = useApi();
  const styles = useStyles();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { clearAuth } = useAuthStore();
  const { t } = useTranslation();
  const { confirm, confirmDialog } = useConfirm();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-config"],
    queryFn: api.adminConfig,
  });

  // Mass session revocation. The preview is what turns the button from a
  // dare into a decision — an operator should know how many people they are
  // about to sign out before they do it.
  const revokePreview = useQuery({
    queryKey: ["admin-revoke-preview"],
    queryFn: () => api.adminRevokePreview(),
  });
  const [revokeIncludeSelf, setRevokeIncludeSelf] = useState(false);

  // The cron tasks, runnable on demand. Awaited server-side, so the result
  // reports what the job actually did rather than that it was queued.
  const maintenanceJobs = useQuery({
    queryKey: ["admin-maintenance-jobs"],
    queryFn: () => api.adminMaintenanceJobs(),
  });
  const [runningJob, setRunningJob] = useState<string | null>(null);
  const runJob = useMutation({
    mutationFn: (key: string) => api.adminRunMaintenanceJob(key),
    onSuccess: (res) => {
      setRunningJob(null);
      showMsg(
        "success",
        res.processed === null
          ? t("admin.jobDone", { ms: res.duration_ms })
          : t("admin.jobDoneCount", {
              count: res.processed,
              ms: res.duration_ms,
            }),
      );
    },
    onError: (err) => {
      setRunningJob(null);
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.error"),
      );
    },
  });
  const revokeSessions = useMutation({
    mutationFn: () => api.adminRevokeAllSessions(revokeIncludeSelf),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["admin-revoke-preview"] });
      showMsg("success", t("admin.revokeSessionsDone", { count: res.deleted }));
      // Revoking your own session leaves the page holding a token the server
      // has already forgotten; clear it rather than let the next request 401.
      if (!res.your_session_kept) {
        clearAuth();
        navigate("/login");
      }
    },
    onError: (err) =>
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.error"),
      ),
  });

  const { data: oauthSourcesData } = useQuery({
    queryKey: ["admin-oauth-sources"],
    queryFn: () => api.adminListOAuthSources(),
  });
  const telegramSources = (oauthSourcesData?.sources ?? []).filter(
    (s) => s.provider === "telegram" && s.enabled,
  );
  const discordSources = (oauthSourcesData?.sources ?? []).filter(
    (s) => s.provider === "discord" && s.enabled,
  );
  const config = data?.config as SiteConfig | undefined;

  // Legal pages live in their own table (not site_config), so they have their
  // own query, draft state, and Save buttons rather than riding the shared
  // config flow below.
  const { data: legalData } = useQuery({
    queryKey: ["admin-legal"],
    queryFn: api.adminLegal,
  });
  const [legalDraft, setLegalDraft] = useState<Partial<Record<string, string>>>(
    {},
  );
  const [savingLegal, setSavingLegal] = useState<string | null>(null);
  const legalDoc = (slug: string) =>
    legalData?.documents.find((d) => d.slug === slug);
  const getLegal = (slug: string) =>
    slug in legalDraft
      ? (legalDraft[slug] ?? "")
      : (legalDoc(slug)?.content ?? "");
  const setLegal = (slug: string, value: string) =>
    setLegalDraft((d) => ({ ...d, [slug]: value }));
  const legalDirty = (slug: string) =>
    slug in legalDraft && legalDraft[slug] !== (legalDoc(slug)?.content ?? "");

  const [localConfig, setLocalConfig] = useState<Partial<SiteConfig>>({});
  const [saving, setSaving] = useState(false);
  const { message, showMsg } = useToastMessage();
  // The section comes from the URL; the sidebar lists them (adminNav.ts).
  const { tab: tabParam } = useParams();
  const tab = isSettingsSection(tabParam) ? tabParam : "general";
  const [testingEmail, setTestingEmail] = useState(false);
  const [testingEmailReceiving, setTestingEmailReceiving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetTotpCode, setResetTotpCode] = useState("");
  // The reset's TOTP step opens inline in its card, not in a dialog.
  const [resetStep, setResetStep] = useState<"request" | "confirm" | null>(
    null,
  );
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const [migrating, setMigrating] = useState<string | null>(null);

  const { data: secretsStatus, refetch: refetchSecretsStatus } = useQuery({
    queryKey: ["admin-secrets-status"],
    queryFn: api.adminSecretsStatus,
  });

  const { data: d1SecretsStatus, refetch: refetchD1SecretsStatus } = useQuery({
    queryKey: ["admin-d1-secrets-status"],
    queryFn: api.adminD1SecretsStatus,
    enabled: tab === "danger",
  });

  const { data: webhooksStatus, refetch: refetchWebhooksStatus } = useQuery({
    queryKey: ["admin-legacy-webhooks-status"],
    queryFn: api.legacyWebhooksStatus,
    enabled: tab === "danger",
  });

  const { data: recoveryCodesStatus, refetch: refetchRecoveryCodesStatus } =
    useQuery({
      queryKey: ["admin-recovery-codes-status"],
      queryFn: api.adminRecoveryCodesStatus,
      enabled: tab === "danger",
    });

  const { data: teamsAsUsersStatus, refetch: refetchTeamsAsUsersStatus } =
    useQuery({
      queryKey: ["admin-teams-as-users-status"],
      queryFn: api.adminTeamsAsUsersStatus,
    });

  const { data: imageProxyStatus, refetch: refetchImageProxyStatus } = useQuery(
    {
      queryKey: ["admin-image-proxy-status"],
      queryFn: api.adminImageProxyStatus,
      enabled: tab === "danger",
    },
  );

  const { data: resetStatus, refetch: refetchResetStatus } = useQuery({
    queryKey: ["admin-reset-status"],
    queryFn: api.adminResetStatus,
    enabled: tab === "danger",
    refetchInterval: tab === "danger" ? 30_000 : false,
  });

  const get = <K extends keyof SiteConfig>(key: K): SiteConfig[K] => {
    if (key in localConfig) return localConfig[key] as SiteConfig[K];
    return config?.[key] as SiteConfig[K];
  };

  const set = (key: keyof SiteConfig, value: unknown) =>
    setLocalConfig((c) => ({ ...c, [key]: value }));

  /** A boolean setting, with the default for a config row that predates it. */
  const flag = (key: keyof SiteConfig, fallback = false): boolean =>
    (get(key) as boolean | null | undefined) ?? fallback;

  /** A numeric setting, with the default for a config row that predates it. */
  const num = (key: keyof SiteConfig, fallback: number): number =>
    (get(key) as number | null | undefined) ?? fallback;

  // Read once — both the dropdown label and its selection need it, and a
  // config row written before the setting existed has no value at all.
  const turnstileMode = get("turnstile_endpoint_mode") ?? "global";
  const capMode = get("cap_mode") ?? "embedded";
  const emailProvider = get("email_provider") ?? "none";
  const receiveProvider = get("email_receive_provider") ?? "cloudflare";
  const subTeams = flag("enable_sub_teams", true);
  const publicProfiles = flag("enable_public_profiles", true);

  // ─── Captcha provider set ──────────────────────────────────────────────────
  // The enabled set is an ordered list: element 0 is the default rendered
  // first, the rest are switchable alternates. "none" is never stored in the
  // list — an empty list means captcha is off.
  const providerList: CaptchaProvider[] = (
    (get("captcha_providers") ?? []) as CaptchaProvider[]
  ).filter((p) => p !== "none");
  const defaultProvider: CaptchaProvider = providerList[0] ?? "none";
  const alternateProviders: CaptchaProvider[] = providerList.slice(1);
  // Display order for the alternates editor: enabled alternates first, in their
  // actual configured order (so the ↑/↓ controls visibly move a row), then the
  // not-yet-enabled providers pinned at the bottom in the canonical order.
  const alternateOptions: CaptchaProvider[] = [
    ...alternateProviders,
    ...CAPTCHA_PROVIDERS.filter(
      (p) => p !== defaultProvider && !alternateProviders.includes(p),
    ),
  ];
  const setProviderList = (list: CaptchaProvider[]) =>
    set("captcha_providers", list);
  // Change the default (element 0). "none" clears the whole set. Otherwise the
  // new default moves to the front and the previous ordering is preserved.
  const setDefaultProvider = (p: CaptchaProvider) => {
    if (p === "none") {
      setProviderList([]);
      return;
    }
    setProviderList([p, ...providerList.filter((x) => x !== p)]);
  };
  const toggleAlternate = (p: CaptchaProvider, on: boolean) => {
    if (on) setProviderList([...providerList, p]);
    else setProviderList(providerList.filter((x) => x !== p));
  };
  // Reorder an alternate. Index 0 (the default) is fixed, so alternates only
  // move within positions 1..n.
  const moveAlternate = (p: CaptchaProvider, dir: -1 | 1) => {
    const idx = providerList.indexOf(p);
    const target = idx + dir;
    if (idx < 1 || target < 1 || target >= providerList.length) return;
    const copy = [...providerList];
    [copy[idx], copy[target]] = [copy[target], copy[idx]];
    setProviderList(copy);
  };

  const fail = (err: unknown, fallback: string) =>
    showMsg("error", err instanceof ApiError ? err.message : t(fallback));

  const handleTestEmail = async () => {
    setTestingEmail(true);
    try {
      await api.adminTestEmail();
      showMsg("success", t("admin.testEmailSentDone"));
    } catch (err) {
      fail(err, "common.error");
    } finally {
      setTestingEmail(false);
    }
  };

  const handleTestEmailReceiving = async () => {
    setTestingEmailReceiving(true);
    try {
      const result = await api.adminTestEmailReceiving();
      showMsg(
        "success",
        t("admin.testEmailSentToDone", { address: result.address }),
      );
    } catch (err) {
      fail(err, "common.error");
    } finally {
      setTestingEmailReceiving(false);
    }
  };

  /** Run one migration: its call, its success text, and its status refresh. */
  const migrate = async (
    key: string,
    run: () => Promise<string>,
    failKey: string,
    refetch: () => Promise<unknown>,
  ) => {
    setMigrating(key);
    try {
      showMsg("success", await run());
      await refetch();
    } catch (err) {
      fail(err, failKey);
    } finally {
      setMigrating(null);
    }
  };

  const handleMigrateSecrets = () =>
    migrate(
      "secrets",
      async () => {
        const res = await api.adminMigrateSecrets();
        const total =
          res.encrypted.oauth_apps +
          res.encrypted.oauth_sources +
          res.encrypted.user_github_pats +
          res.encrypted.config_keys.length;
        return t("admin.secretsMigrateSuccess", { count: total });
      },
      "admin.secretsMigrateFailed",
      refetchSecretsStatus,
    );

  const handleMigrateWebhooks = () =>
    migrate(
      "webhooks",
      async () => {
        const res = await api.migrateLegacyWebhooks();
        return t("admin.webhooksMigrateSuccess", {
          count: res.migrated,
          total: res.total,
        });
      },
      "admin.webhooksMigrateFailed",
      refetchWebhooksStatus,
    );

  const handleMigrateD1Secrets = () =>
    migrate(
      "d1",
      async () => {
        const res = await api.adminMigrateD1Secrets();
        const total = Object.values(res.migrated).reduce((a, b) => a + b, 0);
        return t("admin.d1SecretsMigrateSuccess", { count: total });
      },
      "admin.d1SecretsMigrateFailed",
      refetchD1SecretsStatus,
    );

  const handleMigrateRecoveryCodes = () =>
    migrate(
      "codes",
      async () => {
        const res = await api.adminMigrateRecoveryCodes();
        return t("admin.migrateRecoveryCodesSuccess", { count: res.migrated });
      },
      "admin.migrateRecoveryCodesFailed",
      refetchRecoveryCodesStatus,
    );

  const handleMigrateImageProxy = () =>
    migrate(
      "images",
      async () => {
        const res = await api.adminMigrateImageProxy();
        return t("admin.migrateImageProxySuccess", { count: res.registered });
      },
      "admin.migrateImageProxyFailed",
      refetchImageProxyStatus,
    );

  const handleMigrateTeamsAsUsers = () =>
    migrate(
      "teams",
      async () => {
        const res = await api.adminMigrateTeamsAsUsers();
        await qc.invalidateQueries({ queryKey: ["admin-apps"] });
        return t("admin.migrateTeamsAsUsersSuccess", {
          teams: res.teams_mirrored,
          apps: res.apps_realigned,
        });
      },
      "admin.migrateTeamsAsUsersFailed",
      refetchTeamsAsUsersStatus,
    );

  const closeResetStep = () => {
    setResetStep(null);
    setResetTotpCode("");
  };

  const handleResetRequest = async () => {
    setResetting(true);
    try {
      await api.adminResetRequest({
        totp_code: resetTotpCode.trim() || undefined,
      });
      closeResetStep();
      await refetchResetStatus();
      showMsg("success", t("admin.resetRequested"));
    } catch (err) {
      fail(err, "admin.resetFailed");
    } finally {
      setResetting(false);
    }
  };

  const handleResetCancel = async () => {
    try {
      await api.adminResetCancel();
      closeResetStep();
      await refetchResetStatus();
      showMsg("success", t("admin.resetCancelled"));
    } catch (err) {
      fail(err, "admin.resetFailed");
    }
  };

  const handleResetConfirm = async () => {
    setResetting(true);
    try {
      await api.adminResetConfirm({
        totp_code: resetTotpCode.trim() || undefined,
      });
      clearAuth();
      navigate("/init", { replace: true });
    } catch (err) {
      fail(err, "admin.resetFailed");
      setResetting(false);
    }
  };

  const handleRevokeSessions = async () => {
    const ok = await confirm({
      title: t("admin.revokeSessionsConfirmTitle"),
      body: revokeIncludeSelf
        ? t("admin.revokeSessionsConfirmBodySelf")
        : t("admin.revokeSessionsConfirmBody"),
      confirmLabel: t("admin.revokeSessionsButton"),
    });
    if (ok) revokeSessions.mutate();
  };

  useEffect(() => {
    if (tab !== "danger") return;
    const id = setInterval(
      () => setNowSec(Math.floor(Date.now() / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [tab]);

  const dirty = Object.keys(localConfig).length > 0;

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.adminUpdateConfig(localConfig as Record<string, unknown>);
      await qc.invalidateQueries({ queryKey: ["admin-config"] });
      await qc.invalidateQueries({ queryKey: ["site"] });
      setLocalConfig({});
      showMsg("success", t("admin.settingsSaved"));
    } catch (err) {
      fail(err, "admin.saveFailed");
    } finally {
      setSaving(false);
    }
  };

  // Persist one document, so saving one policy doesn't bump the other's
  // "last updated" date.
  const handleSaveLegal = async (slug: "privacy" | "terms") => {
    setSavingLegal(slug);
    try {
      await api.adminUpdateLegal(slug, legalDraft[slug] ?? "");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin-legal"] }),
        qc.invalidateQueries({ queryKey: ["site"] }),
        qc.invalidateQueries({ queryKey: ["legal"] }),
      ]);
      setLegalDraft((d) => dropKey(d, slug));
      showMsg("success", t("admin.settingsSaved"));
    } catch (err) {
      fail(err, "admin.saveFailed");
    } finally {
      setSavingLegal(null);
    }
  };

  if (isLoading) return <SkeletonSettingsPage cards={[3, 2]} form />;

  // ─── Shared pieces ─────────────────────────────────────────────────────────

  /** A row holding one number setting. */
  const numberRow = (
    key: keyof SiteConfig,
    fallback: number,
    labelKey: string,
    opts: {
      descKey?: string;
      unit?: string;
      min?: number;
      max?: number;
    } = {},
  ) => (
    <SettingsRow
      label={t(labelKey)}
      description={opts.descKey ? t(opts.descKey) : undefined}
    >
      <NumberInput
        label={t(labelKey)}
        value={num(key, fallback)}
        onChange={(n) => set(key, n)}
        unit={opts.unit}
        min={opts.min}
        max={opts.max}
      />
    </SettingsRow>
  );

  /** One checkbox bound to a boolean setting. */
  const check = (
    key: keyof SiteConfig,
    labelKey: string,
    fallback: boolean,
  ) => (
    <Checkbox
      key={key}
      label={t(labelKey)}
      checked={flag(key, fallback)}
      onChange={(_, d) => set(key, !!d.checked)}
    />
  );

  const unit = {
    days: t("admin.unitDays"),
    hours: t("admin.unitHours"),
    minutes: t("admin.unitMinutes"),
    seconds: t("admin.unitSeconds"),
    bytes: t("admin.unitBytes"),
  };

  const required = (
    key: keyof SiteConfig,
    labelKey: string,
    descKey: string,
  ) => (
    <SettingsRow label={t(labelKey)} description={t(descKey)}>
      <Segmented
        label={t(labelKey)}
        value={flag(key) ? "on" : "off"}
        options={[
          { value: "off", label: t("admin.choiceNotRequired") },
          { value: "on", label: t("admin.choiceRequired") },
        ]}
        onChange={(v) => set(key, v === "on")}
      />
    </SettingsRow>
  );

  /** Pick which sign-in source's bot sends a platform's notifications. */
  const notifySource = (
    key: "tg_notify_source_slug" | "discord_notify_source_slug",
    labelKey: string,
    descKey: string,
    noSourcesKey: string,
    sources: { slug: string; name: string }[],
  ) => (
    <SettingsRow
      label={t(labelKey)}
      description={
        sources.length === 0 ? (
          <>
            {t(noSourcesKey)}{" "}
            <Link onClick={() => navigate("/admin/connections")}>
              {t("admin.addOAuthSource")}
            </Link>
          </>
        ) : (
          t(descKey)
        )
      }
    >
      {sources.length > 0 && (
        <Select
          aria-label={t(labelKey)}
          className={styles.select}
          value={get(key) ?? ""}
          onChange={(_, d) => set(key, d.value)}
        >
          <option value="">{t("admin.notifyOff")}</option>
          {sources.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name}
            </option>
          ))}
        </Select>
      )}
    </SettingsRow>
  );

  const d1Plaintext = d1SecretsStatus
    ? d1SecretsStatus.pat_plaintext +
      d1SecretsStatus.oauth_tokens_access_plaintext +
      d1SecretsStatus.oauth_tokens_refresh_plaintext +
      d1SecretsStatus.oauth_codes_plaintext +
      d1SecretsStatus.site_invites_plaintext +
      d1SecretsStatus.team_invites_plaintext +
      d1SecretsStatus.email_verify_users_plaintext +
      d1SecretsStatus.user_emails_verify_plaintext +
      d1SecretsStatus.oauth_2fa_codes_plaintext +
      d1SecretsStatus.totp_authenticators_plaintext +
      d1SecretsStatus.webhooks_plaintext +
      d1SecretsStatus.app_webhooks_plaintext +
      d1SecretsStatus.social_connections_access_plaintext +
      d1SecretsStatus.social_connections_refresh_plaintext
    : 0;

  /** One migration: what it does, where it stands, and its button. */
  const migrationRow = (
    key: string,
    titleKey: string,
    descKey: string,
    status: ReactNode,
    buttonKey: string,
    onRun: () => void,
    done: boolean,
  ) => (
    <SettingsRow
      label={t(titleKey)}
      description={
        <>
          {t(descKey)}
          {status}
        </>
      }
    >
      <Button
        disabled={migrating !== null || done}
        icon={migrating === key ? <Spinner size="tiny" /> : undefined}
        onClick={onRun}
      >
        {t(buttonKey)}
      </Button>
    </SettingsRow>
  );

  const statusLine = (text: string, warn = false) => (
    <span className={mergeClasses(styles.status, warn && styles.warn)}>
      {text}
    </span>
  );

  /** The TOTP step of a reset, inline in the reset card. */
  const resetForm = (
    descKey: string,
    submitKey: string,
    onSubmit: () => void,
  ) => (
    <>
      <SettingsBody>
        <Text>{t(descKey)}</Text>
        {resetStatus?.sudo_active && (
          <Text size={200} className={styles.muted}>
            {t("admin.resetSudoActiveNote")}
          </Text>
        )}
        <Field label={t("admin.totpCode")}>
          <Input
            autoFocus
            value={resetTotpCode}
            onChange={(e) => setResetTotpCode(e.target.value)}
            placeholder={t("admin.totpCodePlaceholder")}
            inputMode="numeric"
            autoComplete="one-time-code"
            className={styles.select}
          />
        </Field>
      </SettingsBody>
      <SettingsFooter>
        <Button disabled={resetting} onClick={closeResetStep}>
          {t("common.cancel")}
        </Button>
        <Button
          appearance="primary"
          className={styles.danger}
          disabled={resetting}
          icon={resetting ? <Spinner size="tiny" /> : undefined}
          onClick={onSubmit}
        >
          {t(submitKey)}
        </Button>
      </SettingsFooter>
    </>
  );

  /** One legal document's editor, with its own save. */
  const legalEditor = (
    slug: "privacy" | "terms",
    labelKey: string,
    placeholderKey: string,
    path: string,
  ) => (
    <>
      <SettingsBody>
        <Field hint={t("admin.legalMarkdownHint")}>
          <Textarea
            aria-label={t(labelKey)}
            value={getLegal(slug)}
            onChange={(e) => setLegal(slug, e.target.value)}
            rows={14}
            resize="vertical"
            placeholder={t(placeholderKey)}
          />
        </Field>
      </SettingsBody>
      <SettingsFooter
        start={
          getLegal(slug)
            ? t("admin.legalPublishedAt", { path })
            : t("admin.legalHiddenWhenEmpty")
        }
      >
        {legalDirty(slug) && savingLegal !== slug && (
          <Button
            appearance="subtle"
            onClick={() => setLegalDraft((d) => dropKey(d, slug))}
          >
            {t("common.discard")}
          </Button>
        )}
        <Button
          appearance="primary"
          onClick={() => void handleSaveLegal(slug)}
          disabled={savingLegal !== null || !legalDirty(slug)}
          icon={savingLegal === slug ? <Spinner size="tiny" /> : undefined}
        >
          {t("common.saveChanges")}
        </Button>
      </SettingsFooter>
    </>
  );

  return (
    <div className={styles.page}>
      <SettingsToast message={message} />

      {tab === "general" && (
        <>
          <SettingsCard id="admin.cardSite" title={t("admin.cardSite")}>
            <SettingsBody>
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
            </SettingsBody>
          </SettingsCard>
          <SettingsCard
            id="admin.securityTxtTitle"
            title={t("admin.securityTxtTitle")}
            description={t("admin.securityTxtDesc")}
          >
            <SettingsBody>
              <Field
                label={t("admin.securityContact")}
                hint={t("admin.securityContactHint")}
              >
                <Input
                  value={get("security_contact") ?? ""}
                  onChange={(e) => set("security_contact", e.target.value)}
                  placeholder="mailto:security@example.com"
                />
              </Field>
              <Field
                label={t("admin.securityPolicyUrl")}
                hint={t("admin.securityPolicyUrlHint")}
              >
                <Input
                  value={get("security_policy_url") ?? ""}
                  onChange={(e) => set("security_policy_url", e.target.value)}
                  placeholder="https://example.com/security-policy"
                />
              </Field>
            </SettingsBody>
          </SettingsCard>
          <SettingsCard id="admin.cardAdvanced" title={t("admin.cardAdvanced")}>
            <SettingsRow
              label={t("admin.disableSsr")}
              description={t("admin.disableSsrHint")}
            >
              <Segmented
                label={t("admin.disableSsr")}
                value={flag("disable_ssr") ? "browser" : "server"}
                options={[
                  { value: "server", label: t("admin.renderServer") },
                  { value: "browser", label: t("admin.renderBrowser") },
                ]}
                onChange={(v) => set("disable_ssr", v === "browser")}
              />
            </SettingsRow>
          </SettingsCard>
        </>
      )}

      {tab === "signup" && (
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
                <option value="invite_only">
                  {t("admin.regModeInviteOnly")}
                </option>
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
      )}

      {tab === "auth" && (
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
            {numberRow(
              "ipv6_rate_limit_prefix",
              64,
              "admin.ipv6RateLimitPrefix",
              {
                descKey: "admin.ipv6RateLimitPrefixHint",
                min: 1,
                max: 128,
              },
            )}
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
      )}

      {tab === "teams" && (
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
      )}

      {tab === "profiles" && (
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
      )}

      {tab === "captcha" && (
        <>
          <SettingsCard id="admin.cardCaptcha" title={t("admin.cardCaptcha")}>
            {/* Default provider — element 0 of the enabled set. "none" turns
                captcha off entirely. */}
            <SettingsRow
              label={t("admin.captchaDefaultProvider")}
              description={t("admin.captchaDefaultProviderHint")}
            >
              <Select
                aria-label={t("admin.captchaDefaultProvider")}
                className={styles.select}
                value={defaultProvider}
                onChange={(_, d) =>
                  setDefaultProvider(d.value as CaptchaProvider)
                }
              >
                <option value="none">{t("admin.captcha_none")}</option>
                {CAPTCHA_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {t(`admin.captcha_${p}`)}
                  </option>
                ))}
              </Select>
            </SettingsRow>
            {/* Switch-reveal timeout applies once ≥2 providers are enabled. */}
            {providerList.length >= 2 &&
              numberRow(
                "captcha_switch_timeout_seconds",
                15,
                "admin.captchaSwitchTimeout",
                {
                  descKey: "admin.captchaSwitchTimeoutHint",
                  unit: unit.seconds,
                  min: 0,
                },
              )}
            {/* Alternates — the switchable set, in the order visitors are
                offered them. */}
            {defaultProvider !== "none" && (
              <SettingsBody>
                <Text size={200} className={styles.muted}>
                  {t("admin.captchaAlternatesHint")}
                </Text>
                <div
                  role="group"
                  aria-label={t("admin.captchaAlternatesHint")}
                  className={styles.alternates}
                >
                  {alternateOptions.map((p) => {
                    const enabled = alternateProviders.includes(p);
                    const pos = alternateProviders.indexOf(p);
                    return (
                      <div key={p} className={styles.alternate}>
                        <Checkbox
                          label={t(`admin.captcha_${p}`)}
                          checked={enabled}
                          onChange={(_, d) => toggleAlternate(p, !!d.checked)}
                        />
                        {enabled && (
                          <span className={styles.unit}>
                            {t("admin.captchaAlternatePosition", {
                              n: pos + 1,
                            })}
                          </span>
                        )}
                        {enabled && alternateProviders.length > 1 && (
                          <span className={styles.order}>
                            <Button
                              size="small"
                              appearance="subtle"
                              icon={<ArrowUpRegular />}
                              disabled={pos <= 0}
                              onClick={() => moveAlternate(p, -1)}
                              aria-label={t("admin.captchaMoveUp")}
                            />
                            <Button
                              size="small"
                              appearance="subtle"
                              icon={<ArrowDownRegular />}
                              disabled={pos >= alternateProviders.length - 1}
                              onClick={() => moveAlternate(p, 1)}
                              aria-label={t("admin.captchaMoveDown")}
                            />
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </SettingsBody>
            )}
          </SettingsCard>

          {/* Credentials for every enabled provider, one card each. */}
          {providerList.map((p) => (
            <SettingsCard key={p} title={t(`admin.captcha_${p}`)}>
              <SettingsBody>
                {p === "turnstile" && (
                  <>
                    <div className={styles.grid}>
                      <Field label={t("admin.captchaSiteKey")}>
                        <Input
                          value={get("turnstile_site_key") ?? ""}
                          onChange={(e) =>
                            set("turnstile_site_key", e.target.value)
                          }
                        />
                      </Field>
                      <Field label={t("admin.captchaSecretKey")}>
                        <PasswordInput
                          value={get("turnstile_secret_key") ?? ""}
                          onChange={(e) =>
                            set("turnstile_secret_key", e.target.value)
                          }
                        />
                      </Field>
                    </div>
                    <Field
                      label={t("admin.turnstileEndpoint")}
                      hint={t("admin.turnstileEndpointHint")}
                    >
                      <Select
                        value={turnstileMode}
                        onChange={(_, d) =>
                          set("turnstile_endpoint_mode", d.value)
                        }
                      >
                        {TURNSTILE_ENDPOINT_MODES.map((mode) => (
                          <option key={mode} value={mode}>
                            {t(`admin.turnstileEndpoint_${mode}`)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {/* The China host needs its own region:"china" widget. */}
                    {turnstileMode !== "global" && (
                      <div className={styles.grid}>
                        <Field
                          label={t("admin.turnstileChinaSiteKey")}
                          hint={t("admin.turnstileChinaSiteKeyHint")}
                        >
                          <Input
                            value={get("turnstile_china_site_key") ?? ""}
                            onChange={(e) =>
                              set("turnstile_china_site_key", e.target.value)
                            }
                          />
                        </Field>
                        <Field label={t("admin.turnstileChinaSecretKey")}>
                          <PasswordInput
                            value={get("turnstile_china_secret_key") ?? ""}
                            onChange={(e) =>
                              set("turnstile_china_secret_key", e.target.value)
                            }
                          />
                        </Field>
                      </div>
                    )}
                  </>
                )}

                {(p === "hcaptcha" || p === "recaptcha") && (
                  <div className={styles.grid}>
                    <Field label={t("admin.captchaSiteKey")}>
                      <Input
                        value={get(`${p}_site_key` as const) ?? ""}
                        onChange={(e) => set(`${p}_site_key`, e.target.value)}
                      />
                    </Field>
                    <Field label={t("admin.captchaSecretKey")}>
                      <PasswordInput
                        value={get(`${p}_secret_key` as const) ?? ""}
                        onChange={(e) => set(`${p}_secret_key`, e.target.value)}
                      />
                    </Field>
                  </div>
                )}

                {p === "pow" && (
                  <Field
                    label={t("admin.powDifficulty")}
                    hint={t("admin.powDifficultyHint")}
                  >
                    <NumberInput
                      label={t("admin.powDifficulty")}
                      value={num("pow_difficulty", 20)}
                      onChange={(n) => set("pow_difficulty", n)}
                      unit={t("admin.unitBits")}
                      min={1}
                    />
                  </Field>
                )}

                {p === "geetest" && (
                  <>
                    <div className={styles.grid}>
                      <Field label={t("admin.geetestCaptchaId")}>
                        <Input
                          value={get("geetest_captcha_id") ?? ""}
                          onChange={(e) =>
                            set("geetest_captcha_id", e.target.value)
                          }
                        />
                      </Field>
                      <Field label={t("admin.geetestCaptchaKey")}>
                        <PasswordInput
                          value={get("geetest_captcha_key") ?? ""}
                          onChange={(e) =>
                            set("geetest_captcha_key", e.target.value)
                          }
                        />
                      </Field>
                    </div>
                    <Checkbox
                      label={t("admin.geetestFailOpen")}
                      checked={flag("geetest_fail_open")}
                      onChange={(_, d) => set("geetest_fail_open", !!d.checked)}
                    />
                  </>
                )}

                {p === "cap" && (
                  <>
                    <Field
                      label={t("admin.capMode")}
                      hint={t("admin.capModeHint")}
                    >
                      <Segmented
                        label={t("admin.capMode")}
                        value={capMode}
                        options={[
                          {
                            value: "embedded",
                            label: t("admin.capMode_embedded"),
                          },
                          {
                            value: "external",
                            label: t("admin.capMode_external"),
                          },
                        ]}
                        onChange={(v) => set("cap_mode", v)}
                      />
                    </Field>
                    {capMode === "external" ? (
                      <>
                        <Field label={t("admin.capApiEndpoint")}>
                          <Input
                            value={get("cap_api_endpoint") ?? ""}
                            onChange={(e) =>
                              set("cap_api_endpoint", e.target.value)
                            }
                          />
                        </Field>
                        <div className={styles.grid}>
                          <Field label={t("admin.captchaSiteKey")}>
                            <Input
                              value={get("cap_site_key") ?? ""}
                              onChange={(e) =>
                                set("cap_site_key", e.target.value)
                              }
                            />
                          </Field>
                          <Field label={t("admin.captchaSecretKey")}>
                            <PasswordInput
                              value={get("cap_secret_key") ?? ""}
                              onChange={(e) =>
                                set("cap_secret_key", e.target.value)
                              }
                            />
                          </Field>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className={styles.grid}>
                          <Field label={t("admin.capChallengeCount")}>
                            <NumberInput
                              label={t("admin.capChallengeCount")}
                              value={num("cap_challenge_count", 50)}
                              onChange={(n) => set("cap_challenge_count", n)}
                              min={1}
                            />
                          </Field>
                          <Field label={t("admin.capChallengeDifficulty")}>
                            <NumberInput
                              label={t("admin.capChallengeDifficulty")}
                              value={num("cap_challenge_difficulty", 4)}
                              onChange={(n) =>
                                set("cap_challenge_difficulty", n)
                              }
                              min={1}
                            />
                          </Field>
                        </div>
                        <Checkbox
                          label={t("admin.capInstrumentation")}
                          checked={flag("cap_instrumentation", true)}
                          onChange={(_, d) =>
                            set("cap_instrumentation", !!d.checked)
                          }
                        />
                      </>
                    )}
                  </>
                )}
              </SettingsBody>
            </SettingsCard>
          ))}
        </>
      )}

      {tab === "email" && (
        <>
          <SettingsCard
            id="admin.cardEmailSending"
            title={t("admin.cardEmailSending")}
          >
            <SettingsBody>
              <Field label={t("admin.emailProvider")}>
                <Select
                  value={emailProvider}
                  onChange={(_, d) => set("email_provider", d.value)}
                >
                  <option value="none">{t("admin.emailNone")}</option>
                  <option value="resend">{t("admin.emailResend")}</option>
                  <option value="mailchannels">
                    {t("admin.emailMailchannels")}
                  </option>
                  <option value="smtp">{t("admin.emailSmtp")}</option>
                </Select>
              </Field>
              {(emailProvider === "resend" ||
                emailProvider === "mailchannels") && (
                <Field label={t("admin.emailApiKey")}>
                  <PasswordInput
                    value={get("email_api_key") ?? ""}
                    onChange={(e) => set("email_api_key", e.target.value)}
                    placeholder={t("admin.unchanged")}
                  />
                </Field>
              )}
              {emailProvider === "smtp" && (
                <>
                  <div className={styles.grid}>
                    <Field label={t("admin.smtpHost")}>
                      <Input
                        value={get("smtp_host") ?? ""}
                        onChange={(e) => set("smtp_host", e.target.value)}
                        placeholder={t("admin.smtpHostPlaceholder")}
                      />
                    </Field>
                    <Field label={t("admin.smtpEncryption")}>
                      <Select
                        value={get("smtp_secure") ? "ssl" : "starttls"}
                        onChange={(_, d) =>
                          set("smtp_secure", d.value === "ssl")
                        }
                      >
                        <option value="starttls">
                          {t("admin.smtpStarttls")}
                        </option>
                        <option value="ssl">{t("admin.smtpSsl")}</option>
                      </Select>
                    </Field>
                  </div>
                  <Field label={t("admin.smtpPort")}>
                    <NumberInput
                      label={t("admin.smtpPort")}
                      value={num("smtp_port", 587)}
                      onChange={(n) => set("smtp_port", n)}
                      min={1}
                      max={65535}
                    />
                  </Field>
                  <div className={styles.grid}>
                    <Field label={t("admin.smtpUsername")}>
                      <Input
                        value={get("smtp_user") ?? ""}
                        onChange={(e) => set("smtp_user", e.target.value)}
                        placeholder="user@example.com"
                      />
                    </Field>
                    <Field label={t("admin.smtpPassword")}>
                      <PasswordInput
                        value={get("smtp_password") ?? ""}
                        onChange={(e) => set("smtp_password", e.target.value)}
                        placeholder={t("admin.unchanged")}
                      />
                    </Field>
                  </div>
                </>
              )}
              <Field label={t("admin.emailFrom")}>
                <Input
                  value={get("email_from") ?? ""}
                  onChange={(e) => set("email_from", e.target.value)}
                  placeholder={t("admin.emailFromPlaceholder")}
                />
              </Field>
            </SettingsBody>
            {emailProvider !== "none" && (
              <SettingsFooter start={t("admin.testEmailDesc")}>
                <Button
                  onClick={handleTestEmail}
                  disabled={testingEmail}
                  icon={testingEmail ? <Spinner size="tiny" /> : undefined}
                >
                  {t("admin.sendTestEmail")}
                </Button>
              </SettingsFooter>
            )}
          </SettingsCard>

          <SettingsCard
            id="admin.cardEmailReceiving"
            title={t("admin.cardEmailReceiving")}
          >
            <SettingsBody>
              <div className={styles.grid}>
                <Field label={t("admin.emailVerifyMethods")}>
                  <Select
                    value={get("email_verify_methods") ?? "both"}
                    onChange={(_, d) => set("email_verify_methods", d.value)}
                  >
                    <option value="both">{t("admin.verifyMethodBoth")}</option>
                    <option value="link">{t("admin.verifyMethodLink")}</option>
                    <option value="send">{t("admin.verifyMethodSend")}</option>
                  </Select>
                </Field>
                <Field label={t("admin.emailReceiveProvider")}>
                  <Select
                    value={receiveProvider}
                    onChange={(_, d) => set("email_receive_provider", d.value)}
                  >
                    <option value="cloudflare">
                      {t("admin.receiveCloudflare")}
                    </option>
                    <option value="imap">{t("admin.receiveImap")}</option>
                    <option value="none">{t("admin.receiveNone")}</option>
                  </Select>
                </Field>
              </div>
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
              {receiveProvider === "imap" && (
                <>
                  <div className={styles.grid}>
                    <Field label={t("admin.imapHost")}>
                      <Input
                        value={get("imap_host") ?? ""}
                        onChange={(e) => set("imap_host", e.target.value)}
                        placeholder="imap.example.com"
                      />
                    </Field>
                    <Field label={t("admin.imapEncryption")}>
                      <Select
                        value={get("imap_secure") ? "ssl" : "starttls"}
                        onChange={(_, d) =>
                          set("imap_secure", d.value === "ssl")
                        }
                      >
                        <option value="ssl">{t("admin.imapSsl")}</option>
                        <option value="starttls">
                          {t("admin.imapStarttls")}
                        </option>
                      </Select>
                    </Field>
                  </div>
                  <Field label={t("admin.imapPort")}>
                    <NumberInput
                      label={t("admin.imapPort")}
                      value={num("imap_port", 993)}
                      onChange={(n) => set("imap_port", n)}
                      min={1}
                      max={65535}
                    />
                  </Field>
                  <div className={styles.grid}>
                    <Field label={t("admin.imapUsername")}>
                      <Input
                        value={get("imap_user") ?? ""}
                        onChange={(e) => set("imap_user", e.target.value)}
                        placeholder="user@example.com"
                      />
                    </Field>
                    <Field label={t("admin.imapPassword")}>
                      <PasswordInput
                        value={get("imap_password") ?? ""}
                        onChange={(e) => set("imap_password", e.target.value)}
                        placeholder={t("admin.unchanged")}
                      />
                    </Field>
                  </div>
                </>
              )}
            </SettingsBody>
            <SettingsFooter>
              <Button
                onClick={handleTestEmailReceiving}
                disabled={testingEmailReceiving}
                icon={
                  testingEmailReceiving ? <Spinner size="tiny" /> : undefined
                }
              >
                {t("admin.testEmailReceiving")}
              </Button>
            </SettingsFooter>
          </SettingsCard>

          <SettingsCard
            id="admin.cardChatNotify"
            title={t("admin.cardChatNotify")}
            description={t("admin.thirdPartyDesc")}
          >
            {notifySource(
              "tg_notify_source_slug",
              "admin.tgNotifyBot",
              "admin.tgNotifyDesc",
              "admin.tgNotifyNoSources",
              telegramSources,
            )}
            {notifySource(
              "discord_notify_source_slug",
              "admin.discordNotifySource",
              "admin.discordNotifyDesc",
              "admin.discordNotifyNoSources",
              discordSources,
            )}
            {!!get("discord_notify_source_slug") && (
              <SettingsBody>
                <Field label={t("admin.discordBotToken")}>
                  <PasswordInput
                    value={get("discord_bot_token") ?? ""}
                    onChange={(e) => set("discord_bot_token", e.target.value)}
                    placeholder={t("admin.unchanged")}
                  />
                </Field>
              </SettingsBody>
            )}
          </SettingsCard>
        </>
      )}

      {tab === "appearance" && (
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
        </SettingsCard>
      )}

      {tab === "legal" && (
        <>
          <SettingsCard
            id="admin.privacyPolicy"
            title={t("admin.privacyPolicy")}
            description={t("admin.legalDesc")}
          >
            {legalEditor(
              "privacy",
              "admin.privacyPolicy",
              "admin.privacyPolicyPlaceholder",
              "/privacy",
            )}
          </SettingsCard>
          <SettingsCard
            id="admin.termsOfService"
            title={t("admin.termsOfService")}
            description={t("admin.legalDesc")}
          >
            {legalEditor(
              "terms",
              "admin.termsOfService",
              "admin.termsOfServicePlaceholder",
              "/terms",
            )}
          </SettingsCard>
        </>
      )}

      {tab === "danger" && (
        <>
          <SettingsCard
            id="admin.cardMigrations"
            title={t("admin.cardMigrations")}
            description={t("admin.cardMigrationsDesc")}
          >
            {migrationRow(
              "secrets",
              "admin.secretsMigrateTitle",
              "admin.secretsMigrateDesc",
              secretsStatus &&
                statusLine(
                  secretsStatus.binding_configured
                    ? t("admin.secretsMigrateStatusBound", {
                        apps: secretsStatus.oauth_apps_plaintext,
                        sources: secretsStatus.oauth_sources_plaintext,
                        pats: secretsStatus.user_github_pats_plaintext,
                        cfg: secretsStatus.config_sensitive_plaintext,
                      })
                    : t("admin.secretsMigrateStatusUnbound"),
                  !secretsStatus.binding_configured,
                ),
              "admin.secretsMigrateButton",
              handleMigrateSecrets,
              !secretsStatus?.binding_configured ||
                secretsStatus.oauth_apps_plaintext +
                  secretsStatus.oauth_sources_plaintext +
                  secretsStatus.user_github_pats_plaintext +
                  secretsStatus.config_sensitive_plaintext ===
                  0,
            )}
            {migrationRow(
              "d1",
              "admin.d1SecretsMigrateTitle",
              "admin.d1SecretsMigrateDesc",
              d1SecretsStatus &&
                statusLine(
                  d1SecretsStatus.binding_configured
                    ? t("admin.d1SecretsMigrateStatusBound", {
                        total: d1Plaintext,
                      })
                    : t("admin.secretsMigrateStatusUnbound"),
                  !d1SecretsStatus.binding_configured,
                ),
              "admin.d1SecretsMigrateButton",
              handleMigrateD1Secrets,
              !d1SecretsStatus?.binding_configured || d1Plaintext === 0,
            )}
            {migrationRow(
              "codes",
              "admin.migrateRecoveryCodesTitle",
              "admin.migrateRecoveryCodesDesc",
              null,
              "admin.migrateRecoveryCodes",
              handleMigrateRecoveryCodes,
              !!recoveryCodesStatus && recoveryCodesStatus.unmigrated === 0,
            )}
            {migrationRow(
              "webhooks",
              "admin.webhooksMigrateTitle",
              "admin.webhooksMigrateDesc",
              null,
              "admin.webhooksMigrateButton",
              handleMigrateWebhooks,
              !!webhooksStatus && webhooksStatus.unmigrated === 0,
            )}
            {migrationRow(
              "teams",
              "admin.migrateTeamsAsUsersTitle",
              "admin.migrateTeamsAsUsersDesc",
              teamsAsUsersStatus &&
                statusLine(
                  t("admin.migrateTeamsAsUsersStatus", {
                    mirrored: teamsAsUsersStatus.teams_mirrored,
                    teamsTotal: teamsAsUsersStatus.teams_total,
                    aligned: teamsAsUsersStatus.team_apps_aligned,
                    appsTotal: teamsAsUsersStatus.team_apps_total,
                  }),
                ),
              "admin.migrateTeamsAsUsersButton",
              handleMigrateTeamsAsUsers,
              !!teamsAsUsersStatus &&
                teamsAsUsersStatus.teams_mirrored ===
                  teamsAsUsersStatus.teams_total &&
                teamsAsUsersStatus.team_apps_aligned ===
                  teamsAsUsersStatus.team_apps_total,
            )}
            {migrationRow(
              "images",
              "admin.migrateImageProxyTitle",
              "admin.migrateImageProxyDesc",
              imageProxyStatus &&
                statusLine(
                  t("admin.migrateImageProxyStatus", {
                    mapped: imageProxyStatus.mapped,
                    discovered: imageProxyStatus.discovered,
                  }),
                ),
              "admin.migrateImageProxyButton",
              handleMigrateImageProxy,
              !!imageProxyStatus &&
                imageProxyStatus.discovered > 0 &&
                imageProxyStatus.mapped >= imageProxyStatus.discovered,
            )}
          </SettingsCard>

          {/* The scheduled jobs, on demand: the same tasks cron runs. */}
          <SettingsCard
            id="admin.maintenanceTitle"
            title={t("admin.maintenanceTitle")}
            description={t("admin.maintenanceDesc", {
              schedule: maintenanceJobs.data?.schedule ?? "0 */6 * * *",
            })}
          >
            {maintenanceJobs.data?.jobs.map((job) => (
              <SettingsRow
                key={job.key}
                label={t(`admin.job_${job.key.replace(/-/g, "_")}`)}
              >
                <Button
                  size="small"
                  disabled={runJob.isPending}
                  icon={
                    runJob.isPending && runningJob === job.key ? (
                      <Spinner size="tiny" />
                    ) : undefined
                  }
                  onClick={() => {
                    setRunningJob(job.key);
                    runJob.mutate(job.key);
                  }}
                >
                  {t("admin.jobRun")}
                </Button>
              </SettingsRow>
            ))}
          </SettingsCard>

          {/* Sign everyone out. Above the site reset because it is the one
              destructive control an operator reaches for during an incident
              rather than at the end of one. */}
          <SettingsCard
            id="admin.revokeSessionsTitle"
            title={t("admin.revokeSessionsTitle")}
            description={t("admin.revokeSessionsDesc", {
              count: revokePreview.data?.sessions ?? 0,
            })}
          >
            <SettingsFooter
              start={
                <Checkbox
                  checked={revokeIncludeSelf}
                  onChange={(_, d) => setRevokeIncludeSelf(!!d.checked)}
                  label={t("admin.revokeIncludeSelf")}
                />
              }
            >
              <Button
                disabled={revokeSessions.isPending}
                icon={
                  revokeSessions.isPending ? <Spinner size="tiny" /> : undefined
                }
                onClick={() => void handleRevokeSessions()}
              >
                {t("admin.revokeSessionsButton")}
              </Button>
            </SettingsFooter>
          </SettingsCard>

          <SettingsCard
            id="admin.resetSectionTitle"
            title={t("admin.resetSectionTitle")}
            description={t("admin.resetSectionDesc")}
          >
            {!resetStatus ? null : !resetStatus.enabled ? (
              <SettingsRow
                label={t("admin.resetDisabledTitle")}
                description={t("admin.resetDisabledDesc")}
              />
            ) : resetStatus.pending ? (
              resetStep === "confirm" ? (
                resetForm(
                  "admin.resetConfirmDialogDesc",
                  "admin.yesResetEverything",
                  () => void handleResetConfirm(),
                )
              ) : (
                <SettingsRow
                  label={t("admin.resetPendingTitle")}
                  description={
                    <>
                      {resetStatus.pending.requested_by_self
                        ? t("admin.resetPendingByYou")
                        : t("admin.resetPendingBy")}{" "}
                      {nowSec >= resetStatus.pending.eligible_at
                        ? t("admin.resetReadyToConfirm")
                        : t("admin.resetEligibleAt", {
                            when: new Date(
                              resetStatus.pending.eligible_at * 1000,
                            ).toLocaleString(),
                          })}
                    </>
                  }
                >
                  <Button
                    disabled={resetting}
                    onClick={() => void handleResetCancel()}
                  >
                    {t("admin.resetCancel")}
                  </Button>
                  <Button
                    appearance="primary"
                    className={styles.danger}
                    disabled={
                      nowSec < resetStatus.pending.eligible_at || resetting
                    }
                    onClick={() => setResetStep("confirm")}
                  >
                    {t("admin.resetConfirm")}
                  </Button>
                </SettingsRow>
              )
            ) : resetStep === "request" ? (
              resetForm(
                "admin.resetRequestDialogDesc",
                "admin.resetRequest",
                () => void handleResetRequest(),
              )
            ) : (
              <SettingsFooter
                start={
                  resetStatus.cooldown_required
                    ? t("admin.resetCooldownNote")
                    : t("admin.resetNoCooldownNote")
                }
              >
                <Button
                  appearance="primary"
                  className={styles.danger}
                  onClick={() => setResetStep("request")}
                >
                  {t("admin.resetRequest")}
                </Button>
              </SettingsFooter>
            )}
          </SettingsCard>
        </>
      )}

      {/* Legal saves its own drafts; Danger Zone only runs actions. */}
      {tab !== "legal" && tab !== "danger" && dirty && (
        <div
          className={styles.saveBar}
          role="region"
          aria-label={t("admin.unsavedChanges")}
        >
          <Text className={styles.saveBarText}>
            {t("admin.unsavedChanges")}
          </Text>
          <Button disabled={saving} onClick={() => setLocalConfig({})}>
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

      {confirmDialog}
    </div>
  );
}
