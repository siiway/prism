// User dashboard overview

import {
  Badge,
  Button,
  Card,
  CardHeader,
  Text,
  Title2,
  Title3,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AppsRegular,
  GlobeRegular,
  KeyRegular,
  LinkRegular,
  MailRegular,
  ShieldPersonRegular,
} from "@fluentui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { useAuthStore } from "../store/auth";

const useStyles = makeStyles({
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: "16px",
    marginTop: "24px",
  },
  statCard: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    cursor: "pointer",
    transition: "box-shadow 0.15s",
    ":hover": { boxShadow: tokens.shadow8 },
  },
  iconRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    color: tokens.colorBrandForeground1,
    fontSize: "20px",
  },
  welcome: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    marginBottom: "8px",
  },
  securityBanner: {
    padding: "16px",
    borderRadius: "8px",
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    marginTop: "24px",
    flexWrap: "wrap",
  },
});

export function Dashboard() {
  const styles = useStyles();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { t } = useTranslation();

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me });
  const { data: appsData } = useQuery({
    queryKey: ["apps"],
    queryFn: api.listApps,
  });
  const { data: domainsData } = useQuery({
    queryKey: ["domains"],
    queryFn: api.listDomains,
  });
  const { data: connectionsData } = useQuery({
    queryKey: ["connections"],
    queryFn: api.listConnections,
  });

  const showEmailBanner = me?.user.email_verified === false;
  const showSecurityWarning =
    !me?.totp_enabled && (me?.passkey_count ?? 0) === 0;

  const passkeyCount = me?.passkey_count ?? 0;

  return (
    <div>
      <div className={styles.welcome}>
        <Title2>
          {t("dashboard.welcomeBack", { name: user?.display_name })}
        </Title2>
        <Text style={{ color: tokens.colorNeutralForeground3 }}>
          {t("dashboard.manageDesc")}
        </Text>
      </div>

      {showEmailBanner && (
        <div className={styles.securityBanner}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <MailRegular fontSize={24} />
            <div>
              <Text weight="semibold" block>
                {t("dashboard.verifyEmailTitle")}
              </Text>
              <Text
                size={200}
                style={{ color: tokens.colorNeutralForeground3 }}
              >
                {t("dashboard.verifyEmailDesc")}
              </Text>
            </div>
          </div>
          <Button
            appearance="primary"
            size="small"
            onClick={() => navigate("/verify-choose")}
          >
            {t("dashboard.verifyNow")}
          </Button>
        </div>
      )}

      {showSecurityWarning && (
        <div className={styles.securityBanner}>
          <div>
            <Text weight="semibold" block>
              {t("dashboard.improveSecurityTitle")}
            </Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {t("dashboard.improveSecurityDesc")}
            </Text>
          </div>
          <Button
            appearance="primary"
            size="small"
            onClick={() => navigate("/security")}
          >
            {t("dashboard.setUp2FA")}
          </Button>
        </div>
      )}

      <div className={styles.grid}>
        <Card className={styles.statCard} onClick={() => navigate("/apps")}>
          <CardHeader
            image={
              <AppsRegular fontSize={24} color={tokens.colorBrandForeground1} />
            }
            header={
              <Text weight="semibold">{t("dashboard.applications")}</Text>
            }
          />
          <div style={{ padding: "0 16px 16px" }}>
            <Title3>{appsData?.apps.length ?? 0}</Title3>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {t("dashboard.oauthAppsRegistered")}
            </Text>
          </div>
        </Card>

        <Card className={styles.statCard} onClick={() => navigate("/domains")}>
          <CardHeader
            image={
              <GlobeRegular
                fontSize={24}
                color={tokens.colorBrandForeground1}
              />
            }
            header={<Text weight="semibold">{t("dashboard.domainsCard")}</Text>}
          />
          <div style={{ padding: "0 16px 16px" }}>
            <Title3>
              {domainsData?.domains.filter((d) => d.verified).length ?? 0}
              <Text
                size={300}
                style={{ color: tokens.colorNeutralForeground3 }}
              >
                /{domainsData?.domains.length ?? 0}
              </Text>
            </Title3>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {t("dashboard.verifiedDomains")}
            </Text>
          </div>
        </Card>

        <Card
          className={styles.statCard}
          onClick={() => navigate("/connections")}
        >
          <CardHeader
            image={
              <LinkRegular fontSize={24} color={tokens.colorBrandForeground1} />
            }
            header={
              <Text weight="semibold">{t("dashboard.linkedAccountsCard")}</Text>
            }
          />
          <div style={{ padding: "0 16px 16px" }}>
            <Title3>{connectionsData?.connections.length ?? 0}</Title3>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {t("dashboard.connectedPlatforms")}
            </Text>
          </div>
        </Card>

        <Card className={styles.statCard} onClick={() => navigate("/security")}>
          <CardHeader
            image={
              <ShieldPersonRegular
                fontSize={24}
                color={tokens.colorBrandForeground1}
              />
            }
            header={
              <Text weight="semibold">{t("dashboard.securityCard")}</Text>
            }
          />
          <div
            style={{
              padding: "0 16px 16px",
              display: "flex",
              gap: "6px",
              flexWrap: "wrap",
            }}
          >
            <Badge
              color={me?.totp_enabled ? "success" : "subtle"}
              appearance="filled"
            >
              {me?.totp_enabled
                ? t("security.twoFaEnabled")
                : t("security.twoFaOff")}
            </Badge>
            <Badge
              color={passkeyCount > 0 ? "success" : "subtle"}
              appearance="filled"
            >
              {passkeyCount === 1
                ? t("security.passkeyCount", { count: passkeyCount })
                : t("security.passkeysCount", { count: passkeyCount })}
            </Badge>
          </div>
        </Card>

        {me?.passkey_count === 0 && (
          <Card
            className={styles.statCard}
            onClick={() => navigate("/security")}
          >
            <CardHeader
              image={
                <KeyRegular
                  fontSize={24}
                  color={tokens.colorBrandForeground1}
                />
              }
              header={
                <Text weight="semibold">{t("dashboard.addPasskeyCard")}</Text>
              }
            />
            <div style={{ padding: "0 16px 16px" }}>
              <Text
                size={200}
                style={{ color: tokens.colorNeutralForeground3 }}
              >
                {t("dashboard.addPasskeyDesc")}
              </Text>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
