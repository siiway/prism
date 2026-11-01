// Resources: what the account owns or belongs to — personal apps, domains,
// teams — and its notification routing.

import { Avatar, Badge, Button, Spinner } from "@fluentui/react-components";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../../lib/api";
import { useApi } from "../../../lib/api-context";
import { formatDate } from "../../../lib/datetime";
import { RoleBadge } from "../../../components/RoleBadge";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsLinkRow,
  SettingsRow,
} from "../../../components/Settings";
import { SkeletonSettingsCard } from "../../../components/Skeletons";
import { RemovableCard } from "./RemovableCard";
import type { UserTabProps } from "./types";

interface PersonalApp {
  id: string;
  name: string;
  client_id: string;
  is_active: number | boolean;
  created_at: number;
}

export function ResourcesTab({ userId, apps, showMsg, confirm }: UserTabProps) {
  const api = useApi();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [resetting, setResetting] = useState(false);

  const domains = useQuery({
    queryKey: ["admin-user-domains", userId],
    queryFn: () => api.adminUserDomains(userId),
  });
  const teams = useQuery({
    queryKey: ["admin-user-teams", userId],
    queryFn: () => api.adminUserTeams(userId),
  });
  const notifications = useQuery({
    queryKey: ["admin-user-notifications", userId],
    queryFn: () => api.adminUserNotifications(userId),
  });

  const resetNotifications = async () => {
    const ok = await confirm({
      title: t("admin.userPage.resetRulesTitle"),
      body: t("admin.userPage.resetRulesBody"),
      confirmLabel: t("admin.resetNotificationRules"),
    });
    if (!ok) return;
    setResetting(true);
    try {
      await api.adminResetUserNotifications(userId);
      await qc.invalidateQueries({
        queryKey: ["admin-user-notifications", userId],
      });
      showMsg("success", t("admin.notificationRulesResetDone"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.error"),
      );
    } finally {
      setResetting(false);
    }
  };

  const personalApps = apps as PersonalApp[];

  return (
    <>
      <SettingsCard id="apps" title={t("admin.userPage.appsTitle")}>
        {personalApps.length === 0 ? (
          <SettingsEmpty>{t("admin.userPage.noApps")}</SettingsEmpty>
        ) : (
          personalApps.map((app) => (
            <SettingsLinkRow
              key={app.id}
              to={`/apps/${app.id}`}
              icon={<Avatar size={32} shape="square" name={app.name} />}
              label={
                <>
                  {app.name}
                  {!app.is_active && (
                    <Badge appearance="tint" color="danger" size="small">
                      {t("admin.disabledStatus")}
                    </Badge>
                  )}
                </>
              }
              description={app.client_id}
              meta={formatDate(app.created_at)}
            />
          ))
        )}
      </SettingsCard>

      <SettingsCard id="teams" title={t("admin.teamsSection")}>
        {!teams.data ? (
          <SettingsEmpty>
            <Spinner size="tiny" />
          </SettingsEmpty>
        ) : teams.data.teams.length === 0 ? (
          <SettingsEmpty>{t("admin.noTeams")}</SettingsEmpty>
        ) : (
          // Memberships change on the team itself, which a site admin can
          // open for any team.
          teams.data.teams.map((team) => (
            <SettingsLinkRow
              key={team.id}
              to={`/teams/${team.id}`}
              icon={
                <Avatar
                  size={32}
                  name={team.name}
                  image={team.avatar_url ? { src: team.avatar_url } : undefined}
                />
              }
              label={team.name}
              description={t("admin.userPage.joinedOn", {
                date: formatDate(team.joined_at),
              })}
              meta={<RoleBadge role={team.role} />}
            />
          ))
        )}
      </SettingsCard>

      <RemovableCard
        id="domains"
        title={t("admin.domainsSection")}
        rows={domains.data?.domains.map((row) => ({
          id: row.id,
          name: row.domain,
          description: `${
            row.verified
              ? t("admin.verifiedStatus")
              : t("admin.unverifiedStatus")
          } · ${t("admin.userPage.addedOn", { date: formatDate(row.created_at) })}`,
        }))}
        emptyText={t("admin.noDomains")}
        removeLabel={t("common.remove")}
        onRemove={(domainId) => api.adminRemoveUserDomain(userId, domainId)}
        doneText={t("common.removedDone")}
        showMsg={showMsg}
        confirm={confirm}
      />

      {/* Counts, not contents: someone who stopped getting emails needs to
          know whether a ruleset is active, not which addresses get what. */}
      {!notifications.data ? (
        <SkeletonSettingsCard rows={1} />
      ) : (
        <SettingsCard
          id="notifications"
          title={t("admin.notificationsSection")}
          description={t("admin.userPage.notificationsDesc")}
          action={
            <Button
              size="small"
              disabled={resetting || notifications.data.rulesets.length === 0}
              onClick={() => void resetNotifications()}
            >
              {resetting ? (
                <Spinner size="tiny" />
              ) : (
                t("admin.resetNotificationRules")
              )}
            </Button>
          }
        >
          {notifications.data.rulesets.length === 0 ? (
            <SettingsEmpty>
              {t("admin.noRulesets", {
                count: notifications.data.legacy_pref_count,
              })}
            </SettingsEmpty>
          ) : (
            notifications.data.rulesets.map((r) => (
              <SettingsRow
                key={r.id}
                label={
                  <>
                    {r.name}
                    {r.is_active && (
                      <Badge appearance="tint" color="success" size="small">
                        {t("admin.activeStatus")}
                      </Badge>
                    )}
                  </>
                }
                description={
                  r.rule_count < 0
                    ? t("admin.rulesUnreadable")
                    : t("admin.ruleCount", { count: r.rule_count })
                }
              />
            ))
          )}
        </SettingsCard>
      )}
    </>
  );
}
