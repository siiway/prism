// Admin section layout with sub-navigation

import { Tab, TabList, Text, Title2, tokens } from "@fluentui/react-components";
import { useNavigate, useLocation, Outlet } from "react-router-dom";

const TABS = [
  { value: "/admin", label: "Overview" },
  { value: "/admin/users", label: "Users" },
  { value: "/admin/apps", label: "Applications" },
  { value: "/admin/teams", label: "Teams" },
  { value: "/admin/settings", label: "Settings" },
  { value: "/admin/audit", label: "Audit Log" },
];

export function AdminLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const currentTab =
    TABS.find(
      (t) =>
        pathname === t.value ||
        (t.value !== "/admin" && pathname.startsWith(t.value)),
    )?.value ?? "/admin";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <Title2>Admin Panel</Title2>
        <br />
        <Text style={{ color: tokens.colorNeutralForeground3 }}>
          Manage your Prism platform.
        </Text>
      </div>

      <TabList
        selectedValue={currentTab}
        onTabSelect={(_, d) => navigate(d.value as string)}
      >
        {TABS.map((t) => (
          <Tab key={t.value} value={t.value}>
            {t.label}
          </Tab>
        ))}
      </TabList>

      <Outlet />
    </div>
  );
}
