import { makeStyles, tokens } from "@fluentui/react-components";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldErrorRegular } from "@fluentui/react-icons";
import { StatusPage } from "../components/StatusPage";

const useStyles = makeStyles({
  icon: { fontSize: "48px", color: tokens.colorPaletteRedForeground1 },
});

export function Unauthorized() {
  const styles = useStyles();
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const appName = params.get("app_name") ?? "";
  return (
    <StatusPage
      mark={<ShieldErrorRegular className={styles.icon} />}
      title={t("unauthorized.title")}
      description={
        appName
          ? t("unauthorized.descriptionWithApp", { app: appName })
          : t("unauthorized.description")
      }
      back={t("unauthorized.goBack")}
      primary={{ label: t("unauthorized.goHome"), to: "/" }}
    />
  );
}
