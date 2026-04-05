// Apps card grid for TeamDetail

import {
  Card,
  CardHeader,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { GlobeRegular } from "@fluentui/react-icons";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { OAuthApp } from "../../lib/api";

const useStyles = makeStyles({
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: "16px",
    marginTop: "16px",
  },
  appCard: {
    cursor: "pointer",
    transition: "box-shadow 0.15s",
    ":hover": { boxShadow: tokens.shadow8 },
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

  if (loading) return <Spinner />;

  if (apps.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 0" }}>
        <GlobeRegular
          fontSize={40}
          style={{ color: tokens.colorNeutralForeground3 }}
        />
        <Text
          block
          style={{ marginTop: 12, color: tokens.colorNeutralForeground3 }}
        >
          {t("teams.noAppsInTeam")}
        </Text>
      </div>
    );
  }

  return (
    <div className={styles.grid}>
      {apps.map((app) => (
        <Card
          key={app.id}
          className={styles.appCard}
          onClick={() => navigate(`/apps/${app.id}`)}
        >
          <CardHeader
            image={
              app.icon_url ? (
                <img
                  src={app.icon_url}
                  alt={app.name}
                  width={32}
                  height={32}
                  style={{ borderRadius: 4 }}
                />
              ) : (
                <GlobeRegular fontSize={32} />
              )
            }
            header={<Text weight="semibold">{app.name}</Text>}
            description={app.description || app.client_id}
          />
        </Card>
      ))}
    </div>
  );
}
