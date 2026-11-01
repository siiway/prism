// Team detail page: a header, then one tab per area, each built from
// settings cards (see ./detail). The tab lives in the URL (?tab=apps).

import {
  Avatar,
  Badge,
  Breadcrumb,
  BreadcrumbButton,
  BreadcrumbDivider,
  BreadcrumbItem,
  Button,
  MessageBar,
  Tab,
  TabList,
  Text,
  Title2,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { DismissRegular, OpenRegular } from "@fluentui/react-icons";
import { Fragment, useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import { setDocumentPageTitle } from "../../lib/documentTitle";
import { useToastMessage } from "../../lib/useToastMessage";
import { AuditLog } from "../../components/AuditLog";
import { RoleBadge } from "../../components/RoleBadge";
import { SettingsPage, SettingsToast } from "../../components/Settings";
import { SkeletonSettingsPage } from "../../components/Skeletons";
import { useAuthStore } from "../../store/auth";
import { useAdminViewStore } from "../../store/adminView";
import { GroupsTab } from "./GroupsTab";
import { AppsTab } from "./detail/AppsTab";
import { DomainsTab } from "./detail/DomainsTab";
import { MembersTab } from "./detail/MembersTab";
import { SettingsTab } from "./detail/SettingsTab";
import { SubTeamsTab } from "./detail/SubTeamsTab";
import type { TeamTabProps } from "./detail/types";

type TabId =
  | "members"
  | "groups"
  | "apps"
  | "domains"
  | "sub-teams"
  | "audit"
  | "settings";

const useStyles = makeStyles({
  breadcrumb: { marginLeft: "-8px" },
  header: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "16px",
  },
  titles: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    flex: "1 1 240px",
    minWidth: 0,
  },
  titleLine: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "8px",
  },
  title: { letterSpacing: "-0.015em", overflowWrap: "anywhere" },
  muted: { color: tokens.colorNeutralForeground3 },
  banner: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "8px 12px",
  },
  bannerClose: { marginLeft: "auto" },
  tabBar: { borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  // Line the first tab label up with the content edge.
  tabs: { marginLeft: "-10px", overflowX: "auto" },
});

export function TeamDetail() {
  const api = useApi();
  const styles = useStyles();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { message, showMsg } = useToastMessage();
  const isAdmin = useAuthStore((s) => s.user?.role === "admin");
  const {
    normalView,
    setNormalView,
    normalBannerDismissed,
    dismissNormalBanner,
    adminBannerDismissed,
    dismissAdminBanner,
  } = useAdminViewStore();

  // Flip the session-wide site-admin override, then refetch everything so
  // roles, permissions and the banner match the new mode.
  const setView = (normal: boolean) => {
    setNormalView(normal);
    void qc.invalidateQueries();
  };

  const { data, isLoading, isError } = useQuery({
    // Keyed by view mode: the role and the management controls differ
    // between site-admin and normal view, so the two must not share a cache
    // entry. ["team", id] invalidations still match by prefix.
    queryKey: ["team", id, normalView],
    queryFn: () => api.getTeam(id!),
    enabled: !!id,
    // In normal view a non-member admin legitimately gets a 404; don't retry
    // it as if it were a blip.
    retry: (count, err) =>
      !(err instanceof ApiError && err.status === 404) && count < 3,
  });

  const { data: site } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });

  const team = data?.team;

  useEffect(() => {
    if (!team?.name) return;
    setDocumentPageTitle(team.name);
    return () => setDocumentPageTitle(null);
  }, [team?.name]);

  if (isLoading)
    return (
      <SettingsPage>
        <SkeletonSettingsPage cards={[4, 2]} />
      </SettingsPage>
    );

  if (!team) {
    // A site admin in normal view who isn't a member gets the same 404 as
    // anyone else. Offer the way back instead of a dead end.
    if (isAdmin && normalView && (isError || !data))
      return (
        <MessageBar intent="info">
          <div className={styles.banner}>
            <span>{t("teams.normalViewNotMember")}</span>
            <Button size="small" onClick={() => setView(false)}>
              {t("teams.normalViewSwitchBack")}
            </Button>
          </div>
        </MessageBar>
      );
    return <Text>{t("teams.teamNotFound")}</Text>;
  }

  const myRole = team.my_role ?? "member";
  const isOwner = myRole === "owner";
  const isCoOwnerOrAbove = isOwner || myRole === "co-owner";
  const canManage = isCoOwnerOrAbove || myRole === "admin";
  const subTeamsOn = site?.enable_sub_teams ?? true;

  const tabs: { id: TabId; label: string; show: boolean }[] = [
    {
      id: "members",
      label: t("teams.membersTitle"),
      show: true,
    },
    {
      id: "groups",
      label: t("teams.groupsTab"),
      // Visible to the owner while the feature is off, so they can find the
      // switch and see what is already defined.
      show: canManage && (team.enable_groups || isOwner),
    },
    { id: "apps", label: t("teams.appsTab"), show: true },
    { id: "domains", label: t("teams.domainsTab"), show: true },
    { id: "sub-teams", label: t("teams.subTeamsTitle"), show: subTeamsOn },
    { id: "audit", label: t("teams.auditTab"), show: canManage },
    { id: "settings", label: t("teams.settingsTab"), show: canManage },
  ];
  const visible = tabs.filter((x) => x.show);
  const requested = params.get("tab");
  const tab: TabId =
    visible.find((x) => x.id === requested)?.id ?? visible[0].id;
  const selectTab = (next: TabId) => {
    const p = new URLSearchParams(params);
    if (next === "members") p.delete("tab");
    else p.set("tab", next);
    navigate({ search: p.toString() ? `?${p}` : "" }, { replace: true });
  };

  const tabProps: TeamTabProps = {
    team,
    myRole,
    canManage,
    isOwner,
    isCoOwnerOrAbove,
    showMsg,
  };
  const ancestors = [...(team.ancestors ?? [])].reverse();

  return (
    <SettingsPage>
      <Breadcrumb
        size="small"
        className={styles.breadcrumb}
        aria-label={t("teams.breadcrumbLabel")}
      >
        <BreadcrumbItem>
          <BreadcrumbButton onClick={() => navigate("/teams")}>
            {t("teams.title")}
          </BreadcrumbButton>
        </BreadcrumbItem>
        {ancestors.map((a) => (
          <Fragment key={a.id}>
            <BreadcrumbDivider />
            <BreadcrumbItem>
              <BreadcrumbButton onClick={() => navigate(`/teams/${a.id}`)}>
                {a.name}
              </BreadcrumbButton>
            </BreadcrumbItem>
          </Fragment>
        ))}
      </Breadcrumb>

      <div className={styles.header}>
        <Avatar
          image={team.avatar_url ? { src: team.avatar_url } : undefined}
          name={team.name}
          size={48}
        />
        <div className={styles.titles}>
          <div className={styles.titleLine}>
            <Title2 as="h1" className={styles.title}>
              {team.name}
            </Title2>
            <RoleBadge role={myRole} />
            {team.inherited_from && (
              <Tooltip
                content={t("teams.inheritedFromAncestor")}
                relationship="label"
              >
                <Badge appearance="outline" color="informative" size="small">
                  {t("teams.inheritedBadge")}
                </Badge>
              </Tooltip>
            )}
          </div>
          {team.description && (
            <Text className={styles.muted}>{team.description}</Text>
          )}
        </div>
        {team.profile_is_public && (
          <Button
            as="a"
            href={`/t/${team.id}`}
            target="_blank"
            size="small"
            icon={<OpenRegular />}
          >
            {t("teams.viewPublicProfile")}
          </Button>
        )}
      </div>

      {/* A site admin acting through the override is shown as owner. Say
          where that came from, and offer their real membership if any. */}
      {team.site_admin_access && !adminBannerDismissed && (
        <MessageBar intent="warning">
          <div className={styles.banner}>
            <span>{t("teams.siteAdminAccess")}</span>
            {team.my_member_role && (
              <Button size="small" onClick={() => setView(true)}>
                {t("teams.siteAdminSwitchToNormal")}
              </Button>
            )}
            <Button
              appearance="subtle"
              size="small"
              icon={<DismissRegular />}
              aria-label={t("common.close")}
              onClick={dismissAdminBanner}
              className={styles.bannerClose}
            />
          </div>
        </MessageBar>
      )}
      {isAdmin &&
        normalView &&
        !team.site_admin_access &&
        !normalBannerDismissed && (
          <MessageBar intent="info">
            <div className={styles.banner}>
              <span>{t("teams.normalViewActive")}</span>
              <Button size="small" onClick={() => setView(false)}>
                {t("teams.normalViewSwitchBack")}
              </Button>
              <Button
                appearance="subtle"
                size="small"
                icon={<DismissRegular />}
                aria-label={t("common.close")}
                onClick={dismissNormalBanner}
                className={styles.bannerClose}
              />
            </div>
          </MessageBar>
        )}

      <div className={styles.tabBar}>
        <TabList
          className={styles.tabs}
          selectedValue={tab}
          onTabSelect={(_, d) => selectTab(d.value as TabId)}
        >
          {visible.map((x) => (
            <Tab key={x.id} value={x.id}>
              {x.label}
            </Tab>
          ))}
        </TabList>
      </div>

      <SettingsToast message={message} />

      {tab === "members" && (
        <MembersTab
          {...tabProps}
          members={data?.members ?? []}
          memberCount={data?.member_count ?? data?.members.length ?? 0}
        />
      )}
      {tab === "groups" && (
        <GroupsTab
          teamId={team.id}
          enabled={team.enable_groups}
          isOwner={isOwner}
          showMsg={showMsg}
        />
      )}
      {tab === "apps" && <AppsTab {...tabProps} />}
      {tab === "domains" && <DomainsTab {...tabProps} />}
      {tab === "sub-teams" && <SubTeamsTab {...tabProps} />}
      {tab === "audit" && <AuditLog base={`team/${team.id}`} />}
      {tab === "settings" && <SettingsTab {...tabProps} />}
    </SettingsPage>
  );
}
