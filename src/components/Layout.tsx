// App shell layout with navigation

import {
  Avatar,
  Button,
  Image,
  Menu,
  MenuButton,
  MenuDivider,
  MenuGroup,
  MenuGroupHeader,
  MenuItem,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Spinner,
  Text,
  Toast,
  ToastTitle,
  Toaster,
  makeStyles,
  mergeClasses,
  tokens,
  useId,
  useToastController,
} from "@fluentui/react-components";
import {
  AlertRegular,
  AppsRegular,
  CheckmarkRegular,
  DesktopRegular,
  DismissRegular,
  GlobeRegular,
  HomeRegular,
  KeyRegular,
  LinkRegular,
  LockClosedRegular,
  NavigationRegular,
  PeopleRegular,
  PersonAddRegular,
  PersonRegular,
  SettingsRegular,
  ShieldPersonRegular,
  ShieldTaskRegular,
  SignOutRegular,
  LocalLanguageRegular,
  WeatherMoonRegular,
  WeatherSunnyRegular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { useAuthStore, type Account } from "../store/auth";
import { useThemeStore, type ThemeMode } from "../store/theme";
import { NoticeBoard } from "./NoticeBoard";
import { LegalFooter } from "./LegalFooter";
import { ManageAccountsDialog } from "./ManageAccountsDialog";

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
    borderRight: `2px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground1,
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
      padding: "8px 12px",
      borderBottom: `2px solid ${tokens.colorNeutralStroke1}`,
      background: tokens.colorNeutralBackground1,
      flexShrink: 0,
    },
  },
  logo: {
    padding: "16px",
    borderBottom: `2px solid ${tokens.colorNeutralStroke1}`,
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
    padding: "4px 6px",
    display: "flex",
    flexDirection: "column",
    gap: "1px",
  },
  navItem: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "6px 10px",
    borderRadius: "6px",
    textDecoration: "none",
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    transitionProperty: "background, color",
    transitionDuration: "0.1s",
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
    "::before": {
      content: '""',
      position: "absolute",
      left: "0",
      top: "6px",
      bottom: "6px",
      width: "3px",
      borderRadius: "2px",
      background: tokens.colorCompoundBrandForeground1,
    },
  },
  navSection: {
    padding: "10px 10px 4px",
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  userArea: {
    padding: "10px",
    borderTop: `2px solid ${tokens.colorNeutralStroke1}`,
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
    padding: "20px 24px",
    width: "100%",
    boxSizing: "border-box",
    "@media (max-width: 768px)": {
      padding: "12px",
    },
  },
  // Full-viewport scrim shown while an account switch / sign-out round trip is
  // in flight. The Fluent Menu closes the moment an item is clicked, so an
  // inline per-row spinner would flash and vanish; this gives durable feedback
  // and blocks interaction until the swap and cache reset finish.
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
  const qc = useQueryClient();
  const { user, accounts, switchAccount, removeAccount, clearAuth } =
    useAuthStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  // Non-null while an account switch / sign-out is in flight: holds the label
  // shown in the overlay, and gates re-entrancy so two swaps can't race.
  const [busy, setBusy] = useState<string | null>(null);
  const toasterId = useId("account-toaster");
  const { dispatchToast } = useToastController(toasterId);
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

  // Switch the active account. The cookie is repointed server-side first (so a
  // later reload/SSR sees the same account), then the local active pointer
  // moves and the previous account's cached data is dropped.
  const handleSwitch = async (userId: string) => {
    if (busy || userId === user?.id) return;
    const target = accounts.find((a) => a.user.id === userId);
    if (!target) return;
    setManageOpen(false);
    setBusy(t("account.switchingTo", { name: target.user.display_name }));
    try {
      await api.switchAccount(target.token);
      switchAccount(userId);
      await qc.clear();
      navigate("/", { replace: true });
    } catch {
      // The stored session is gone (revoked or expired). Drop the dead account,
      // stay signed in as the current one, and say why it vanished.
      removeAccount(userId);
      dispatchToast(
        <Toast>
          <ToastTitle>
            {t("account.switchFailed", { username: target.user.username })}
          </ToastTitle>
        </Toast>,
        { intent: "error" },
      );
    } finally {
      setBusy(null);
    }
  };

  const handleAddAccount = () => {
    setManageOpen(false);
    navigate("/login?add=1");
  };

  // Sign out of the *active* account: revoke its session (which clears the
  // cookie) and clear the active pointer. Any other accounts stay in the
  // switcher, so the login page shows the "Continue as" chooser instead of
  // silently assuming a different identity.
  const signOutActive = async () => {
    setManageOpen(false);
    setBusy(t("account.signingOut"));
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    if (user) removeAccount(user.id);
    else clearAuth();
    await qc.clear();
    setBusy(null);
    navigate("/login");
  };

  // Sign out of one account. The active account routes through signOutActive
  // (cookie + navigation); a background account is revoked server-side and
  // dropped locally without disturbing the active session or the current view.
  const handleSignOutOne = async (account: Account) => {
    if (busy) return;
    if (account.user.id === user?.id) {
      await signOutActive();
      return;
    }
    try {
      await api.revokeAccount(account.token);
    } catch {
      /* best-effort: the session may already be gone */
    }
    removeAccount(account.user.id);
  };

  const handleSignOutAll = async () => {
    if (busy) return;
    setManageOpen(false);
    setBusy(t("account.signingOut"));
    const others = accounts.filter((a) => a.user.id !== user?.id);
    await Promise.all(
      others.map((a) => api.revokeAccount(a.token).catch(() => {})),
    );
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    clearAuth();
    await qc.clear();
    setBusy(null);
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
            <Image
              src={site.site_icon_url}
              alt="logo"
              shape="rounded"
              fit="cover"
              width={28}
              height={28}
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
        <NavItem
          to="/notifications"
          icon={<AlertRegular />}
          label={t("nav.notifications")}
          onNavigate={closeSidebar}
        />
        <NavItem
          to="/audit-log"
          icon={<ShieldTaskRegular />}
          label={t("nav.auditLog")}
          onNavigate={closeSidebar}
        />

        {/* Hidden for restricted accounts, whose server-side capability set
            denies all of these. Hiding is presentation only — the refusal
            lives in the API, this just avoids offering dead ends. Teams stays
            visible because a restricted account still belongs to one. */}
        {(showDeveloperNav || restrictedCaps?.["team:create"]) && (
          <div className={styles.navSection}>{t("nav.developer")}</div>
        )}
        {showDeveloperNav && (
          <NavItem
            to="/apps"
            icon={<AppsRegular />}
            label={t("nav.myApps")}
            onNavigate={closeSidebar}
          />
        )}
        <NavItem
          to="/teams"
          icon={<PeopleRegular />}
          label={t("nav.teams")}
          onNavigate={closeSidebar}
        />
        {showDeveloperNav && (
          <NavItem
            to="/domains"
            icon={<GlobeRegular />}
            label={t("nav.domains")}
            onNavigate={closeSidebar}
          />
        )}
        {showDeveloperNav && (
          <NavItem
            to="/tokens"
            icon={<KeyRegular />}
            label={t("nav.tokens")}
            onNavigate={closeSidebar}
          />
        )}

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
        {/* The Profile / Security entries this menu used to carry duplicated the
            sidebar links above, so they were dropped. In their place the menu
            now hosts the appearance controls (language + theme) that previously
            sat in a separate button row, plus sign-out. */}
        <Menu
          checkedValues={{ theme: [themeMode] }}
          onCheckedValueChange={(_, data) => {
            const next = data.checkedItems[0] as ThemeMode | undefined;
            if (next) setThemeMode(next);
          }}
        >
          <MenuTrigger disableButtonEnhancement>
            <MenuButton
              appearance="subtle"
              style={{ width: "100%", justifyContent: "flex-start", gap: 8 }}
              icon={
                <Avatar
                  name={user?.display_name}
                  image={
                    user?.avatar_url ? { src: user.avatar_url } : undefined
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
              {/* Account switcher: every account signed in on this device, the
                  active one checked. Selecting another repoints the session;
                  "Add another account" opens the login form without dropping
                  the current session. */}
              <MenuGroup>
                <MenuGroupHeader>{t("account.accounts")}</MenuGroupHeader>
                {accounts.map((a) => {
                  const isActive = a.user.id === user?.id;
                  return (
                    <MenuItem
                      key={a.user.id}
                      disabled={busy !== null}
                      aria-label={
                        isActive
                          ? t("account.current", { name: a.user.display_name })
                          : undefined
                      }
                      onClick={() => {
                        if (!isActive) void handleSwitch(a.user.id);
                      }}
                      icon={
                        <Avatar
                          name={a.user.display_name}
                          image={
                            a.user.avatar_url
                              ? { src: a.user.avatar_url }
                              : undefined
                          }
                          size={24}
                        />
                      }
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          width: "100%",
                          minWidth: 180,
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Text
                            block
                            size={200}
                            weight={isActive ? "semibold" : "regular"}
                            truncate
                            style={{ maxWidth: 160 }}
                          >
                            {a.user.display_name}
                          </Text>
                          <Text
                            block
                            size={100}
                            truncate
                            style={{
                              maxWidth: 160,
                              color: tokens.colorNeutralForeground3,
                            }}
                          >
                            @{a.user.username}
                          </Text>
                        </div>
                        {isActive ? (
                          <CheckmarkRegular
                            style={{
                              flexShrink: 0,
                              color: tokens.colorCompoundBrandForeground1,
                            }}
                          />
                        ) : (
                          <Button
                            appearance="subtle"
                            size="small"
                            icon={<DismissRegular />}
                            aria-label={t("account.signOutOne", {
                              username: a.user.username,
                            })}
                            disabled={busy !== null}
                            style={{ flexShrink: 0 }}
                            onClick={(e) => {
                              // Don't let the row's switch handler fire too.
                              e.stopPropagation();
                              void handleSignOutOne(a);
                            }}
                          />
                        )}
                      </div>
                    </MenuItem>
                  );
                })}
                <MenuItem
                  icon={<PersonAddRegular />}
                  onClick={handleAddAccount}
                  disabled={busy !== null}
                >
                  {t("nav.addAccount")}
                </MenuItem>
                <MenuItem
                  icon={<PeopleRegular />}
                  onClick={() => setManageOpen(true)}
                  disabled={busy !== null}
                >
                  {t("account.manage")}
                </MenuItem>
              </MenuGroup>
              <MenuDivider />
              {/* Language toggle */}
              <MenuItem
                icon={<LocalLanguageRegular />}
                onClick={toggleLanguage}
              >
                {langLabel}
              </MenuItem>
              <MenuDivider />
              {/* Theme */}
              <MenuItemRadio
                name="theme"
                value="system"
                icon={<DesktopRegular />}
              >
                {t("theme.system")}
              </MenuItemRadio>
              <MenuItemRadio
                name="theme"
                value="light"
                icon={<WeatherSunnyRegular />}
              >
                {t("theme.light")}
              </MenuItemRadio>
              <MenuItemRadio
                name="theme"
                value="dark"
                icon={<WeatherMoonRegular />}
              >
                {t("theme.dark")}
              </MenuItemRadio>
              <MenuDivider />
              <MenuItem
                icon={<SignOutRegular />}
                onClick={() => void signOutActive()}
                disabled={busy !== null}
              >
                {t("nav.signOut")}
              </MenuItem>
              {accounts.length > 1 && (
                <MenuItem
                  onClick={() => void handleSignOutAll()}
                  disabled={busy !== null}
                >
                  {t("account.signOutAll")}
                </MenuItem>
              )}
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
            <Image
              src={site.site_icon_url}
              alt="logo"
              shape="rounded"
              fit="cover"
              width={24}
              height={24}
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
          {/* Above the page, not inside it — a notice about the instance is
              not part of whatever the user came here to do. */}
          <NoticeBoard />
          <Outlet />
        </div>
        <LegalFooter />
      </main>

      <ManageAccountsDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        accounts={accounts}
        activeUserId={user?.id}
        busy={busy !== null}
        onSwitch={(id) => void handleSwitch(id)}
        onSignOut={(a) => void handleSignOutOne(a)}
        onAddAccount={handleAddAccount}
        onSignOutAll={() => void handleSignOutAll()}
      />

      {/* Transient failures from switching / signing out. */}
      <Toaster toasterId={toasterId} />

      {/* Blocking feedback while an account swap is in flight. */}
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
