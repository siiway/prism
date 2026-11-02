// Admin overview: what needs attention, instance-wide usage, recent activity
// and the key settings at a glance. Built from the same overview pieces as
// the account dashboard, and every query shares its cache entry with the
// page it summarises, so opening those pages afterwards costs nothing.

import {
  Button,
  MessageBar,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  ErrorCircleRegular,
  HistoryRegular,
  LockOpenRegular,
  MailErrorRegular,
  PersonRegular,
  ShieldErrorRegular,
} from "@fluentui/react-icons";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useApi } from "../../lib/api-context";
import { shortTime } from "../../lib/datetime";
import { SkeletonStatCards } from "../../components/Skeletons";
import {
  Callout,
  Callouts,
  ListColumn,
  ListGrid,
  ListRow,
  Metric,
  MetricGrid,
  SectionTitle,
  SummaryList,
  SummaryRow,
} from "../../components/Overview";
import type { AdminStats } from "../../lib/api";

const LIST_LIMIT = 5;

interface LoginErrorRow {
  id: string;
  error_code: string;
  identifier: string | null;
  ip_address: string | null;
  created_at: number;
}

interface AttentionItem {
  key: "email" | "captcha" | "secrets";
  icon: ReactNode;
  to: string;
}

const useStyles = makeStyles({
  spark: {
    display: "block",
    width: "100%",
    height: "28px",
    color: tokens.colorBrandForeground1,
    overflow: "visible",
  },
});

function Sparkline({ values, label }: { values: number[]; label: string }) {
  const styles = useStyles();
  const width = 200;
  const height = 28;
  const max = Math.max(1, ...values);
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const y = height - 1 - (value / max) * (height - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className={styles.spark}
    >
      <title>{label}</title>
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function AdminDashboard() {
  const api = useApi();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const stats = useQuery({
    queryKey: ["admin-stats"],
    queryFn: api.adminStats,
  });
  const { data: configData } = useQuery({
    queryKey: ["admin-config"],
    queryFn: api.adminConfig,
  });
  const { data: secrets } = useQuery({
    queryKey: ["admin-secrets-status"],
    queryFn: api.adminSecretsStatus,
  });
  // Same keys as the first, unfiltered page of each list page.
  const users = useQuery({
    queryKey: ["admin-users", 1, ""],
    queryFn: () => api.adminListUsers(1, 20, ""),
  });
  const audit = useQuery({
    queryKey: ["audit-events", "platform", 1, { from: "", to: "" }],
    queryFn: () => api.auditEvents("platform", { page: 1 }),
  });
  const loginErrors = useQuery({
    queryKey: ["admin-login-errors", 1, "", "", ""],
    queryFn: () => api.adminLoginErrors(1),
  });

  const config = configData?.config;
  const o = (key: string, opts?: Record<string, unknown>) =>
    t(`admin.overviewPage.${key}`, opts);

  // ── Needs attention ──────────────────────────────────────────────────
  const plaintextSecrets = secrets
    ? secrets.oauth_apps_plaintext +
      secrets.oauth_sources_plaintext +
      secrets.user_github_pats_plaintext +
      secrets.config_sensitive_plaintext
    : 0;
  const captchaProviders = (config?.captcha_providers ?? []).filter(
    (p) => p !== "none",
  );

  const attention: AttentionItem[] = [];
  if (config?.email_provider === "none") {
    attention.push({
      key: "email",
      icon: <MailErrorRegular />,
      to: "/admin/settings/email",
    });
  }
  if (config && captchaProviders.length === 0) {
    attention.push({
      key: "captcha",
      icon: <ShieldErrorRegular />,
      to: "/admin/settings/captcha",
    });
  }
  // Only actionable once the encryption key is bound; until then the
  // Danger Zone migration can't run either.
  if (secrets?.binding_configured && plaintextSecrets > 0) {
    attention.push({
      key: "secrets",
      icon: <LockOpenRegular />,
      to: "/admin/settings/danger",
    });
  }

  // ── Configuration summary ────────────────────────────────────────────
  const onOff = (on: boolean | undefined) => ({
    value: config ? (on ? o("on") : o("off")) : "—",
    dim: !on,
  });
  const registration = !config
    ? "—"
    : !config.allow_registration
      ? o("regClosed")
      : config.invite_only
        ? o("regInviteOnly")
        : o("regOpen");
  const emailLabel: Record<string, string> = {
    resend: t("admin.emailResend"),
    mailchannels: "MailChannels",
    smtp: t("admin.emailSmtp"),
  };
  const emailOff = !config || config.email_provider === "none";

  const cards: {
    key: keyof Omit<AdminStats, "trends">;
    label: string;
    to: string;
    trend?: keyof AdminStats["trends"];
  }[] = [
    {
      key: "users",
      label: t("admin.totalUsers"),
      to: "/admin/users",
      trend: "users",
    },
    {
      key: "teams",
      label: t("admin.totalTeams"),
      to: "/admin/teams",
      trend: "teams",
    },
    {
      key: "apps",
      label: t("admin.totalApps"),
      to: "/admin/apps",
      trend: "apps",
    },
    {
      key: "verified_domains",
      label: t("admin.verifiedDomains"),
      to: "/admin/domains",
      trend: "verified_domains",
    },
    { key: "active_tokens", label: t("admin.activeTokens"), to: "/admin/apps" },
    ...(stats.data?.proxied_images !== undefined
      ? [
          {
            key: "proxied_images" as const,
            label: t("admin.proxiedImages"),
            to: "/admin/image-proxy",
          },
        ]
      : []),
  ];

  const errors = (loginErrors.data?.errors ?? []) as LoginErrorRow[];

  return (
    <div>
      {attention.length > 0 && (
        <Callouts>
          {attention.map((a) => (
            <Callout
              key={a.key}
              icon={a.icon}
              title={o(`${a.key}Title`)}
              description={o(`${a.key}Desc`, { count: plaintextSecrets })}
              action={
                <Button onClick={() => navigate(a.to)}>
                  {o(`${a.key}Action`)}
                </Button>
              }
            />
          ))}
        </Callouts>
      )}

      {stats.isLoading ? (
        <SkeletonStatCards count={6} />
      ) : stats.isError || !stats.data ? (
        <MessageBar intent="error">
          {t("admin.statsError")}{" "}
          <Button
            size="small"
            disabled={stats.isFetching}
            onClick={() => void stats.refetch()}
          >
            {t("common.retry")}
          </Button>
        </MessageBar>
      ) : (
        <MetricGrid columns={3}>
          {cards.map(({ key, label, to, trend }) => (
            <Metric
              key={key}
              to={to}
              label={label}
              value={(stats.data[key] ?? 0).toLocaleString()}
              footer={
                trend && (
                  <Sparkline
                    values={stats.data.trends[trend]}
                    label={`${label}: ${t("admin.newLast30Days")}`}
                  />
                )
              }
            />
          ))}
        </MetricGrid>
      )}

      <SectionTitle>{o("recent")}</SectionTitle>
      <ListGrid>
        <ListColumn
          title={o("newestUsers")}
          to="/admin/users"
          count={users.data?.total}
          empty={o("noUsers")}
          loading={users.isLoading}
        >
          {(users.data?.users ?? []).slice(0, LIST_LIMIT).map((u) => (
            <ListRow
              key={u.id}
              to={`/admin/users/${u.id}`}
              icon={<PersonRegular />}
              label={u.display_name || u.username}
              meta={u.created_at ? shortTime(u.created_at) : undefined}
            />
          ))}
        </ListColumn>

        <ListColumn
          title={o("adminActivity")}
          to="/admin/audit"
          empty={o("noActivity")}
          loading={audit.isLoading}
        >
          {(audit.data?.events ?? []).slice(0, LIST_LIMIT).map((ev) => (
            <ListRow
              key={ev.id}
              to="/admin/audit"
              icon={<HistoryRegular />}
              label={ev.action}
              meta={shortTime(ev.created_at)}
            />
          ))}
        </ListColumn>

        <ListColumn
          title={o("failedSignIns")}
          to="/admin/login-errors"
          count={loginErrors.data?.total}
          empty={o("noFailedSignIns")}
          loading={loginErrors.isLoading}
        >
          {errors.slice(0, LIST_LIMIT).map((e) => (
            <ListRow
              key={e.id}
              to="/admin/login-errors"
              icon={<ErrorCircleRegular />}
              label={e.identifier || e.ip_address || "—"}
              meta={t(`admin.loginErrors.error_${e.error_code}`, {
                defaultValue: e.error_code,
              })}
            />
          ))}
        </ListColumn>
      </ListGrid>

      <SectionTitle>{o("configuration")}</SectionTitle>
      <SummaryList>
        <SummaryRow
          to="/admin/settings/signup"
          label={o("cfgRegistration")}
          value={registration}
        />
        <SummaryRow
          to="/admin/settings/signup"
          label={o("cfgEmailVerification")}
          {...onOff(config?.require_email_verification)}
        />
        <SummaryRow
          to="/admin/settings/email"
          label={o("cfgEmail")}
          value={
            emailOff
              ? o("notSet")
              : (emailLabel[config.email_provider] ?? config.email_provider)
          }
          dim={emailOff}
        />
        <SummaryRow
          to="/admin/settings/captcha"
          label={o("cfgCaptcha")}
          value={
            captchaProviders.length === 0
              ? o("notSet")
              : captchaProviders.map((p) => t(`admin.captcha_${p}`)).join(", ")
          }
          dim={captchaProviders.length === 0}
        />
        <SummaryRow
          to="/admin/settings/profiles"
          label={o("cfgProfiles")}
          {...onOff(config?.enable_public_profiles)}
        />
        <SummaryRow
          to="/admin/settings/teams"
          label={o("cfgSubTeams")}
          {...onOff(config?.enable_sub_teams)}
        />
        <SummaryRow
          to="/admin/settings/general"
          label={o("cfgSecurityContact")}
          value={config?.security_contact || o("notSet")}
          dim={!config?.security_contact}
        />
        <SummaryRow
          to="/admin/settings/general"
          label={o("cfgSsr")}
          {...onOff(config ? !config.disable_ssr : undefined)}
        />
      </SummaryList>
    </div>
  );
}
