// SAML sign-in: the page an AuthnRequest lands on (/saml/authorize).
//
// The worker parked the request and sent the browser here. The API says what
// happens next: sign in (again, for ForceAuthn), ask for consent, go straight
// on, or decline (an IsPassive request that can't be answered silently).
// The first sign-in to an app also asks which SAML profile it gets, when the
// user has shared ones to pick from (pages/samlProfiles): on the consent
// page, or on its own ("profile") when consent is already settled.
// Every outcome ends with a Response the page POSTs to the service provider.
//
// There is no route loader requiring a session: an IsPassive request must
// get its answer without a login screen, so the page decides when to send
// the user to /login.

import {
  Button,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { CheckmarkRegular, DismissRegular } from "@fluentui/react-icons";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../lib/api";
import { apiErrorText } from "../../lib/apiError";
import { useApi } from "../../lib/api-context";
import { postForm } from "../../lib/postForm";
import { scopeLabel } from "../../lib/scopeLabels";
import { useSiteName } from "../../lib/useSiteName";
import { AuthShell } from "../../components/AuthShell";
import { AppScopeList } from "../../components/AppScopeList";
import { AuthFailure, AuthWaiting } from "../../components/AuthStatus";
import { OAuthConsentHeader } from "../../components/OAuthConsentHeader";
import { ProfileChoice } from "./ProfileChoice";

const useStyles = makeStyles({
  scopeList: { display: "flex", flexDirection: "column", gap: "8px" },
  scopeItem: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: tokens.fontSizeBase300,
  },
  actions: { display: "flex", flexDirection: "column", gap: "8px" },
  divider: {
    borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
    margin: "0 calc(-1 * var(--auth-card-pad, 40px))",
  },
  center: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    alignItems: "center",
    textAlign: "center",
  },
  muted: { color: tokens.colorNeutralForeground3 },
  footer: { color: tokens.colorNeutralForeground4, textAlign: "center" },
});

/** Sign-in, coming back to this page after. */
const loginUrl = (reauth = false) =>
  `/login?redirect=${encodeURIComponent(
    window.location.pathname + window.location.search,
  )}${reauth ? "&reauth=1" : ""}`;

export function SamlAuthorize() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { t } = useTranslation();
  const siteName = useSiteName();

  const token = params.get("request") ?? "";
  const linkError = params.get("error");
  const [failure, setFailure] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const started = useRef(false);

  const { data, error } = useQuery({
    queryKey: ["saml-request", token],
    queryFn: () => api.getSamlRequest(token),
    enabled: !!token && !linkError,
    retry: false,
    // The answer depends on the session; never reuse a stale one.
    gcTime: 0,
  });

  // On a first sign-in with shared profiles to pick from: which one the app
  // gets, or "new" for its own per-app profile.
  const [profileChoice, setProfileChoice] = useState("new");

  const decide = async (
    action: "approve" | "deny" | "decline",
    mode?: "once" | "always",
  ) => {
    setPosting(true);
    try {
      // The Response goes to the service provider by the HTTP-POST binding.
      const p = await api.samlDecision(
        token,
        action,
        mode,
        action === "approve" ? profileChoice : undefined,
      );
      postForm(p.acs_url, {
        SAMLResponse: p.saml_response,
        RelayState: p.relay_state,
      });
    } catch (err) {
      setPosting(false);
      if (err instanceof ApiError && err.code === "unauthorized") {
        navigate(loginUrl(), { replace: true });
        return;
      }
      setFailure(apiErrorText(err, t("saml.errorBody")));
    }
  };

  // Steps that need no input from the user.
  useEffect(() => {
    if (!data || started.current) return;
    if (data.next === "consent" || data.next === "profile") return;
    started.current = true;
    if (data.next === "login" || data.next === "reauth")
      navigate(loginUrl(data.next === "reauth"), { replace: true });
    else {
      const action = data.next === "continue" ? "approve" : "decline";
      // Out of the effect body, so the decision's state updates don't run
      // during render.
      queueMicrotask(() => void decide(action, "once"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- decide is stable enough; the ref guards against a second run
  }, [data, navigate]);

  const errorText =
    failure ??
    (linkError
      ? t(`apiErrors.${linkError}`, { defaultValue: t("saml.errorBody") })
      : !token
        ? t("apiErrors.saml_request_invalid")
        : error
          ? apiErrorText(error, t("saml.errorBody"))
          : null);

  if (errorText)
    return <AuthFailure title={t("saml.errorTitle")} text={errorText} />;

  if (!data || posting || (data.next !== "consent" && data.next !== "profile"))
    return (
      <AuthWaiting
        text={data && t("saml.signingIn", { appName: data.app.name })}
      />
    );

  // The account may not use this app: say why, and let the user go back to
  // the service provider with a refusal instead of leaving it hanging.
  if (data.error)
    return (
      <AuthShell maxWidth={440} cardGap={24}>
        {data.user && <OAuthConsentHeader app={data.app} user={data.user} />}
        <div className={styles.center}>
          <Title2>{t("saml.errorTitle")}</Title2>
          <Text>{t(`apiErrors.${data.error}`)}</Text>
          <Button appearance="primary" onClick={() => void decide("deny")}>
            {t("saml.returnToApp", { appName: data.app.name })}
          </Button>
        </div>
      </AuthShell>
    );

  // Which profile the app gets, on a first sign-in with shared ones to pick
  // from. On its own page when consent is already settled.
  const profilePicker = data.profile_choices.length > 0 && (
    <>
      <div className={styles.divider} />
      <ProfileChoice
        appName={data.app.name}
        profiles={data.profile_choices}
        value={profileChoice}
        onChange={setProfileChoice}
      />
    </>
  );

  if (data.next === "profile")
    return (
      <AuthShell maxWidth={440} cardGap={24}>
        <Title2>{t("saml.title", { appName: data.app.name })}</Title2>
        {data.user && <OAuthConsentHeader app={data.app} user={data.user} />}
        {profilePicker}
        <div className={styles.divider} />
        <div className={styles.actions}>
          <Button
            appearance="primary"
            onClick={() => void decide("approve", "once")}
          >
            {t("saml.continue")}
          </Button>
          <Button appearance="outline" onClick={() => void decide("deny")}>
            {t("common.cancel")}
          </Button>
        </div>
      </AuthShell>
    );

  // What the service provider receives: always the account's identity, plus
  // the email address when it's the NameID even without the email scope.
  const shared = [
    "openid",
    ...data.scopes,
    ...(data.name_id_format === "email" && !data.scopes.includes("email")
      ? ["email"]
      : []),
  ];

  return (
    <AuthShell maxWidth={440} cardGap={24}>
      <Title2>{t("saml.title", { appName: data.app.name })}</Title2>
      {data.user && <OAuthConsentHeader app={data.app} user={data.user} />}
      <div className={styles.divider} />
      <div>
        <Text weight="semibold" block style={{ marginBottom: 12 }}>
          {t("saml.sharing", { appName: data.app.name })}
        </Text>
        <div className={styles.scopeList}>
          {shared.map((scope) => (
            <div key={scope} className={styles.scopeItem}>
              <CheckmarkRegular
                style={{ color: tokens.colorBrandForeground1, flexShrink: 0 }}
              />
              <Text size={300}>{scopeLabel(t, scope).label}</Text>
            </div>
          ))}
        </div>
      </div>
      <AppScopeList appName={data.app.name} scopes={data.app_scopes} />
      {profilePicker}
      {data.profile?.kind === "shared" && (
        <Text size={200} className={styles.muted}>
          {t("saml.profileCurrent", {
            appName: data.app.name,
            name: data.profile.name,
          })}
        </Text>
      )}
      <div className={styles.divider} />
      <div className={styles.actions}>
        <Button
          appearance="primary"
          icon={<CheckmarkRegular />}
          onClick={() => void decide("approve", "once")}
        >
          {t("oauth.authorize", { appName: data.app.name })}
        </Button>
        {!data.app.is_first_party && (
          <Button
            appearance="secondary"
            onClick={() => void decide("approve", "always")}
          >
            {t("oauth.alwaysAuthorize", { appName: data.app.name })}
          </Button>
        )}
        <Button
          appearance="outline"
          icon={<DismissRegular />}
          onClick={() => void decide("deny")}
        >
          {t("oauth.deny")}
        </Button>
      </div>
      <Text size={100} className={styles.footer}>
        {t("oauth.footerNote", { appName: data.app.name, siteName })}
      </Text>
    </AuthShell>
  );
}
