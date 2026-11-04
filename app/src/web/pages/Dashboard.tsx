// User dashboard overview
//
// Laid out like the Cloudflare account home: short lists of the things the
// user owns (apps, domains) and their recent activity side by side, then a
// row of plain metric cards. Every row links through to the full page.

import { Button } from "@fluentui/react-components";
import {
  AppsRegular,
  GlobeErrorRegular,
  GlobeRegular,
  HistoryRegular,
  KeyMultipleRegular,
  KeyResetRegular,
  LockClosedRegular,
  MailRegular,
  ShieldErrorRegular,
} from "@fluentui/react-icons";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useApi } from "../lib/api-context";
import { useAuthStore } from "../store/auth";
import { PageHeader } from "../components/PageHeader";
import { SkeletonStatCards } from "../components/Skeletons";
import {
  Callout,
  Callouts,
  ListColumn,
  ListGrid,
  ListRow,
  Metric,
  MetricGrid,
  MetricSuffix,
  SectionTitle,
} from "../components/Overview";
import { shortTime } from "../lib/datetime";
import { GetStarted } from "./dashboard/GetStarted";

const LIST_LIMIT = 5;
// Warn about backup codes at this many left, and tokens this close to expiry.
const LOW_BACKUP_CODES = 2;
const TOKEN_EXPIRY_WARNING = 7 * 86_400;

export function Dashboard() {
  const api = useApi();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { t } = useTranslation();

  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
  });
  const { data: appsData, isLoading: appsLoading } = useQuery({
    queryKey: ["apps"],
    queryFn: () => api.listApps(),
  });
  const { data: domainsData, isLoading: domainsLoading } = useQuery({
    queryKey: ["domains"],
    queryFn: () => api.listDomains(),
  });
  const { data: connectionsData, isLoading: connectionsLoading } = useQuery({
    queryKey: ["connections"],
    queryFn: api.listConnections,
  });
  const { data: site } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });
  // Same query the sidebar uses to hide features a restricted account lacks.
  const { data: restriction } = useQuery({
    queryKey: ["my-restriction"],
    queryFn: api.myRestriction,
    staleTime: 60_000,
    retry: false,
  });
  // Shares its cache entry with the first page of the audit log.
  const { data: auditData } = useQuery({
    queryKey: ["audit-events", "me", 1, {}],
    queryFn: () => api.auditEvents("me", { page: 1 }),
  });
  // Same entries as the Security page and the first page of Access tokens.
  const { data: totpData } = useQuery({
    queryKey: ["totp-list"],
    queryFn: api.totpList,
    enabled: !!me?.totp_enabled,
  });
  // Counted in select, not during render, so the clock read stays out of
  // the render path.
  const { data: expiringTokens = 0 } = useQuery({
    queryKey: ["pat", 1, ""],
    queryFn: () => api.listTokens({ page: 1, limit: 20 }),
    select: (d) => {
      const now = Math.floor(Date.now() / 1000);
      return d.tokens.filter(
        (tok) =>
          tok.expires_at !== null &&
          tok.expires_at > now &&
          tok.expires_at - now <= TOKEN_EXPIRY_WARNING,
      ).length;
    },
  });

  const isLoading =
    meLoading || appsLoading || domainsLoading || connectionsLoading;

  const showEmailBanner = me?.user.email_verified === false;
  const showSecurityWarning =
    !me?.totp_enabled && (me?.passkey_count ?? 0) === 0;

  const apps = appsData?.apps ?? [];
  const domains = domainsData?.domains ?? [];
  const events = auditData?.events ?? [];
  const verifiedDomains = domains.filter((d) => d.verified).length;

  const displayName = user?.display_name?.trim();

  const restrictedCaps = restriction?.restricted
    ? restriction.capabilities
    : null;

  // A brand-new account has nothing to list yet, so instead of empty lists
  // and zeroed metrics it gets a getting-started view. Decided only once
  // both lists have loaded, so existing accounts never flash it.
  const isNewAccount =
    appsData?.total === 0 && domainsData?.total === 0 && !!me;

  // Things worth doing, most urgent first. Each shows only while it applies.
  // Only with 2FA on: the Security page caches this list for everyone, and
  // without an authenticator it reports 0 codes, which means nothing.
  const backupCodesLeft = me?.totp_enabled
    ? totpData?.backup_codes_remaining
    : undefined;
  const unverifiedDomains = domains.filter((d) => !d.verified).length;

  const task = (
    key: string,
    icon: ReactNode,
    title: string,
    description: string,
    action: string,
    to: string,
  ) => (
    <Callout
      key={key}
      icon={icon}
      title={title}
      description={description}
      action={<Button onClick={() => navigate(to)}>{action}</Button>}
    />
  );

  const tasks = (includeSecurity: boolean): ReactNode[] =>
    [
      showEmailBanner &&
        task(
          "email",
          <MailRegular />,
          t("dashboard.verifyEmailTitle"),
          t("dashboard.verifyEmailDesc"),
          t("dashboard.verifyNow"),
          "/verify-choose",
        ),
      restriction?.restricted &&
        task(
          "restricted",
          <LockClosedRegular />,
          t("dashboard.restrictedTitle"),
          t("dashboard.restrictedDesc"),
          t("dashboard.restrictedAction"),
          "/security",
        ),
      includeSecurity &&
        showSecurityWarning &&
        task(
          "security",
          <ShieldErrorRegular />,
          t("dashboard.improveSecurityTitle"),
          t("dashboard.improveSecurityDesc"),
          t("dashboard.setUp2FA"),
          "/security#authenticators",
        ),
      backupCodesLeft !== undefined &&
        backupCodesLeft <= LOW_BACKUP_CODES &&
        task(
          "backup-codes",
          <KeyResetRegular />,
          t("dashboard.backupCodesTitle", { count: backupCodesLeft }),
          t("dashboard.backupCodesDesc"),
          t("dashboard.backupCodesAction"),
          "/security#authenticators",
        ),
      expiringTokens > 0 &&
        task(
          "tokens",
          <KeyMultipleRegular />,
          t("dashboard.tokensExpiringTitle", { count: expiringTokens }),
          t("dashboard.tokensExpiringDesc", { count: expiringTokens }),
          t("dashboard.tokensExpiringAction"),
          "/tokens",
        ),
      unverifiedDomains > 0 &&
        task(
          "domains",
          <GlobeErrorRegular />,
          t("dashboard.unverifiedDomainsTitle", { count: unverifiedDomains }),
          t("dashboard.unverifiedDomainsDesc"),
          t("dashboard.unverifiedDomainsAction"),
          "/domains",
        ),
    ].filter(Boolean);

  if (isNewAccount) {
    // The getting-started cards already cover securing the account.
    const newTasks = tasks(false);
    return (
      <div>
        {newTasks.length > 0 && <Callouts>{newTasks}</Callouts>}
        <GetStarted
          siteName={site?.site_name ?? "Prism"}
          canCreateApp={!restrictedCaps || !!restrictedCaps["app:create"]}
          canAddDomain={!restrictedCaps || !!restrictedCaps["domain:create"]}
          secured={!showSecurityWarning}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        tabTitle={t("nav.dashboard")}
        title={
          displayName
            ? t("dashboard.welcomeBack", { name: displayName })
            : t("dashboard.welcomeBackNoName")
        }
        subtitle={t("dashboard.manageDesc")}
      />

      {tasks(true).length > 0 && <Callouts>{tasks(true)}</Callouts>}

      <ListGrid>
        <ListColumn
          title={t("dashboard.applications")}
          to="/apps"
          count={appsData?.total}
          empty={t("dashboard.noAppsShort")}
        >
          {apps.slice(0, LIST_LIMIT).map((app) => (
            <ListRow
              key={app.id}
              to={`/apps/${app.id}`}
              icon={<AppsRegular />}
              label={app.name}
            />
          ))}
        </ListColumn>

        <ListColumn
          title={t("dashboard.domainsCard")}
          to="/domains"
          count={domainsData?.total}
          empty={t("dashboard.noDomainsShort")}
        >
          {domains.slice(0, LIST_LIMIT).map((d) => (
            <ListRow
              key={d.id}
              to="/domains"
              icon={<GlobeRegular />}
              label={d.domain}
              meta={d.verified ? undefined : t("profile.unverified")}
            />
          ))}
        </ListColumn>

        <ListColumn
          title={t("dashboard.recentActivity")}
          to="/audit-log"
          empty={t("dashboard.noActivity")}
        >
          {events.slice(0, LIST_LIMIT).map((ev) => (
            <ListRow
              key={ev.id}
              to="/audit-log"
              icon={<HistoryRegular />}
              label={ev.action}
              meta={shortTime(ev.created_at)}
            />
          ))}
        </ListColumn>
      </ListGrid>

      <SectionTitle>{t("dashboard.overview")}</SectionTitle>
      {isLoading ? (
        <SkeletonStatCards count={4} />
      ) : (
        <MetricGrid>
          <Metric
            to="/apps"
            label={t("dashboard.appsRegistered")}
            value={appsData?.total ?? apps.length}
          />
          <Metric
            to="/domains"
            label={t("dashboard.verifiedDomains")}
            value={
              <>
                {verifiedDomains}
                <MetricSuffix>
                  {" "}
                  / {domainsData?.total ?? domains.length}
                </MetricSuffix>
              </>
            }
          />
          <Metric
            to="/connections"
            label={t("dashboard.connectedPlatforms")}
            value={connectionsData?.connections.length ?? 0}
          />
          <Metric
            to="/security"
            label={t("dashboard.passkeys")}
            value={me?.passkey_count ?? 0}
            caption={
              me?.totp_enabled
                ? t("security.twoFaEnabled")
                : t("security.twoFaOff")
            }
          />
        </MetricGrid>
      )}
    </div>
  );
}
