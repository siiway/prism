// User dashboard overview
//
// Laid out like the Cloudflare account home: short lists of the things the
// user owns (apps, domains) and their recent activity side by side, then a
// row of plain metric cards. Every row links through to the full page.

import { Button } from "@fluentui/react-components";
import {
  AppsRegular,
  GlobeRegular,
  HistoryRegular,
  MailRegular,
  ShieldErrorRegular,
} from "@fluentui/react-icons";
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

  const emailCallout = showEmailBanner && (
    <Callout
      icon={<MailRegular />}
      title={t("dashboard.verifyEmailTitle")}
      description={t("dashboard.verifyEmailDesc")}
      action={
        <Button appearance="primary" onClick={() => navigate("/verify-choose")}>
          {t("dashboard.verifyNow")}
        </Button>
      }
    />
  );

  if (isNewAccount) {
    return (
      <div>
        {emailCallout && <Callouts>{emailCallout}</Callouts>}
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
        title={
          displayName
            ? t("dashboard.welcomeBack", { name: displayName })
            : t("dashboard.welcomeBackNoName")
        }
        subtitle={t("dashboard.manageDesc")}
      />

      {(showEmailBanner || showSecurityWarning) && (
        <Callouts>
          {emailCallout}

          {showSecurityWarning && (
            <Callout
              icon={<ShieldErrorRegular />}
              title={t("dashboard.improveSecurityTitle")}
              description={t("dashboard.improveSecurityDesc")}
              action={
                <Button
                  appearance="primary"
                  onClick={() => navigate("/security")}
                >
                  {t("dashboard.setUp2FA")}
                </Button>
              }
            />
          )}
        </Callouts>
      )}

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
            label={t("dashboard.oauthAppsRegistered")}
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
