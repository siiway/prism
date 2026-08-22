// Step-up 2FA confirmation screen — apps redirect users here to confirm a
// sensitive action with TOTP or passkey before continuing.

import {
  Button,
  Checkbox,
  Input,
  Spinner,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  CheckmarkRegular,
  DismissRegular,
  KeyRegular,
  LockClosedRegular,
} from "@fluentui/react-icons";
import { startAuthentication } from "@simplewebauthn/browser";
import { useState, useCallback, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../lib/api";
import { AuthShell } from "../../components/AuthShell";
import { useAuthStore } from "../../store/auth";
import { Captcha, type CaptchaValue } from "../../components/Captcha";
import { OAuthConsentHeader } from "../../components/OAuthConsentHeader";

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
  divider: {
    borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
    // Full-bleed across the AuthShell card regardless of its padding
    margin: "0 calc(-1 * var(--auth-card-pad, 40px))",
  },
  actionBox: {
    padding: "16px",
    borderRadius: "8px",
    border: `1.5px solid ${tokens.colorBrandStroke1}`,
    background: tokens.colorNeutralBackground3,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  twoFaBox: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    padding: "16px",
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground3,
  },
  sudoActiveBox: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "12px 16px",
    borderRadius: "8px",
    border: `1px solid ${tokens.colorPaletteGreenBorder1}`,
    background: tokens.colorPaletteGreenBackground1,
  },
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
});

export function Verify2FA() {
  const styles = useStyles();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, token } = useAuthStore();
  const { t } = useTranslation();

  const challengeId = searchParams.get("challenge_id") ?? "";
  const stateParam = searchParams.get("state") ?? "";

  const { data, isLoading, error } = useQuery({
    queryKey: ["oauth-2fa", challengeId],
    queryFn: () =>
      api.oauth2faInfo({
        challenge_id: challengeId,
        ...(stateParam ? { state: stateParam } : {}),
      }),
    retry: false,
    enabled: !!challengeId,
  });

  const [loading, setLoading] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [twoFaMode, setTwoFaMode] = useState<"totp" | "passkey">("totp");
  const [passkeyVerifyToken, setPasskeyVerifyToken] = useState("");
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Mandatory acknowledgement of the action text — defends a session-hijacked
  // user against being phished into clicking Confirm without reading. The
  // checkbox label includes the verbatim action so reading the label IS
  // reading the action.
  const [acknowledged, setAcknowledged] = useState(false);
  // Opt-in: open a sudo grace window after this confirmation succeeds.
  const [enableSudo, setEnableSudo] = useState(false);
  // Captcha solution. We persist by reference because the Captcha component
  // calls `onVerified` exactly once per solve.
  const [captchaValue, setCaptchaValue] = useState<CaptchaValue | null>(null);
  const handleCaptchaVerified = useCallback((v: CaptchaValue) => {
    setCaptchaValue(v);
  }, []);

  const sudoEnabledOnSite = (data?.sudo_ttl_minutes ?? 0) > 0;
  const sudoActive = !!data?.sudo_active && sudoEnabledOnSite;
  const captchaRequired = !!data?.captcha_required;
  const captchaSatisfied =
    !captchaRequired ||
    !!captchaValue?.captcha_token ||
    (!!captchaValue?.pow_challenge && captchaValue?.pow_nonce !== undefined);

  // When sudo is already active for this user/app/session, the user only has
  // to acknowledge the action — no TOTP or passkey is required.
  const twoFaDone =
    sudoActive ||
    (twoFaMode === "passkey"
      ? passkeyVerifyToken.length > 0
      : totpCode.trim().length > 0);

  const handleDecision = async (decision: "approve" | "deny") => {
    if (!data) return;
    setErrorMsg(null);
    setLoading(true);
    try {
      const captchaPayload =
        captchaRequired && decision === "approve" && captchaValue
          ? {
              ...(captchaValue.captcha_token
                ? { captcha_token: captchaValue.captcha_token }
                : {}),
              ...(captchaValue.pow_challenge
                ? { pow_challenge: captchaValue.pow_challenge }
                : {}),
              ...(captchaValue.pow_nonce !== undefined
                ? { pow_nonce: captchaValue.pow_nonce }
                : {}),
            }
          : {};

      const res = await api.oauth2faAuthorize({
        challenge_id: challengeId,
        ...(stateParam ? { state: stateParam } : {}),
        decision,
        ...(decision === "approve"
          ? sudoActive
            ? { use_sudo: true, ...captchaPayload }
            : {
                ...(twoFaMode === "passkey"
                  ? { passkey_verify_token: passkeyVerifyToken }
                  : { totp_code: totpCode.trim() }),
                ...(enableSudo ? { enable_sudo: true } : {}),
                ...captchaPayload,
              }
          : {}),
      });
      window.location.href = res.redirect;
    } catch (err) {
      if (err instanceof ApiError) {
        const errorCode = err.message;
        const humanMsg =
          typeof err.data === "object" &&
          err.data !== null &&
          "message" in (err.data as object)
            ? String((err.data as Record<string, unknown>).message)
            : err.message;
        if (errorCode === "invalid_2fa" || errorCode === "captcha_failed") {
          setErrorMsg(humanMsg);
          // Captcha tokens are single-use server-side; force a re-solve.
          if (errorCode === "captcha_failed") setCaptchaValue(null);
          setLoading(false);
          return;
        }
        // Other errors (invalid_challenge, challenge_consumed, etc.) are
        // unrecoverable from the user's POV — bounce back to the app's
        // redirect_uri so it can decide what to do. We have to use the
        // redirect_uri the server gave us (data.redirect_uri), not anything
        // from the URL — the URL never carried it.
        if (data?.redirect_uri) {
          const url = new URL(data.redirect_uri);
          url.searchParams.set("error", "server_error");
          url.searchParams.set("error_description", humanMsg);
          if (stateParam) url.searchParams.set("state", stateParam);
          window.location.href = url.toString();
        } else {
          // No redirect_uri yet (e.g. invalid_challenge before /info loaded).
          // Show the error in-place rather than navigating to an unknown URL.
          setErrorMsg(humanMsg);
          setLoading(false);
        }
      } else if (data?.redirect_uri) {
        const url = new URL(data.redirect_uri);
        url.searchParams.set("error", "server_error");
        if (stateParam) url.searchParams.set("state", stateParam);
        window.location.href = url.toString();
      } else {
        setLoading(false);
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeyVerify = async () => {
    setErrorMsg(null);
    setPasskeyLoading(true);
    try {
      const beginData = await api.passkeyVerifyBegin();
      const authResponse = await startAuthentication({
        optionsJSON: beginData as Parameters<
          typeof startAuthentication
        >[0]["optionsJSON"],
      });
      const result = await api.passkeyVerifyFinish(
        (beginData as { challenge: string }).challenge,
        authResponse,
      );
      setPasskeyVerifyToken(result.verify_token);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? typeof err.data === "object" &&
            err.data !== null &&
            "message" in (err.data as object)
            ? String((err.data as Record<string, unknown>).message)
            : err.message
          : t("oauth.siteScopePasskeyFailed");
      setErrorMsg(msg);
    } finally {
      setPasskeyLoading(false);
    }
  };

  // If not logged in, redirect to login (client-side safety net; the route
  // loader handles the SSR redirect).
  useEffect(() => {
    if (!user || !token) {
      const loginUrl = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      navigate(loginUrl, { replace: true });
    }
  }, [user, token, navigate]);

  // While waiting for the auth-redirect effect to fire, show a spinner.
  if (!user || !token) {
    return (
      <div className={styles.page}>
        <Spinner size="large" />
      </div>
    );
  }

  if (!challengeId) {
    return (
      <AuthShell maxWidth={440} cardGap={24}>
        <Title2>{t("oauth.authorizationError")}</Title2>
        <Text style={{ color: tokens.colorPaletteRedForeground1 }}>
          {t("oauth.invalidRequest")}
        </Text>
      </AuthShell>
    );
  }

  if (isLoading) {
    return (
      <div className={styles.page}>
        <Spinner size="large" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <AuthShell maxWidth={440} cardGap={24}>
        <Title2>{t("oauth.authorizationError")}</Title2>
        <Text style={{ color: tokens.colorPaletteRedForeground1 }}>
          {error instanceof ApiError
            ? error.message
            : t("oauth.invalidRequest")}
        </Text>
      </AuthShell>
    );
  }

  return (
    <AuthShell maxWidth={440} cardGap={24}>
      <>
        <Title2>{t("oauth.twoFa.title")}</Title2>

        <OAuthConsentHeader app={data.app} user={user} />

        <div className={styles.divider} />

        <div className={styles.actionBox}>
          <Text weight="semibold" size={400}>
            {t("oauth.twoFa.confirmHeading", { appName: data.app.name })}
          </Text>
          {data.action ? (
            <Text
              size={300}
              style={{ wordBreak: "break-word", whiteSpace: "pre-wrap" }}
            >
              {data.action}
            </Text>
          ) : (
            <Text size={300} style={{ color: tokens.colorNeutralForeground2 }}>
              {t("oauth.twoFa.noAction")}
            </Text>
          )}
          <Checkbox
            checked={acknowledged}
            onChange={(_, d) => setAcknowledged(!!d.checked)}
            label={
              <Text size={200}>
                {data.action
                  ? t("oauth.twoFa.acknowledge", { action: data.action })
                  : t("oauth.twoFa.acknowledgeNoAction")}
              </Text>
            }
          />
        </div>

        {sudoActive ? (
          <div className={styles.sudoActiveBox}>
            <Text
              size={200}
              weight="semibold"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                color: tokens.colorPaletteGreenForeground1,
              }}
            >
              <CheckmarkRegular fontSize={14} />
              {t("oauth.twoFa.sudoActiveTitle")}
            </Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
              {t("oauth.twoFa.sudoActiveDesc", {
                appName: data.app.name,
                minutes: data.sudo_ttl_minutes,
              })}
            </Text>
            {errorMsg && (
              <Text
                size={200}
                style={{ color: tokens.colorPaletteRedForeground1 }}
              >
                {errorMsg}
              </Text>
            )}
          </div>
        ) : !data.has_any_2fa ? (
          <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>
            {t("oauth.twoFa.noEnrollment")}
          </Text>
        ) : (
          <div className={styles.twoFaBox}>
            {twoFaMode === "totp" ? (
              <>
                <Text
                  size={200}
                  weight="semibold"
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <LockClosedRegular fontSize={14} />
                  {t("oauth.twoFa.enterCode")}
                </Text>
                <Text
                  size={100}
                  style={{ color: tokens.colorNeutralForeground3 }}
                >
                  {t("oauth.twoFa.enterCodeHint")}
                </Text>
                <Input
                  value={totpCode}
                  onChange={(_, d) => {
                    setTotpCode(d.value);
                    setErrorMsg(null);
                  }}
                  placeholder="000000"
                  maxLength={16}
                  autoComplete="one-time-code"
                  style={{ fontFamily: "monospace", letterSpacing: 4 }}
                />
                {data.passkey_enrolled && (
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={<KeyRegular />}
                    style={{ alignSelf: "flex-start" }}
                    onClick={() => {
                      setTwoFaMode("passkey");
                      setTotpCode("");
                      setErrorMsg(null);
                    }}
                  >
                    {t("oauth.siteScopeUsePasskey")}
                  </Button>
                )}
              </>
            ) : (
              <>
                <Text
                  size={200}
                  weight="semibold"
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <KeyRegular fontSize={14} />
                  {t("oauth.siteScopePasskeyVerify")}
                </Text>
                {passkeyVerifyToken ? (
                  <Text
                    size={200}
                    style={{
                      color: tokens.colorPaletteGreenForeground1,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <CheckmarkRegular />
                    {t("oauth.siteScopePasskeyVerified")}
                  </Text>
                ) : (
                  <Button
                    appearance="primary"
                    icon={
                      passkeyLoading ? <Spinner size="tiny" /> : <KeyRegular />
                    }
                    disabled={passkeyLoading}
                    onClick={handlePasskeyVerify}
                  >
                    {t("oauth.siteScopePasskeyVerify")}
                  </Button>
                )}
                {data.totp_enrolled && (
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={<LockClosedRegular />}
                    style={{ alignSelf: "flex-start" }}
                    onClick={() => {
                      setTwoFaMode("totp");
                      setPasskeyVerifyToken("");
                      setErrorMsg(null);
                    }}
                  >
                    {t("oauth.siteScopeUseTotp")}
                  </Button>
                )}
              </>
            )}
            {errorMsg && (
              <Text
                size={200}
                style={{ color: tokens.colorPaletteRedForeground1 }}
              >
                {errorMsg}
              </Text>
            )}
            {sudoEnabledOnSite && (
              <Checkbox
                checked={enableSudo}
                onChange={(_, d) => setEnableSudo(!!d.checked)}
                label={
                  <Text size={200}>
                    {t("oauth.twoFa.enableSudo", {
                      minutes: data.sudo_ttl_minutes,
                      appName: data.app.name,
                    })}
                  </Text>
                }
              />
            )}
          </div>
        )}

        {captchaRequired && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {t("oauth.twoFa.captchaHint")}
            </Text>
            <Captcha
              provider={data.captcha_provider}
              siteKey={data.captcha_site_key}
              turnstileEndpoint={data.turnstile_endpoint}
              onVerified={handleCaptchaVerified}
            />
          </div>
        )}

        <div className={styles.divider} />

        <div className={styles.actions}>
          <Button
            appearance="primary"
            icon={loading ? <Spinner size="tiny" /> : <CheckmarkRegular />}
            disabled={
              loading ||
              (!sudoActive && !data.has_any_2fa) ||
              !twoFaDone ||
              !acknowledged ||
              !captchaSatisfied
            }
            onClick={() => handleDecision("approve")}
          >
            {sudoActive
              ? t("oauth.twoFa.confirmSudo")
              : t("oauth.twoFa.confirm")}
          </Button>
          <Button
            appearance="outline"
            icon={<DismissRegular />}
            disabled={loading}
            onClick={() => handleDecision("deny")}
          >
            {t("oauth.deny")}
          </Button>
        </div>

        <Text
          size={100}
          style={{ color: tokens.colorNeutralForeground4, textAlign: "center" }}
        >
          {t("oauth.twoFa.footerNote", { appName: data.app.name })}
        </Text>
      </>
    </AuthShell>
  );
}
