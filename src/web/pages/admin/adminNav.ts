// Admin section navigation, shared by the sidebar (which swaps to this list
// while inside /admin, Cloudflare-style) and AdminLayout (which titles each
// page from the matching entry).

import {
  AlertRegular,
  AppsRegular,
  BotRegular,
  DataBarVerticalRegular,
  DatabaseRegular,
  ErrorCircleRegular,
  GavelRegular,
  GlobeRegular,
  ImageRegular,
  KeyMultipleRegular,
  MailRegular,
  MegaphoneRegular,
  PaintBrushRegular,
  PeopleSettingsRegular,
  PeopleTeamRegular,
  PersonAddRegular,
  PersonCircleRegular,
  PersonRegular,
  PlugConnectedRegular,
  SettingsRegular,
  ShieldLockRegular,
  ShieldTaskRegular,
  WarningRegular,
  type FluentIcon,
} from "@fluentui/react-icons";
import { useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useApi } from "../../lib/api-context";

/** Site settings sections, each at /admin/settings/<section>. */
export const SETTINGS_SECTIONS = [
  "general",
  "signup",
  "auth",
  "teams",
  "profiles",
  "captcha",
  "email",
  "appearance",
  "legal",
  "danger",
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export function isSettingsSection(
  value: string | undefined,
): value is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value ?? "");
}

const SETTINGS_ICONS: Record<SettingsSection, FluentIcon> = {
  general: SettingsRegular,
  signup: PersonAddRegular,
  auth: ShieldLockRegular,
  teams: PeopleSettingsRegular,
  profiles: PersonCircleRegular,
  captcha: BotRegular,
  email: AlertRegular,
  appearance: PaintBrushRegular,
  legal: GavelRegular,
  danger: WarningRegular,
};

export interface AdminNavItem {
  to: string;
  label: string;
  description: string;
  icon: FluentIcon;
}

export interface AdminNavGroup {
  /** Group label; omitted for the leading Overview entry. */
  label?: string;
  items: AdminNavItem[];
}

export function useAdminNav(): AdminNavGroup[] {
  const api = useApi();
  const { t } = useTranslation();

  // Both storage consoles are off unless an operator turned them on, so the
  // Database entry is absent by default. Shown if *either* is available:
  // they share a page, and a KV-only instance still needs a way in. Shares
  // query keys with the page itself, so this costs one request per session.
  const { data: dbStatus } = useQuery({
    queryKey: ["admin-db-status"],
    queryFn: () => api.adminDbStatus(),
    staleTime: 5 * 60 * 1000,
  });
  const { data: kvStatus } = useQuery({
    queryKey: ["admin-kv-status"],
    queryFn: () => api.adminKvStatus(),
    staleTime: 5 * 60 * 1000,
  });
  const storageConsole =
    (dbStatus && dbStatus.mode !== "off") ||
    (kvStatus && kvStatus.mode !== "off");
  return buildAdminNav(t, !!storageConsole);
}

/** The admin navigation, without fetching anything: also used by search,
 *  which must not call admin endpoints for everyone who opens it. */
export function buildAdminNav(
  t: TFunction,
  storageConsole: boolean,
): AdminNavGroup[] {
  const item = (
    to: string,
    key: string,
    labelKey: string,
    icon: FluentIcon,
  ): AdminNavItem => ({
    to,
    label: t(labelKey),
    description: t(`admin.sectionDesc.${key}`),
    icon,
  });

  const settingsItem = (section: SettingsSection) =>
    item(
      `/admin/settings/${section}`,
      `settings.${section}`,
      `admin.settingsNav.${section}`,
      SETTINGS_ICONS[section],
    );

  return [
    {
      items: [
        item("/admin", "overview", "admin.overview", DataBarVerticalRegular),
      ],
    },
    {
      label: t("admin.navGroupPeople"),
      items: [
        item("/admin/users", "users", "admin.usersTab", PersonRegular),
        item("/admin/teams", "teams", "admin.teamsTab", PeopleTeamRegular),
        item("/admin/invites", "invites", "admin.invitesTab", MailRegular),
      ],
    },
    {
      label: t("admin.navGroupAccess"),
      items: [
        item("/admin/apps", "apps", "admin.applicationsTab", AppsRegular),
        item(
          "/admin/connections",
          "connections",
          "admin.connectionsTab",
          PlugConnectedRegular,
        ),
        item(
          "/admin/scope-grants",
          "scopeGrants",
          "admin.scopeGrantsTab",
          KeyMultipleRegular,
        ),
        item("/admin/domains", "domains", "admin.domainsTab", GlobeRegular),
      ],
    },
    {
      // The settings sections are listed directly rather than behind one
      // "Settings" entry with its own tab row. Danger Zone lives under
      // Maintenance: it holds one-off migrations and resets, not settings.
      label: t("admin.settingsTab"),
      items: [
        ...SETTINGS_SECTIONS.filter((section) => section !== "danger").map(
          settingsItem,
        ),
        item("/admin/notices", "notices", "admin.noticesTab", MegaphoneRegular),
      ],
    },
    {
      label: t("admin.navGroupMonitoring"),
      items: [
        item("/admin/audit", "audit", "admin.auditLogTab", ShieldTaskRegular),
        item(
          "/admin/login-errors",
          "loginErrors",
          "admin.loginErrorsTab",
          ErrorCircleRegular,
        ),
      ],
    },
    {
      label: t("admin.navGroupMaintenance"),
      items: [
        item(
          "/admin/image-proxy",
          "imageProxy",
          "admin.imageProxyTab",
          ImageRegular,
        ),
        ...(storageConsole
          ? [
              item(
                "/admin/database",
                "database",
                "admin.databaseTab",
                DatabaseRegular,
              ),
            ]
          : []),
        settingsItem("danger"),
      ],
    },
  ];
}
