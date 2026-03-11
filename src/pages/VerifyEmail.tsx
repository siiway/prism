// Email verification result page — shown after clicking the link in the verification email

import {
  Button,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  CheckmarkCircleRegular,
  DismissCircleRegular,
} from "@fluentui/react-icons";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../store/auth";

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
    maxWidth: "440px",
    padding: "40px",
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground2,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "16px",
    textAlign: "center",
  },
});

export function VerifyEmail() {
  const styles = useStyles();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { token } = useAuthStore();
  const qc = useQueryClient();

  const status = params.get("status");
  const success = status === "success";

  // Invalidate cached user data so email_verified updates
  if (success && token) {
    qc.invalidateQueries({ queryKey: ["me"] });
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {success ? (
          <CheckmarkCircleRegular
            fontSize={48}
            style={{ color: tokens.colorPaletteGreenForeground1 }}
          />
        ) : (
          <DismissCircleRegular
            fontSize={48}
            style={{ color: tokens.colorPaletteRedForeground1 }}
          />
        )}

        <Title2>
          {success
            ? t("verifyEmail.successTitle")
            : t("verifyEmail.invalidTitle")}
        </Title2>

        <Text style={{ color: tokens.colorNeutralForeground3 }}>
          {success
            ? t("verifyEmail.successDesc")
            : t("verifyEmail.invalidDesc")}
        </Text>

        <Button
          appearance="primary"
          onClick={() => navigate(token ? "/" : "/login")}
          style={{ marginTop: 8 }}
        >
          {token ? t("verifyEmail.goToDashboard") : t("verifyEmail.goToLogin")}
        </Button>
      </div>
    </div>
  );
}
