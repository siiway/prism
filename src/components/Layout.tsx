// App shell layout with navigation

import {
  Avatar,
  Button,
  Menu,
  MenuButton,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  AppsRegular,
  DismissRegular,
  GlobeRegular,
  HomeRegular,
  KeyRegular,
  LinkRegular,
  LockClosedRegular,
  NavigationRegular,
  PeopleRegular,
  PersonRegular,
  SettingsRegular,
  ShieldPersonRegular,
  SignOutRegular,
  LocalLanguageRegular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, proxyImageUrl } from "../lib/api";
import { useAuthStore } from "../store/auth";

const useStyles = makeStyles({
  shell: {
    display: "flex",
    height: "100vh",
    overflow: "hidden",
    "@media (max-width: 768px)": {
      flexDirection: "column",
    },
  },
  sidebar: {
    width: "240px",
    display: "flex",
    flexDirection: "column",
    borderRight: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground2,
    flexShrink: 0,
    "@media (max-width: 768px)": {
      position: "fixed",
      top: 0,
      left: 0,
      bottom: 0,
      zIndex: 200,
      transform: "translateX(-240px)",
      transitionProperty: "transform",
      transitionDuration: "0.25s",
      transitionTimingFunction: "ease",
      boxShadow: tokens.shadow28,
    },
  },
  sidebarOpen: {
    "@media (max-width: 768px)": {
      transform: "translateX(0)",
    },
  },
  backdrop: {
    display: "none",
    "@media (max-width: 768px)": {
      display: "block",
      position: "fixed",
      inset: "0",
      background: "rgba(0,0,0,0.4)",
      zIndex: 199,
    },
  },
  topBar: {
    display: "none",
    "@media (max-width: 768px)": {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "10px 12px",
      borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
      background: tokens.colorNeutralBackground2,
      flexShrink: 0,
    },
  },
  logo: {
    padding: "20px 16px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  closeBtnHidden: {
    "@media (min-width: 769px)": {
      display: "none",
    },
  },
  nav: {
    flex: 1,
    overflowY: "auto",
    padding: "8px",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  navItem: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "8px 12px",
    borderRadius: "4px",
    textDecoration: "none",
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    ":hover": {
      background: tokens.colorNeutralBackground3,
      color: tokens.colorNeutralForeground1,
    },
  },
  navItemActive: {
    background: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold,
    ":hover": {
      background: tokens.colorNeutralBackground3Hover,
    },
  },
  navSection: {
    padding: "8px 12px 4px",
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  userArea: {
    padding: "12px",
    borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
  },
  main: {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  content: {
    flex: 1,
    padding: "32px",
    maxWidth: "960px",
    width: "100%",
    margin: "0 auto",
    boxSizing: "border-box",
    "@media (max-width: 768px)": {
      padding: "16px",
    },
  },
});

interface NavItemProps {
  to: string;
  icon: React.ReactElement;
  label: string;
  end?: boolean;
  onNavigate?: () => void;
}

function NavItem({ to, icon, label, end, onNavigate }: NavItemProps) {
  const styles = useStyles();
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        `${styles.navItem}${isActive ? ` ${styles.navItemActive}` : ""}`
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}

export function Layout() {
  const styles = useStyles();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, clearAuth } = useAuthStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { t, i18n } = useTranslation();

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);
  const { data: site } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    clearAuth();
    navigate("/login");
  };

  const closeSidebar = () => setSidebarOpen(false);

  const toggleLanguage = () => {
    const nextLang = i18n.language.startsWith("zh") ? "en" : "zh";
    i18n.changeLanguage(nextLang);
  };

  const langLabel = i18n.language.startsWith("zh")
    ? t("language.switchToEn")
    : t("language.switchToZh");

  const sidebarContent = (
    <>
      <div className={styles.logo}>
        <div
          style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}
        >
          {site?.site_icon_url && (
            <img
              src={proxyImageUrl(site.site_icon_url)}
              alt="logo"
              style={{ width: 28, height: 28, borderRadius: 4 }}
            />
          )}
          <Text weight="semibold" size={400}>
            {site?.site_name ?? "Prism"}
          </Text>
        </div>
        <Button
          appearance="subtle"
          icon={<DismissRegular />}
          size="small"
          onClick={closeSidebar}
          className={styles.closeBtnHidden}
          aria-label={t("nav.closeMenu")}
        />
      </div>

      <nav className={styles.nav}>
        <NavItem
          to="/"
          icon={<HomeRegular />}
          label={t("nav.dashboard")}
          end
          onNavigate={closeSidebar}
        />
        <NavItem
          to="/profile"
          icon={<PersonRegular />}
          label={t("nav.profile")}
          onNavigate={closeSidebar}
        />
        <NavItem
          to="/security"
          icon={<ShieldPersonRegular />}
          label={t("nav.security")}
          onNavigate={closeSidebar}
        />

        <div className={styles.navSection}>{t("nav.developer")}</div>
        <NavItem
          to="/apps"
          icon={<AppsRegular />}
          label={t("nav.myApps")}
          onNavigate={closeSidebar}
        />
        <NavItem
          to="/teams"
          icon={<PeopleRegular />}
          label={t("nav.teams")}
          onNavigate={closeSidebar}
        />
        <NavItem
          to="/domains"
          icon={<GlobeRegular />}
          label={t("nav.domains")}
          onNavigate={closeSidebar}
        />
        <NavItem
          to="/tokens"
          icon={<KeyRegular />}
          label={t("nav.tokens")}
          onNavigate={closeSidebar}
        />

        <div className={styles.navSection}>{t("nav.connections")}</div>
        <NavItem
          to="/connections"
          icon={<LinkRegular />}
          label={t("nav.linkedAccounts")}
          onNavigate={closeSidebar}
        />
        <NavItem
          to="/connected-apps"
          icon={<LockClosedRegular />}
          label={t("nav.connectedApps")}
          onNavigate={closeSidebar}
        />

        {user?.role === "admin" && (
          <>
            <div className={styles.navSection}>{t("nav.admin")}</div>
            <NavItem
              to="/admin"
              icon={<SettingsRegular />}
              label={t("nav.adminPanel")}
              onNavigate={closeSidebar}
            />
          </>
        )}
      </nav>

      <div className={styles.userArea}>
        <Button
          appearance="subtle"
          icon={<LocalLanguageRegular />}
          size="small"
          onClick={toggleLanguage}
          style={{
            width: "100%",
            justifyContent: "flex-start",
            marginBottom: 8,
          }}
        >
          {langLabel}
        </Button>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <MenuButton
              appearance="subtle"
              style={{ width: "100%", justifyContent: "flex-start", gap: 8 }}
              icon={
                <Avatar
                  name={user?.display_name}
                  image={
                    user?.avatar_url
                      ? { src: proxyImageUrl(user.avatar_url) }
                      : undefined
                  }
                  size={28}
                />
              }
            >
              <div style={{ textAlign: "left", overflow: "hidden" }}>
                <Text
                  block
                  size={200}
                  weight="semibold"
                  truncate
                  style={{ maxWidth: 140 }}
                >
                  {user?.display_name}
                </Text>
                <Text
                  block
                  size={100}
                  style={{
                    color: tokens.colorNeutralForeground3,
                    maxWidth: 140,
                  }}
                  truncate
                >
                  @{user?.username}
                </Text>
              </div>
            </MenuButton>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem
                icon={<PersonRegular />}
                onClick={() => navigate("/profile")}
              >
                {t("nav.profile")}
              </MenuItem>
              <MenuItem
                icon={<KeyRegular />}
                onClick={() => navigate("/security")}
              >
                {t("nav.security")}
              </MenuItem>
              <MenuDivider />
              <MenuItem icon={<SignOutRegular />} onClick={handleLogout}>
                {t("nav.signOut")}
              </MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </div>
    </>
  );

  return (
    <div className={styles.shell}>
      {/* Mobile top bar */}
      <div className={styles.topBar}>
        <Button
          appearance="subtle"
          icon={<NavigationRegular />}
          onClick={() => setSidebarOpen(true)}
          aria-label={t("nav.openMenu")}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {site?.site_icon_url && (
            <img
              src={proxyImageUrl(site.site_icon_url)}
              alt="logo"
              style={{ width: 24, height: 24, borderRadius: 4 }}
            />
          )}
          <Text weight="semibold" size={400}>
            {site?.site_name ?? "Prism"}
          </Text>
        </div>
      </div>

      {/* Backdrop (mobile only) */}
      {sidebarOpen && (
        <div className={styles.backdrop} onClick={closeSidebar} />
      )}

      <aside
        className={mergeClasses(
          styles.sidebar,
          sidebarOpen && styles.sidebarOpen,
        )}
      >
        {sidebarContent}
      </aside>

      <main className={styles.main}>
        <div className={styles.content}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
