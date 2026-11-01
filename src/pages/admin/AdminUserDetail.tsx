// One account, everything about it: the page an operator opens when someone
// writes in. Four tabs of settings cards (kept in ?tab=): overview (status,
// profile, sign-in, emails, deletion), access (sessions, tokens, grants,
// providers, keys), resources (apps, teams, domains, notifications) and the
// account's audit log.
//
// Every change here is a site-admin action recorded in the platform log and
// in the user's own, which is why that log is one tab away.

import {
  Avatar,
  Badge,
  Button,
  MessageBar,
  Tab,
  TabList,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { ArrowLeftRegular, CopyRegular } from "@fluentui/react-icons";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import { setDocumentPageTitle } from "../../lib/documentTitle";
import { useConfirm } from "../../lib/useConfirm";
import { useToastMessage } from "../../lib/useToastMessage";
import { useAuthStore } from "../../store/auth";
import { AuditLog } from "../../components/AuditLog";
import { CopyIdTrigger } from "../../components/CopyIdTrigger";
import { SettingsPage, SettingsToast } from "../../components/Settings";
import { SkeletonSettingsCard } from "../../components/Skeletons";
import { AccessTab } from "./user/AccessTab";
import { OverviewTab } from "./user/OverviewTab";
import { ResourcesTab } from "./user/ResourcesTab";
import type { UserTabProps } from "./user/types";

const TABS = ["overview", "access", "resources", "audit"] as const;
type TabId = (typeof TABS)[number];

const useStyles = makeStyles({
  back: {
    alignSelf: "flex-start",
    marginLeft: "-8px",
    color: tokens.colorNeutralForeground3,
  },
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
  muted: { color: tokens.colorNeutralForeground3, overflowWrap: "anywhere" },
  id: {
    gap: "6px",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
  },
  tabBar: { borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  tabs: { marginLeft: "-10px" },
});

export function AdminUserDetail() {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { id = "" } = useParams();
  const { message, showMsg } = useToastMessage();
  const { confirm, confirmDialog } = useConfirm();
  const me = useAuthStore((s) => s.user?.id);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-user", id],
    queryFn: () => api.adminGetUser(id),
    retry: false,
  });
  const user = data?.user;

  useEffect(() => {
    if (!user?.display_name) return;
    setDocumentPageTitle(user.display_name);
    return () => setDocumentPageTitle(null);
  }, [user?.display_name]);

  const paramTab = params.get("tab") as TabId | null;
  const tab: TabId =
    paramTab && TABS.includes(paramTab) ? paramTab : "overview";
  const selectTab = (next: TabId) =>
    navigate(
      { search: next === "overview" ? "" : `?tab=${next}` },
      {
        replace: true,
      },
    );

  const back = (
    <Button
      appearance="subtle"
      size="small"
      icon={<ArrowLeftRegular />}
      className={styles.back}
      onClick={() => navigate("/admin/users")}
    >
      {t("admin.usersTab")}
    </Button>
  );

  if (isLoading)
    return (
      <SettingsPage>
        {back}
        <SkeletonSettingsCard rows={4} />
      </SettingsPage>
    );
  if (error || !data || !user)
    return (
      <SettingsPage>
        {back}
        <MessageBar intent="error">
          {error instanceof ApiError ? error.message : t("admin.userNotFound")}
        </MessageBar>
      </SettingsPage>
    );

  const props: UserTabProps = {
    userId: id,
    user,
    apps: data.apps,
    isSelf: user.id === me,
    showMsg,
    confirm,
  };

  return (
    <SettingsPage>
      {back}

      <div className={styles.header}>
        <Avatar
          name={user.display_name || user.username}
          image={user.avatar_url ? { src: user.avatar_url } : undefined}
          size={48}
        />
        <div className={styles.titles}>
          <div className={styles.titleLine}>
            <Title2 as="h1" className={styles.title}>
              {user.display_name || user.username}
            </Title2>
            {user.role === "admin" && (
              <Badge appearance="tint" color="brand">
                {t("admin.userPage.roleAdmin")}
              </Badge>
            )}
            {!user.is_active && (
              <Badge appearance="tint" color="danger">
                {t("admin.disabledStatus")}
              </Badge>
            )}
          </div>
          <Text className={styles.muted}>
            @{user.username} · {user.email}
          </Text>
        </div>
        <CopyIdTrigger
          id={user.id}
          label={t("admin.userPage.copyUserId")}
          copiedLabel={t("admin.userPage.copiedUserId")}
          className={styles.id}
        >
          <span>{user.id}</span>
          <CopyRegular />
        </CopyIdTrigger>
      </div>

      <div className={styles.tabBar}>
        <TabList
          className={styles.tabs}
          selectedValue={tab}
          onTabSelect={(_, d) => selectTab(d.value as TabId)}
        >
          <Tab value="overview">{t("admin.overviewTab")}</Tab>
          <Tab value="access">{t("admin.accessTab")}</Tab>
          <Tab value="resources">{t("admin.resourcesTab")}</Tab>
          <Tab value="audit">{t("admin.auditLogTab")}</Tab>
        </TabList>
      </div>

      <SettingsToast message={message} />

      {tab === "overview" && <OverviewTab {...props} />}
      {tab === "access" && <AccessTab {...props} />}
      {tab === "resources" && <ResourcesTab {...props} />}
      {/* The log brings its own table and filters, so it isn't wrapped in a
          card of its own. */}
      {tab === "audit" && (
        <>
          <Text className={styles.muted}>{t("admin.userAuditHint")}</Text>
          <AuditLog base={`user/${id}`} />
        </>
      )}

      {confirmDialog}
    </SettingsPage>
  );
}
