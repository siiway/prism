// Apps card grid for TeamDetail

import { Image, Text, makeStyles, tokens } from "@fluentui/react-components";
import { EmptyState } from "../../components/EmptyState";
import { SkeletonAppCards } from "../../components/Skeletons";
import { GlobeRegular } from "@fluentui/react-icons";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { OAuthApp } from "../../lib/api";

const useStyles = makeStyles({
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: "12px",
    marginTop: "16px",
  },
  appCard: {
    cursor: "pointer",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "10px",
    padding: "16px",
    background: tokens.colorNeutralBackground1,
    transition: "border-color 0.15s",
    ":hover": {
      borderTopColor: tokens.colorNeutralForeground1,
      borderRightColor: tokens.colorNeutralForeground1,
      borderBottomColor: tokens.colorNeutralForeground1,
      borderLeftColor: tokens.colorNeutralForeground1,
    },
  },
});

interface AppsGridProps {
  apps: OAuthApp[];
  loading: boolean;
}

export function AppsGrid({ apps, loading }: AppsGridProps) {
  const styles = useStyles();
  const navigate = useNavigate();
  const { t } = useTranslation();

  if (loading) return <SkeletonAppCards count={4} />;

  if (apps.length === 0) {
    return (
      <EmptyState icon={<GlobeRegular />} title={t("teams.noAppsInTeam")} />
    );
  }

  return (
    <div className={styles.grid}>
      {apps.map((app) => (
        <div
          key={app.id}
          className={styles.appCard}
          onClick={() => navigate(`/apps/${app.id}`)}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            {app.icon_url ? (
              <Image
                src={app.icon_url}
                alt={app.name}
                shape="rounded"
                fit="cover"
                width={32}
                height={32}
              />
            ) : (
              <GlobeRegular fontSize={32} />
            )}
            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <Text weight="semibold">{app.name}</Text>
              {app.description && (
                <Text
                  size={200}
                  style={{
                    color: tokens.colorNeutralForeground3,
                    wordBreak: "break-all",
                  }}
                >
                  {app.description}
                </Text>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
