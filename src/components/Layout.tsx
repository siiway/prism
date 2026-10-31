// App shell layout with navigation
//
// Structure follows the Cloudflare dashboard: a flat sidebar (brand, nav,
// and the account menu pinned to its bottom) beside the content column.
// Sidebar and content share one page colour; hairlines separate them. On
// mobile the sidebar becomes a drawer opened from a slim top bar.

import {
  Avatar,
  Button,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Spinner,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  AlertRegular,
  AppsRegular,
  ArrowLeftRegular,
  ChevronUpDownRegular,
  DesktopRegular,
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
  ShieldTaskRegular,
  SignOutRegular,
  WeatherMoonRegular,
  WeatherSunnyRegular,
  type FluentIcon,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useApi } from "../lib/api-context";
import { useAuthStore } from "../store/auth";
import { useThemeStore, type ThemeMode } from "../store/theme";
import { BrandMark } from "./BrandMark";
import { Segmented } from "./Segmented";
import { NoticeBoard } from "./NoticeBoard";
import { LegalFooter } from "./LegalFooter";
import { useAdminNav } from "../pages/admin/adminNav";

const HEADER_HEIGHT = "52px";

const useStyles = makeStyles({
  shell: {
    display: "flex",
    height: "100vh",
    overflow: "hidden",
    background: "var(--prism-canvas)",
  },
  sidebar: {
    width: "240px",
    display: "flex",
    flexDirection: "column",
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    background: "var(--prism-canvas)",
    flexShrink: 0,
    "@media (max-width: 768px)": {
      position: "fixed",
      top: 0,
      left: 0,
      bottom: 0,
      zIndex: 200,
      transform: "translateX(-100%)",
      transitionProperty: "transform",
      transitionDuration: "0.2s",
      transitionTimingFunction: "ease-out",
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
      background: "rgba(0,0,0,0.5)",
      zIndex: 199,
    },
  },
  logo: {
    height: HEADER_HEIGHT,
    flexShrink: 0,
    padding: "0 12px 0 18px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  brandRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flex: 1,
    minWidth: 0,
  },
  closeBtnHidden: {
    "@media (min-width: 769px)": {
      display: "none",
    },
  },
  nav: {
    flex: 1,
    overflowY: "auto",
    padding: "10px",
    display: "flex",
    flexDirection: "column",
    gap: "1px",
  },
  navItem: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    minHeight: "32px",
    padding: "0 10px",
    borderRadius: tokens.borderRadiusMedium,
    textDecoration: "none",
    color: tokens.colorNeutralForeground2,
    fontSize: "13px",
    fontWeight: tokens.fontWeightMedium,
    ":hover": {
      background: tokens.colorNeutralBackground3,
      color: tokens.colorNeutralForeground1,
    },
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "-2px",
    },
  },
  navItemActive: {
    background: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground1,
  },
  navIcon: {
    fontSize: "16px",
    flexShrink: 0,
    color: tokens.colorNeutralForeground3,
  },
  // Admin mode: a muted way back out, then the admin nav. Which mode you
  // are in is shown by modeTag in the brand row, not by a heading here.
  navBack: {
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightRegular,
    marginBottom: "8px",
  },
  modeTag: {
    flexShrink: 0,
    padding: "0 6px",
    lineHeight: "18px",
    fontSize: "11px",
    fontWeight: tokens.fontWeightMedium,
    color: tokens.colorNeutralForeground3,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  // Pushes the Admin Panel link to the bottom of the regular nav.
  navSpacer: {
    flex: 1,
    minHeight: "16px",
  },
  navSection: {
    padding: "16px 10px 6px",
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
  },
  // Account menu pinned to the sidebar's bottom edge.
  userArea: {
    flexShrink: 0,
    padding: "10px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  userButton: {
    width: "100%",
    minWidth: 0,
    justifyContent: "flex-start",
    gap: "10px",
    padding: "6px 8px",
    fontWeight: tokens.fontWeightRegular,
  },
  userText: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    flex: 1,
    minWidth: 0,
    textAlign: "left",
  },
  userName: {
    maxWidth: "100%",
  },
  userChevron: {
    flexShrink: 0,
    fontSize: "16px",
    color: tokens.colorNeutralForeground3,
  },
  // Account panel: as wide as its trigger, with sidebar-sized type.
  // PopoverSurface ships its own filter: drop-shadow() (sized for an
  // arrow this panel doesn't use) and a transparent border. Replace both
  // so there is exactly one soft shadow and a hairline edge, matching the
  // rest of the app's floating surfaces.
  accountPanel: {
    padding: "4px",
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    filter: "none",
    boxShadow: tokens.shadow8,
    background: tokens.colorNeutralBackground1,
    fontSize: "13px",
  },
  accountHead: {
    display: "flex",
    flexDirection: "column",
    padding: "8px 8px 10px",
    minWidth: 0,
  },
  accountSep: {
    height: "1px",
    margin: "0 -4px",
    background: tokens.colorNeutralStroke2,
  },
  accountGroup: {
    padding: "4px 0",
  },
  prefRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    minHeight: "36px",
    padding: "0 4px 0 8px",
    color: tokens.colorNeutralForeground2,
  },
  accountAction: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    minHeight: "34px",
    padding: "0 8px",
    border: "none",
    borderRadius: tokens.borderRadiusMedium,
    background: "transparent",
    color: tokens.colorNeutralForeground2,
    fontFamily: "inherit",
    fontSize: "13px",
    cursor: "pointer",
    "& svg": { fontSize: "16px", color: tokens.colorNeutralForeground3 },
    ":hover": {
      background: tokens.colorNeutralBackground3,
      color: tokens.colorNeutralForeground1,
    },
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "-2px",
    },
    ":disabled": { cursor: "default", opacity: 0.6 },
  },
  column: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  // Mobile-only top bar: opens the sidebar drawer.
  header: {
    height: HEADER_HEIGHT,
    flexShrink: 0,
    display: "none",
    "@media (max-width: 768px)": {
      display: "flex",
    },
    alignItems: "center",
    gap: "8px",
    padding: "0 16px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  muted: {
    color: tokens.colorNeutralForeground3,
  },
  main: {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
  },
  content: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    width: "100%",
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "32px 40px 48px",
    boxSizing: "border-box",
    "@media (max-width: 1024px)": {
      padding: "24px",
    },
    "@media (max-width: 768px)": {
      padding: "16px 12px 32px",
    },
  },
  // Full-viewport scrim shown while sign-out is in flight. The Fluent Menu
  // closes immediately, so this gives durable feedback and blocks interaction
  // until the cookie revocation and cache reset finish.
  switchOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.35)",
  },
  switchCard: {
    background: tokens.colorNeutralBackground1,
    padding: "20px 28px",
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow16,
  },
});

interface NavItemProps {
  to: string;
  icon: FluentIcon;
  label: string;
  end?: boolean;
  onNavigate?: () => void;
  className?: string;
}

function NavItem({
  to,
  icon: Icon,
  label,
  end,
  onNavigate,
  className,
}: NavItemProps) {
  const styles = useStyles();
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        mergeClasses(
          styles.navItem,
          isActive && styles.navItemActive,
          className,
        )
      }
    >
      <Icon className={styles.navIcon} />
      {label}
    </NavLink>
  );
}

/**
 * Sidebar contents while inside /admin: like a Cloudflare zone, the section
 * takes over the sidebar with its own grouped nav and a way back out.
 * Its own component so the admin-only queries in useAdminNav never run for
 * everyone else.
 */
function AdminSidebarNav({ onNavigate }: { onNavigate: () => void }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const groups = useAdminNav();
  return (
    <>
      <NavItem
        to="/"
        end
        icon={ArrowLeftRegular}
        label={t("admin.backToAccount")}
        onNavigate={onNavigate}
        className={styles.navBack}
      />
      {groups.map((group, i) => (
        <div key={group.label ?? i}>
          {group.label && (
            <div className={styles.navSection}>{group.label}</div>
          )}
          {group.items.map((item) => (
            <NavItem
              key={item.to}
              to={item.to}
              end={item.to === "/admin"}
              icon={item.icon}
              label={item.label}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ))}
    </>
  );
}

export function Layout() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { user, clearAuth } = useAuthStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const { t, i18n } = useTranslation();
  const themeMode = useThemeStore((s) => s.mode);
  const setThemeMode = useThemeStore((s) => s.setMode);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing UI state to route changes; rerender cost is negligible vs. tracking with refs
    setSidebarOpen(false);
  }, [location.pathname]);
  const { data: site } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });

  // Restricted accounts have most developer features denied server-side.
  // Resolves to "unrestricted" for everyone else, so the nav is unchanged
  // for the overwhelming majority.
  const { data: restriction } = useQuery({
    queryKey: ["my-restriction"],
    queryFn: api.myRestriction,
    staleTime: 60_000,
    retry: false,
  });
  const restrictedCaps = restriction?.restricted
    ? restriction.capabilities
    : null;
  const showDeveloperNav =
    !restrictedCaps ||
    restrictedCaps["app:create"] ||
    restrictedCaps["domain:create"] ||
    restrictedCaps["pat:create"];

  const handleSignOut = async () => {
    if (busy) return;
    setBusy(t("account.signingOut"));
    try {
      await api.logout();
    } catch {
      /* best effort: local state must still be cleared */
    }
    clearAuth();
    await qc.clear();
    setBusy(null);
    navigate("/login", { replace: true });
  };

  const closeSidebar = () => setSidebarOpen(false);

  const [accountOpen, setAccountOpen] = useState(false);
  const lang = i18n.language.startsWith("zh") ? "zh" : "en";

  const siteName = site?.site_name ?? "Prism";
  const inAdmin =
    user?.role === "admin" &&
    (location.pathname === "/admin" || location.pathname.startsWith("/admin/"));

  return (
    <div className={styles.shell}>
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
        <div className={styles.logo}>
          <div className={styles.brandRow}>
            <BrandMark
              name={site?.site_name}
              iconUrl={site?.site_icon_url}
              size={24}
            />
            <Text weight="semibold" size={300} truncate wrap={false}>
              {siteName}
            </Text>
            {inAdmin && (
              <span className={styles.modeTag}>{t("nav.admin")}</span>
            )}
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
          {inAdmin ? (
            <AdminSidebarNav onNavigate={closeSidebar} />
          ) : (
            <>
              <NavItem
                to="/"
                icon={HomeRegular}
                label={t("nav.dashboard")}
                end
                onNavigate={closeSidebar}
              />
              <NavItem
                to="/profile"
                icon={PersonRegular}
                label={t("nav.profile")}
                onNavigate={closeSidebar}
              />
              <NavItem
                to="/security"
                icon={ShieldPersonRegular}
                label={t("nav.security")}
                onNavigate={closeSidebar}
              />
              <NavItem
                to="/notifications"
                icon={AlertRegular}
                label={t("nav.notifications")}
                onNavigate={closeSidebar}
              />
              <NavItem
                to="/audit-log"
                icon={ShieldTaskRegular}
                label={t("nav.auditLog")}
                onNavigate={closeSidebar}
              />

              {/* Hidden for restricted accounts, whose server-side capability set
              denies all of these. Hiding is presentation only — the refusal
              lives in the API, this just avoids offering dead ends. Teams
              stays visible because a restricted account still belongs to
              one. */}
              {(showDeveloperNav || restrictedCaps?.["team:create"]) && (
                <div className={styles.navSection}>{t("nav.developer")}</div>
              )}
              {showDeveloperNav && (
                <NavItem
                  to="/apps"
                  icon={AppsRegular}
                  label={t("nav.myApps")}
                  onNavigate={closeSidebar}
                />
              )}
              <NavItem
                to="/teams"
                icon={PeopleRegular}
                label={t("nav.teams")}
                onNavigate={closeSidebar}
              />
              {showDeveloperNav && (
                <NavItem
                  to="/domains"
                  icon={GlobeRegular}
                  label={t("nav.domains")}
                  onNavigate={closeSidebar}
                />
              )}
              {showDeveloperNav && (
                <NavItem
                  to="/tokens"
                  icon={KeyRegular}
                  label={t("nav.tokens")}
                  onNavigate={closeSidebar}
                />
              )}

              <div className={styles.navSection}>{t("nav.connections")}</div>
              <NavItem
                to="/connections"
                icon={LinkRegular}
                label={t("nav.linkedAccounts")}
                onNavigate={closeSidebar}
              />
              <NavItem
                to="/connected-apps"
                icon={LockClosedRegular}
                label={t("nav.connectedApps")}
                onNavigate={closeSidebar}
              />

              {user?.role === "admin" && (
                <>
                  <div className={styles.navSpacer} />
                  <NavItem
                    to="/admin"
                    icon={SettingsRegular}
                    label={t("nav.adminPanel")}
                    onNavigate={closeSidebar}
                  />
                </>
              )}
            </>
          )}
        </nav>

        {/* Account menu: who you are, appearance (language + theme), and
            sign-out. Profile and Security already live in the nav above. */}
        <div className={styles.userArea}>
          <Popover
            open={accountOpen}
            onOpenChange={(_, data) => setAccountOpen(data.open)}
            positioning={{
              position: "above",
              align: "start",
              matchTargetSize: "width",
              offset: 6,
            }}
            trapFocus
          >
            <PopoverTrigger disableButtonEnhancement>
              <Button appearance="subtle" className={styles.userButton}>
                <Avatar
                  name={user?.display_name}
                  image={
                    user?.avatar_url ? { src: user.avatar_url } : undefined
                  }
                  size={28}
                />
                <span className={styles.userText}>
                  <Text
                    size={200}
                    weight="semibold"
                    truncate
                    wrap={false}
                    className={styles.userName}
                  >
                    {user?.display_name}
                  </Text>
                  <Text
                    size={100}
                    truncate
                    wrap={false}
                    className={mergeClasses(styles.userName, styles.muted)}
                  >
                    @{user?.username}
                  </Text>
                </span>
                <ChevronUpDownRegular className={styles.userChevron} />
              </Button>
            </PopoverTrigger>
            <PopoverSurface className={styles.accountPanel}>
              <div className={styles.accountHead}>
                <Text weight="semibold" size={200} truncate wrap={false}>
                  {user?.display_name}
                </Text>
                <Text size={200} className={styles.muted} truncate wrap={false}>
                  {user?.email}
                </Text>
              </div>
              <div className={styles.accountSep} />
              <div className={styles.accountGroup}>
                <div className={styles.prefRow}>
                  <span>{t("theme.label")}</span>
                  <Segmented<ThemeMode>
                    label={t("theme.label")}
                    value={themeMode}
                    onChange={setThemeMode}
                    options={[
                      {
                        value: "system",
                        label: t("theme.system"),
                        content: <DesktopRegular />,
                      },
                      {
                        value: "light",
                        label: t("theme.light"),
                        content: <WeatherSunnyRegular />,
                      },
                      {
                        value: "dark",
                        label: t("theme.dark"),
                        content: <WeatherMoonRegular />,
                      },
                    ]}
                  />
                </div>
                <div className={styles.prefRow}>
                  <span>{t("language.label")}</span>
                  <Segmented<"en" | "zh">
                    label={t("language.label")}
                    value={lang}
                    onChange={(next) => void i18n.changeLanguage(next)}
                    options={[
                      { value: "en", label: "English", content: "EN" },
                      { value: "zh", label: "中文", content: "中文" },
                    ]}
                  />
                </div>
              </div>
              <div className={styles.accountSep} />
              <div className={styles.accountGroup}>
                <button
                  type="button"
                  className={styles.accountAction}
                  onClick={() => {
                    setAccountOpen(false);
                    void handleSignOut();
                  }}
                  disabled={busy !== null}
                >
                  {t("nav.signOut")}
                  <SignOutRegular />
                </button>
              </div>
            </PopoverSurface>
          </Popover>
        </div>
      </aside>

      <div className={styles.column}>
        <header className={styles.header}>
          <Button
            appearance="subtle"
            icon={<NavigationRegular />}
            onClick={() => setSidebarOpen(true)}
            aria-label={t("nav.openMenu")}
          />
          <div className={styles.brandRow}>
            <BrandMark
              name={site?.site_name}
              iconUrl={site?.site_icon_url}
              size={22}
            />
            <Text weight="semibold" size={300} truncate wrap={false}>
              {siteName}
            </Text>
          </div>
        </header>

        <main className={styles.main}>
          <div className={styles.content}>
            {/* Above the page, not inside it — a notice about the instance is
                not part of whatever the user came here to do. */}
            <NoticeBoard />
            <Outlet />
          </div>
          <LegalFooter />
        </main>
      </div>

      {/* Blocking feedback while sign-out is in flight. */}
      {busy && (
        <div className={styles.switchOverlay} role="status" aria-live="polite">
          <div className={styles.switchCard}>
            <Spinner size="large" label={busy} />
          </div>
        </div>
      )}
    </div>
  );
}
