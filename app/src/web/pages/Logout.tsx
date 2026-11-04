// A browser sign-out (/logout): the page every sign-out that passes through
// SAML apps, or that another site asked for, goes through.
//
// Each visit asks the API for the next step. A sign-out another site asked
// for (a SAML app's logout request, or OIDC end_session without proof of
// which app sent it) could be forged by any page, so the user confirms it
// here first. Then the browser carries each message: a LogoutRequest to the
// next SAML app, which answers at /saml/slo and sends the browser back here;
// finally the LogoutResponse to the app that started it, or on to where
// signing out goes.

import {
  Button,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { SamlLogoutStep } from "../lib/api";
import { apiErrorText } from "../lib/apiError";
import { useApi } from "../lib/api-context";
import { postForm } from "../lib/postForm";
import { useSiteName } from "../lib/useSiteName";
import { AuthShell } from "../components/AuthShell";
import { AuthFailure, AuthWaiting } from "../components/AuthStatus";

const useStyles = makeStyles({
  text: { display: "flex", flexDirection: "column", gap: "8px" },
  actions: { display: "flex", flexDirection: "column", gap: "8px" },
  muted: { color: tokens.colorNeutralForeground3 },
});

type Confirm = Extract<SamlLogoutStep, { kind: "confirm" }>;
type Message = Exclude<SamlLogoutStep, { kind: "confirm" }>;

/** Have the browser deliver the message. */
function carry(step: Message) {
  if (step.kind === "redirect") window.location.assign(step.url);
  else postForm(step.url, step.fields);
}

export function Logout() {
  const api = useApi();
  const styles = useStyles();
  const [params] = useSearchParams();
  const { t } = useTranslation();
  const siteName = useSiteName();

  // A logout another site asked for; without one, the logout this browser
  // began (the API knows it by cookie).
  const token = params.get("token");
  const linkError = params.get("error");
  const [failure, setFailure] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const advance = async (action?: "confirm" | "cancel") => {
    setBusy(true);
    try {
      const step = await api.samlLogoutStep(token, action);
      if (step.kind === "confirm") {
        setConfirm(step);
        setBusy(false);
      } else carry(step);
    } catch (err) {
      setBusy(false);
      setFailure(apiErrorText(err, t("logout.errorBody")));
    }
  };

  useEffect(() => {
    if (linkError || started.current) return;
    started.current = true;
    // Out of the effect body, so the state updates don't run during render.
    queueMicrotask(() => void advance());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- advance is stable enough; the ref guards against a second run
  }, [token, linkError]);

  const errorText =
    failure ??
    (linkError
      ? t(`apiErrors.${linkError}`, { defaultValue: t("logout.errorBody") })
      : null);

  if (errorText)
    return <AuthFailure title={t("logout.errorTitle")} text={errorText} />;

  if (confirm && !busy)
    return (
      <AuthShell maxWidth={440} cardGap={24}>
        <Title2>{t("logout.confirmTitle", { siteName })}</Title2>
        <div className={styles.text}>
          <Text>
            {confirm.app
              ? t("logout.confirmApp", { appName: confirm.app.name, siteName })
              : t("logout.confirmUnknown", { siteName })}
          </Text>
          <Text className={styles.muted}>{t("logout.confirmHint")}</Text>
        </div>
        <div className={styles.actions}>
          <Button appearance="primary" onClick={() => void advance("confirm")}>
            {t("logout.signOut")}
          </Button>
          <Button onClick={() => void advance("cancel")}>
            {t("logout.stay")}
          </Button>
        </div>
      </AuthShell>
    );

  return <AuthWaiting text={t("logout.signingOut")} />;
}
