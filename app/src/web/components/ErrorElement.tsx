import { Button, Text, makeStyles, tokens } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import { useRouteError } from "react-router-dom";

const useStyles = makeStyles({
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: tokens.colorNeutralBackground1,
    padding: "32px 16px",
    boxSizing: "border-box",
  },
  card: {
    width: "100%",
    maxWidth: "400px",
    padding: "32px",
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    textAlign: "center",
  },
});

export function ErrorElement() {
  const styles = useStyles();
  const { t } = useTranslation();
  const error = useRouteError();

  const isChunkError =
    error instanceof Error &&
    (error.message.includes("error loading dynamically imported module") ||
      error.message.includes("Failed to fetch dynamically imported module") ||
      error.message.includes("Importing a module script failed") ||
      error.name === "ChunkLoadError");

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <Text size={500} weight="semibold">
          {isChunkError
            ? t("error.chunkLoadTitle")
            : t("error.genericErrorTitle")}
        </Text>
        <Text style={{ color: tokens.colorNeutralForeground3 }}>
          {isChunkError
            ? t("error.chunkLoadDesc")
            : t("error.genericErrorDesc")}
        </Text>
        <Button appearance="primary" onClick={() => window.location.reload()}>
          {t("error.refreshPage")}
        </Button>
      </div>
    </div>
  );
}
