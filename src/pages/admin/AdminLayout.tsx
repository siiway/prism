// Admin section layout with sub-navigation

import {
  Tab,
  TabList,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useNavigate, useLocation, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "24px",
    minWidth: 0,
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
});

export function AdminLayout() {
  const styles = useStyles();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useTranslation();

  const TABS = [
    { value: "/admin", label: t("admin.overview") },
    { value: "/admin/users", label: t("admin.usersTab") },
    { value: "/admin/apps", label: t("admin.applicationsTab") },
    { value: "/admin/teams", label: t("admin.teamsTab") },
    { value: "/admin/settings", label: t("admin.settingsTab") },
    { value: "/admin/invites", label: t("admin.invitesTab") },
    { value: "/admin/connections", label: t("admin.connectionsTab") },
    { value: "/admin/audit", label: t("admin.auditLogTab") },
    { value: "/admin/webhooks", label: t("admin.webhooksTab") },
    { value: "/admin/login-errors", label: t("admin.loginErrorsTab") },
    { value: "/admin/logs", label: t("admin.logsTab") },
  ];

  const currentTab =
    TABS.find(
      (tab) =>
        pathname === tab.value ||
        (tab.value !== "/admin" && pathname.startsWith(tab.value)),
    )?.value ?? "/admin";

  return (
    <div className={styles.root}>
      <div>
        <Title2>{t("admin.title")}</Title2>
        <br />
        <Text style={{ color: tokens.colorNeutralForeground3 }}>
          {t("admin.subtitle")}
        </Text>
      </div>

      <div className={styles.tabsWrap}>
        <TabList
          className={styles.tabs}
          selectedValue={currentTab}
          onTabSelect={(_, d) => navigate(d.value as string)}
        >
          {TABS.map((tab) => (
            <Tab key={tab.value} value={tab.value}>
              {tab.label}
            </Tab>
          ))}
        </TabList>
      </div>

      <Outlet />
    </div>
  );
}
