// The app identity block shown above an OAuth consent decision: icon, name,
// official/verified badges, website, the public-client warning, and who the
// user is signing in as. Rendered identically by the authorize page and the
// 2FA step, so it lives here rather than in both.

import {
  Avatar,
  Badge,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  GlobeRegular,
  ShieldRegular,
  WarningRegular,
} from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";

const useStyles = makeStyles({
  appRow: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    padding: "16px",
    background: tokens.colorNeutralBackground3,
    borderRadius: "8px",
  },
  publicClientWarning: {
    padding: "12px 14px",
    borderRadius: "8px",
    border: `1px solid ${tokens.colorPaletteMarigoldBorder1}`,
    background: tokens.colorPaletteMarigoldBackground1,
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
  },
});

interface ConsentApp {
  name: string;
  icon_url?: string | null;
  website_url?: string | null;
  is_official?: boolean;
  is_verified?: boolean;
  is_public?: boolean;
}

interface ConsentUser {
  username: string;
  display_name: string;
  avatar_url?: string | null;
}

export function OAuthConsentHeader({
  app,
  user,
}: {
  app: ConsentApp;
  user: ConsentUser;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <>
      <div className={styles.appRow}>
        {app.icon_url ? (
          <Avatar image={{ src: app.icon_url }} name={app.name} size={48} />
        ) : (
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 8,
              background: tokens.colorBrandBackground,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <GlobeRegular
              fontSize={24}
              style={{ color: tokens.colorNeutralForegroundOnBrand }}
            />
          </div>
        )}
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Text weight="semibold" size={400}>
              {app.name}
            </Text>
            {app.is_official && (
              <Badge color="brand" appearance="filled" size="small">
                {t("oauth.official")}
              </Badge>
            )}
            {app.is_verified && (
              <Badge
                color="success"
                appearance="filled"
                size="small"
                icon={<ShieldRegular />}
              >
                {t("oauth.verified")}
              </Badge>
            )}
          </div>
          {app.website_url && (
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {app.website_url}
            </Text>
          )}
        </div>
      </div>

      {app.is_public && (
        <div className={styles.publicClientWarning}>
          <WarningRegular
            fontSize={20}
            style={{
              color: tokens.colorPaletteMarigoldForeground1,
              flexShrink: 0,
              marginTop: 2,
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Text
              weight="semibold"
              size={300}
              style={{ color: tokens.colorPaletteMarigoldForeground1 }}
            >
              {t("oauth.publicClientWarningTitle")}
            </Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
              {t("oauth.publicClientWarningDesc")}
            </Text>
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          {t("oauth.signingInAs")}
        </Text>
        <Avatar
          name={user.display_name}
          image={user.avatar_url ? { src: user.avatar_url } : undefined}
          size={20}
        />
        <Text size={200} weight="semibold">
          @{user.username}
        </Text>
      </div>
    </>
  );
}
