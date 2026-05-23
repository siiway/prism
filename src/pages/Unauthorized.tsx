import {
  Button,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldErrorRegular } from "@fluentui/react-icons";

const useStyles = makeStyles({
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: tokens.colorNeutralBackground1,
    padding: "16px",
    boxSizing: "border-box",
  },
  card: {
    width: "100%",
    maxWidth: "480px",
    padding: "48px 40px",
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground2,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "16px",
    textAlign: "center",
  },
  icon: {
    fontSize: "48px",
    color: tokens.colorPaletteRedForeground1,
  },
  actions: {
    display: "flex",
    gap: "8px",
    marginTop: "8px",
  },
});

export function Unauthorized() {
  const styles = useStyles();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const appName = params.get("app_name") ?? "";

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <ShieldErrorRegular className={styles.icon} />
        <Title2>{t("unauthorized.title")}</Title2>
        <Text style={{ color: tokens.colorNeutralForeground3 }}>
          {appName
            ? t("unauthorized.descriptionWithApp", { app: appName })
            : t("unauthorized.description")}
        </Text>
        <div className={styles.actions}>
          <Button onClick={() => navigate(-1)}>
            {t("unauthorized.goBack")}
          </Button>
          <Button appearance="primary" onClick={() => navigate("/")}>
            {t("unauthorized.goHome")}
          </Button>
        </div>
      </div>
    </div>
  );
}
