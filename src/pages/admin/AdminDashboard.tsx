// Admin overview with stats

import {
  Button,
  MessageBar,
  Text,
  Title3,
  tokens,
} from "@fluentui/react-components";
import {
  AppsRegular,
  GlobeRegular,
  PersonRegular,
  PeopleTeamRegular,
  ImageRegular,
  ShieldRegular,
} from "@fluentui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useApi } from "../../lib/api-context";
import { SkeletonStatCards } from "../../components/Skeletons";
import type { AdminStats } from "../../lib/api";

function TrendLine({ values, label }: { values: number[]; label: string }) {
  const width = 180;
  const height = 44;
  const max = Math.max(1, ...values);
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const y = height - 3 - (value / max) * (height - 6);
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      style={{ width: "100%", height, overflow: "visible" }}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AdminDashboard() {
  const api = useApi();
  const { t } = useTranslation();
  const {
    data: stats,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: api.adminStats,
  });

  const STAT_CARDS = [
    {
      key: "users" as const,
      label: t("admin.totalUsers"),
      icon: <PersonRegular fontSize={24} />,
      trend: "users" as const,
    },
    {
      key: "teams" as const,
      label: t("admin.totalTeams"),
      icon: <PeopleTeamRegular fontSize={24} />,
      trend: "teams" as const,
    },
    {
      key: "apps" as const,
      label: t("admin.totalApps"),
      icon: <AppsRegular fontSize={24} />,
      trend: "apps" as const,
    },
    {
      key: "verified_domains" as const,
      label: t("admin.verifiedDomains"),
      icon: <GlobeRegular fontSize={24} />,
      trend: "verified_domains" as const,
    },
    {
      key: "active_tokens" as const,
      label: t("admin.activeTokens"),
      icon: <ShieldRegular fontSize={24} />,
      trend: null,
    },
    ...(stats?.proxied_images !== undefined
      ? [
          {
            key: "proxied_images" as const,
            label: t("admin.proxiedImages"),
            icon: <ImageRegular fontSize={24} />,
            trend: null,
          },
        ]
      : []),
  ];

  if (isLoading) return <SkeletonStatCards count={4} />;
  if (isError) {
    return (
      <MessageBar intent="error">
        {t("admin.statsError")}{" "}
        <Button
          size="small"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          {t("common.retry")}
        </Button>
      </MessageBar>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: 12,
      }}
    >
      {STAT_CARDS.map(({ key, label, icon, trend }) => (
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
          {trend && (
            <div style={{ color: tokens.colorBrandForeground1 }}>
              <TrendLine
                values={(stats as AdminStats).trends[trend]}
                label={t("admin.thirtyDayTrend", { label })}
              />
              <Text
                size={200}
                style={{ color: tokens.colorNeutralForeground3 }}
              >
                {t("admin.newLast30Days")}
              </Text>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
