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
  Spinner,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  CheckmarkRegular,
  DismissCircleRegular,
  DismissRegular,
} from "@fluentui/react-icons";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, type SamlPostback } from "../../lib/api";
import { apiErrorText } from "../../lib/apiError";
import { useApi } from "../../lib/api-context";
import { scopeLabel } from "../../lib/scopeLabels";
import { useSiteName } from "../../lib/useSiteName";
import { AuthShell } from "../../components/AuthShell";
import { OAuthConsentHeader } from "../../components/OAuthConsentHeader";
import { ProfileChoice } from "./ProfileChoice";

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

/** POST the Response to the service provider (HTTP-POST binding). */
function submitPostback(p: SamlPostback) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = p.acs_url;
  form.style.display = "none";
  const fields: Record<string, string | null> = {
    SAMLResponse: p.saml_response,
    RelayState: p.relay_state,
  };
  for (const [name, value] of Object.entries(fields)) {
    if (value === null) continue;
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

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

  const { data, error, isLoading } = useQuery({
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
      submitPostback(
        await api.samlDecision(
          token,
          action,
          mode,
          action === "approve" ? profileChoice : undefined,
        ),
      );
    } catch (err) {
      setPosting(false);
      if (err instanceof ApiError && err.code === "unauthorized") {
        navigate(
          `/login?redirect=${encodeURIComponent(
            window.location.pathname + window.location.search,
          )}`,
          { replace: true },
        );
        return;
      }
      setFailure(apiErrorText(err, t("saml.errorBody")));
    }
  };

  // Steps that need no input from the user.
  useEffect(() => {
    if (!data || started.current) return;
    const back = encodeURIComponent(
      window.location.pathname + window.location.search,
    );
    if (data.next === "login") {
      started.current = true;
      navigate(`/login?redirect=${back}`, { replace: true });
    } else if (data.next === "reauth") {
      started.current = true;
      navigate(`/login?redirect=${back}&reauth=1`, { replace: true });
    } else if (data.next === "continue" || data.next === "decline") {
      started.current = true;
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
    return (
      <AuthShell maxWidth={440} cardGap={24}>
        <div className={styles.center}>
          <DismissCircleRegular
            fontSize={48}
            style={{ color: tokens.colorPaletteRedForeground1 }}
          />
          <Title2>{t("saml.errorTitle")}</Title2>
          <Text>{errorText}</Text>
        </div>
      </AuthShell>
    );

  if (
    isLoading ||
    !data ||
    posting ||
    (data.next !== "consent" && data.next !== "profile")
  )
    return (
      <div className={styles.page}>
        <div className={styles.center}>
          <Spinner size="large" />
          {data && (
            <Text className={styles.muted}>
              {t("saml.signingIn", { appName: data.app.name })}
            </Text>
          )}
        </div>
      </div>
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
        <>
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
        </>
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
      <>
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
      </>
    </AuthShell>
  );
}
