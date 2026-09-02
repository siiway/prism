// Admin overview with stats

import { Text, Title3, tokens } from "@fluentui/react-components";
import {
  AppsRegular,
  GlobeRegular,
  PersonRegular,
  ShieldRegular,
} from "@fluentui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useApi } from "../../lib/api-context";
import { SkeletonStatCards } from "../../components/Skeletons";

export function AdminDashboard() {
  const api = useApi();
  const { t } = useTranslation();

  const STAT_CARDS = [
    {
      key: "users" as const,
      label: t("admin.totalUsers"),
      icon: <PersonRegular fontSize={24} />,
    },
    {
      key: "apps" as const,
      label: t("admin.totalApps"),
      icon: <AppsRegular fontSize={24} />,
    },
    {
      key: "verified_domains" as const,
      label: t("admin.verifiedDomains"),
      icon: <GlobeRegular fontSize={24} />,
    },
    {
      key: "active_tokens" as const,
      label: t("admin.activeTokens"),
      icon: <ShieldRegular fontSize={24} />,
    },
  ];

  const { data: stats, isLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: api.adminStats,
  });

  if (isLoading) return <SkeletonStatCards count={4} />;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: 12,
      }}
    >
      {STAT_CARDS.map(({ key, label, icon }) => (
        <div
          key={key}
          style={{
            border: `1px solid ${tokens.colorNeutralStroke1}`,
            borderRadius: 10,
            padding: 16,
            background: tokens.colorNeutralBackground1,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: tokens.colorBrandForeground1,
            }}
          >
            {icon}
            <Text weight="semibold">{label}</Text>
          </div>
          <Title3>{stats?.[key] ?? 0}</Title3>
        </div>
      ))}
    </div>
  );
}
