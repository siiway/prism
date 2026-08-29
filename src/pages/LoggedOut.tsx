// Landing page for OIDC RP-Initiated Logout when no (registered) post-logout
// redirect URI was supplied. The end_session endpoint has already ended the
// session and cleared the cookie by the time the browser arrives here.

import {
  Button,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SignOutRegular } from "@fluentui/react-icons";

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
  icon: { fontSize: "48px", color: tokens.colorNeutralForeground3 },
});

export function LoggedOut() {
  const styles = useStyles();
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <SignOutRegular className={styles.icon} />
        <Title2>{t("oauth.loggedOut.title")}</Title2>
        <Text style={{ color: tokens.colorNeutralForeground3 }}>
          {t("oauth.loggedOut.body")}
        </Text>
        <Button appearance="primary" onClick={() => navigate("/login")}>
          {t("oauth.loggedOut.backToSignIn")}
        </Button>
      </div>
    </div>
  );
}
