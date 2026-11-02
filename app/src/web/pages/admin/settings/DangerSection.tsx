// Settings → Danger zone: maintenance jobs, signing everyone out, data
// migrations, and resetting the site. Actions only; nothing here is saved
// from the save bar.

import {
  Button,
  Checkbox,
  Field,
  Input,
  Spinner,
  Text,
  mergeClasses,
} from "@fluentui/react-components";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiErrorText } from "../../../lib/apiError";
import { useApi } from "../../../lib/api-context";
import { useConfirm } from "../../../lib/useConfirm";
import { useAuthStore } from "../../../store/auth";
import {
  SettingsBody,
  SettingsCard,
  SettingsFooter,
  SettingsRow,
} from "../../../components/Settings";
import { useSettingsStyles } from "./styles";
import { useFail, type SectionProps } from "./shared";
import type { MaintenanceJobKey } from "../../../../shared/codes";

const JOB_LABEL_KEYS: Record<MaintenanceJobKey, string> = {
  "reverify-domains": "admin.job_reverify_domains",
  "imap-poll": "admin.job_imap_poll",
  "sweep-sessions": "admin.job_sweep_sessions",
  "sweep-pow": "admin.job_sweep_pow",
  "purge-app-events": "admin.job_purge_app_events",
  "sweep-image-proxy": "admin.job_sweep_image_proxy",
  "reap-pending-registrations": "admin.job_reap_pending_registrations",
  "reap-dissolved-teams": "admin.job_reap_dissolved_teams",
};

export function DangerSection({ showMsg }: SectionProps) {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { clearAuth } = useAuthStore();
  const { t } = useTranslation();
  const styles = useSettingsStyles();
  const { confirm, confirmDialog } = useConfirm();
  const fail = useFail(showMsg);

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
      showMsg("error", apiErrorText(err, t("common.error")));
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
    onError: (err) => showMsg("error", apiErrorText(err, t("common.error"))),
  });

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
  });

  const { data: webhooksStatus, refetch: refetchWebhooksStatus } = useQuery({
    queryKey: ["admin-legacy-webhooks-status"],
    queryFn: api.legacyWebhooksStatus,
  });

  const { data: recoveryCodesStatus, refetch: refetchRecoveryCodesStatus } =
    useQuery({
      queryKey: ["admin-recovery-codes-status"],
      queryFn: api.adminRecoveryCodesStatus,
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
    },
  );

  const { data: resetStatus, refetch: refetchResetStatus } = useQuery({
    queryKey: ["admin-reset-status"],
    queryFn: api.adminResetStatus,
    refetchInterval: 30_000,
  });

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
    const id = setInterval(
      () => setNowSec(Math.floor(Date.now() / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, []);

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

  return (
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
          <SettingsRow key={job.key} label={t(JOB_LABEL_KEYS[job.key])}>
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
                disabled={nowSec < resetStatus.pending.eligible_at || resetting}
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
      {confirmDialog}
    </>
  );
}
