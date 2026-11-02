// Landing page for OIDC RP-Initiated Logout when no (registered) post-logout
// redirect URI was supplied. The end_session endpoint has already ended the
// session and cleared the cookie by the time the browser arrives here.

import { makeStyles, tokens } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import { SignOutRegular } from "@fluentui/react-icons";
import { StatusPage } from "../components/StatusPage";

const useStyles = makeStyles({
  icon: { fontSize: "48px", color: tokens.colorNeutralForeground3 },
});

export function LoggedOut() {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <StatusPage
      mark={<SignOutRegular className={styles.icon} />}
      title={t("oauth.loggedOut.title")}
      description={t("oauth.loggedOut.body")}
      primary={{ label: t("oauth.loggedOut.backToSignIn"), to: "/login" }}
    />
  );
}
