// Admin overview with stats

import {
  Card,
  CardHeader,
  Spinner,
  Text,
  Title3,
  tokens,
} from "@fluentui/react-components";
import {
  AppsRegular,
  GlobeRegular,
  PersonRegular,
  ShieldRegular,
} from "@fluentui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";

export function AdminDashboard() {
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

  if (isLoading) return <Spinner />;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: 16,
      }}
    >
      {STAT_CARDS.map(({ key, label, icon }) => (
        <Card key={key}>
          <CardHeader
            image={
              <div style={{ color: tokens.colorBrandForeground1 }}>{icon}</div>
            }
            header={<Text weight="semibold">{label}</Text>}
          />
          <div style={{ padding: "0 16px 16px" }}>
            <Title3>{stats?.[key] ?? 0}</Title3>
          </div>
        </Card>
      ))}
    </div>
  );
}
