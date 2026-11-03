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
  Spinner,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { DismissCircleRegular } from "@fluentui/react-icons";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { SamlLogoutStep } from "../lib/api";
import { apiErrorText } from "../lib/apiError";
import { useApi } from "../lib/api-context";
import { useSiteName } from "../lib/useSiteName";
import { AuthShell } from "../components/AuthShell";

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
  center: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    alignItems: "center",
    textAlign: "center",
  },
  text: { display: "flex", flexDirection: "column", gap: "8px" },
  actions: { display: "flex", flexDirection: "column", gap: "8px" },
  muted: { color: tokens.colorNeutralForeground3 },
});

type Confirm = Extract<SamlLogoutStep, { kind: "confirm" }>;
type Message = Exclude<SamlLogoutStep, { kind: "confirm" }>;

/** Have the browser deliver the message. */
function carry(step: Message) {
  if (step.kind === "redirect") {
    window.location.assign(step.url);
    return;
  }
  const form = document.createElement("form");
  form.method = "POST";
  form.action = step.url;
  form.style.display = "none";
  for (const [name, value] of Object.entries(step.fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

export function Logout() {
  const api = useApi();
  const styles = useStyles();
  const [params] = useSearchParams();
  const { t } = useTranslation();
  const siteName = useSiteName();

  const token = params.get("token") ?? "";
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
    if (!token || linkError || started.current) return;
    started.current = true;
    // Out of the effect body, so the state updates don't run during render.
    queueMicrotask(() => void advance());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- advance is stable enough; the ref guards against a second run
  }, [token, linkError]);

  const errorText =
    failure ??
    (linkError
      ? t(`apiErrors.${linkError}`, { defaultValue: t("logout.errorBody") })
      : !token
        ? t("apiErrors.saml_logout_expired")
        : null);

  if (errorText)
    return (
      <AuthShell maxWidth={440} cardGap={24}>
        <div className={styles.center}>
          <DismissCircleRegular
            fontSize={48}
            style={{ color: tokens.colorPaletteRedForeground1 }}
          />
          <Title2>{t("logout.errorTitle")}</Title2>
          <Text>{errorText}</Text>
        </div>
      </AuthShell>
    );

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

  return (
    <div className={styles.page}>
      <div className={styles.center}>
        <Spinner size="large" />
        <Text className={styles.muted}>{t("logout.signingOut")}</Text>
      </div>
    </div>
  );
}
