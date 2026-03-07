// App shell layout with navigation

import {
  Avatar,
  Menu,
  MenuButton,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AppsRegular,
  GlobeRegular,
  HomeRegular,
  KeyRegular,
  LinkRegular,
  LockClosedRegular,
  PersonRegular,
  SettingsRegular,
  ShieldPersonRegular,
  SignOutRegular,
} from "@fluentui/react-icons";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuthStore } from "../store/auth";

const useStyles = makeStyles({
  shell: {
    display: "flex",
    height: "100vh",
    overflow: "hidden",
  },
  sidebar: {
    width: "240px",
    display: "flex",
    flexDirection: "column",
    borderRight: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground2,
    flexShrink: 0,
  },
  logo: {
    padding: "20px 16px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    display: "flex",
    alignItems: "center",
    gap: "10px",
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
  },
  content: {
    flex: 1,
    padding: "32px",
    maxWidth: "960px",
    width: "100%",
    margin: "0 auto",
  },
});

interface NavItemProps {
  to: string;
  icon: React.ReactElement;
  label: string;
  end?: boolean;
}

function NavItem({ to, icon, label, end }: NavItemProps) {
  const styles = useStyles();
  return (
    <NavLink
      to={to}
      end={end}
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
  const { user, clearAuth } = useAuthStore();
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

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          {site?.site_icon_url && (
            <img
              src={site.site_icon_url}
              alt="logo"
              style={{ width: 28, height: 28, borderRadius: 4 }}
            />
          )}
          <Text weight="semibold" size={400}>
            {site?.site_name ?? "Prism"}
          </Text>
        </div>

        <nav className={styles.nav}>
          <NavItem to="/" icon={<HomeRegular />} label="Dashboard" end />
          <NavItem to="/profile" icon={<PersonRegular />} label="Profile" />
          <NavItem
            to="/security"
            icon={<ShieldPersonRegular />}
            label="Security"
          />

          <div className={styles.navSection}>Developer</div>
          <NavItem to="/apps" icon={<AppsRegular />} label="My Apps" />
          <NavItem to="/domains" icon={<GlobeRegular />} label="Domains" />

          <div className={styles.navSection}>Connections</div>
          <NavItem
            to="/connections"
            icon={<LinkRegular />}
            label="Linked Accounts"
          />
          <NavItem
            to="/connected-apps"
            icon={<LockClosedRegular />}
            label="Connected Apps"
          />

          {user?.role === "admin" && (
            <>
              <div className={styles.navSection}>Admin</div>
              <NavItem
                to="/admin"
                icon={<SettingsRegular />}
                label="Admin Panel"
              />
            </>
          )}
        </nav>

        <div className={styles.userArea}>
          <Menu>
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
                <MenuItem
                  icon={<PersonRegular />}
                  onClick={() => navigate("/profile")}
                >
                  Profile
                </MenuItem>
                <MenuItem
                  icon={<KeyRegular />}
                  onClick={() => navigate("/security")}
                >
                  Security
                </MenuItem>
                <MenuDivider />
                <MenuItem icon={<SignOutRegular />} onClick={handleLogout}>
                  Sign out
                </MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </div>
      </aside>

      <main className={styles.main}>
        <div className={styles.content}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
