// 404 page rendered for any unmatched route. Shipped from the SSR catch-all
// with a 404 status so it's a real "not found" response and not just a
// client-side flash after navigation.

import { Text, makeStyles, tokens } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import { StatusPage } from "../components/StatusPage";

const useStyles = makeStyles({
  code: {
    fontFamily: "monospace",
    fontSize: "72px",
    lineHeight: 1,
    color: tokens.colorBrandForeground1,
    letterSpacing: "-2px",
  },
});

export function NotFound() {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <StatusPage
      mark={
        <Text className={styles.code} weight="semibold">
          404
        </Text>
      }
      title={t("notFound.title")}
      description={t("notFound.description")}
      back={t("notFound.goBack")}
      primary={{ label: t("notFound.goHome"), to: "/" }}
    />
  );
}
