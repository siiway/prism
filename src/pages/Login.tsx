// Login page with TOTP, passkey, and social provider support

import {
  Button,
  Divider,
  Field,
  Input,
  Link,
  MessageBar,
  MessageBarBody,
  Radio,
  RadioGroup,
  Spinner,
  Text,
  Textarea,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowUploadRegular,
  CodeRegular,
  CopyRegular,
  KeyMultipleRegular,
  LockClosedRegular,
} from "@fluentui/react-icons";
import * as openpgp from "openpgp";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { startAuthentication } from "@simplewebauthn/browser";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../lib/api";
import { Captcha } from "../components/Captcha";
import type { CaptchaValue } from "../components/Captcha";
import { useAuthStore } from "../store/auth";
import type { UserProfile } from "../lib/api";

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
    maxWidth: "400px",
    padding: "40px",
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground2,
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  form: { display: "flex", flexDirection: "column", gap: "12px" },
  providers: { display: "flex", flexDirection: "column", gap: "8px" },
  footer: { textAlign: "center" },
});

export function Login() {
  const styles = useStyles();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setAuth, token } = useAuthStore();
  const { t } = useTranslation();
  const { data: site } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpRequired, setTotpRequired] = useState(false);
  const [captcha, setCaptcha] = useState<CaptchaValue>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  // GPG login state
  const [gpgStep, setGpgStep] = useState<"idle" | "challenge" | "verify">(
    "idle",
  );
  const [gpgLoading, setGpgLoading] = useState(false);
  const [gpgChallengeText, setGpgChallengeText] = useState("");
  const [gpgSignedMessage, setGpgSignedMessage] = useState("");

  // GPG in-browser signing state
  const [gpgSignMode, setGpgSignMode] = useState<"clearsign" | "sign">(
    "clearsign",
  );
  const [gpgShowAutoSign, setGpgShowAutoSign] = useState(false);
  const [gpgPrivateKey, setGpgPrivateKey] = useState("");
  const [gpgPassphrase, setGpgPassphrase] = useState("");
  const [gpgAutoSigning, setGpgAutoSigning] = useState(false);
  const gpgFileRef = useRef<HTMLInputElement>(null);
  const redirectTo = searchParams.get("redirect") ?? "/";
  const errorParam = searchParams.get("error");
  const errorParamMessage = errorParam
    ? t(
        errorParam === "invalid_token"
          ? "auth.errorInvalidToken"
          : errorParam === "no_token"
            ? "auth.errorNoToken"
            : "auth.errorGeneric",
      )
    : null;

  // Redirect whenever a token appears (on mount if already logged in, or after login)
  useEffect(() => {
    if (token) navigate(redirectTo, { replace: true });
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.login({
        identifier,
        password,
        totp_code: totpRequired ? totpCode : undefined,
        ...captcha,
      });

      if (res.totp_required) {
        setTotpRequired(true);
        setLoading(false);
        return;
      }

      if (res.token && res.user) {
        setAuth(res.token, res.user as UserProfile);
        // navigation handled by the token useEffect
        console.debug("Login successful, token set, navigating to", redirectTo);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("auth.loginFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setError("");
    setPasskeyLoading(true);
    try {
      const options = await api.passkeyAuthBegin(identifier || undefined);
      const response = await startAuthentication({
        optionsJSON: options as Parameters<
          typeof startAuthentication
        >[0]["optionsJSON"],
      });
      const res = await api.passkeyAuthFinish(
        (options as { challenge: string }).challenge,
        response,
      );
      setAuth(res.token, res.user);
      // navigation handled by the token useEffect
      console.debug("Login successful, token set, navigating to", redirectTo);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("auth.passkeyFailed"));
    } finally {
      setPasskeyLoading(false);
    }
  };

  const handleSocialLogin = async (provider: string) => {
    const { redirect } = await api.connectionBegin(provider, { mode: "login" });
    window.location.href = redirect;
  };

  const handleGpgBegin = async () => {
    if (!identifier.trim()) {
      setError(t("auth.emailOrUsernameRequired"));
      return;
    }
    setError("");
    setGpgLoading(true);
    try {
      const res = await api.gpgChallenge(identifier);
      setGpgChallengeText(res.text);
      setGpgSignedMessage("");
      setGpgStep("challenge");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("auth.gpgFailed"));
    } finally {
      setGpgLoading(false);
    }
  };

  const handleGpgVerify = async () => {
    setError("");
    setGpgLoading(true);
    try {
      const res = await api.gpgLogin(identifier, gpgSignedMessage);
      setAuth(res.token, res.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("auth.gpgFailed"));
    } finally {
      setGpgLoading(false);
    }
  };

  const getGpgCommand = () =>
    gpgSignMode === "clearsign"
      ? `gpg --clearsign <<'EOF'\n${gpgChallengeText}\nEOF`
      : `gpg --sign --armor <<'EOF'\n${gpgChallengeText}\nEOF`;

  const handleGpgAutoSign = async () => {
    setError("");
    setGpgAutoSigning(true);
    try {
      let privateKeyObj = await openpgp.readPrivateKey({
        armoredKey: gpgPrivateKey,
      });
      if (!privateKeyObj.isDecrypted()) {
        privateKeyObj = await openpgp.decryptKey({
          privateKey: privateKeyObj,
          passphrase: gpgPassphrase,
        });
      }
      const signed =
        gpgSignMode === "clearsign"
          ? await openpgp.sign({
              message: await openpgp.createCleartextMessage({
                text: gpgChallengeText,
              }),
              signingKeys: privateKeyObj,
            })
          : await openpgp.sign({
              message: await openpgp.createMessage({ text: gpgChallengeText }),
              signingKeys: privateKeyObj,
            });
      setGpgSignedMessage(signed);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("security.gpgSignFailed"),
      );
    } finally {
      setGpgAutoSigning(false);
    }
  };

  const handleGpgFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) =>
      setGpgPrivateKey((ev.target?.result as string) ?? "");
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <Title2>
          {t("auth.signInTo", { siteName: site?.site_name ?? "Prism" })}
        </Title2>

        {errorParamMessage && (
          <MessageBar intent="error">
            <MessageBarBody>{errorParamMessage}</MessageBarBody>
          </MessageBar>
        )}

        <form onSubmit={handleLogin} className={styles.form}>
          {!totpRequired ? (
            <>
              <Field label={t("auth.emailOrUsername")}>
                <Input
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="username"
                />
              </Field>
              <Field label={t("auth.password")}>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </Field>
            </>
          ) : (
            <Field label={t("auth.twoFactorCode")}>
              <Input
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                placeholder={t("auth.twoFactorPlaceholder")}
                maxLength={11}
                autoFocus
              />
            </Field>
          )}

          {site && site.captcha_provider !== "none" && !totpRequired && (
            <Captcha
              provider={site.captcha_provider}
              siteKey={site.captcha_site_key}
              onVerified={setCaptcha}
              onError={setError}
            />
          )}

          {error && (
            <Text style={{ color: tokens.colorPaletteRedForeground1 }}>
              {error}
            </Text>
          )}

          <Button
            appearance="primary"
            type="submit"
            disabled={loading}
            icon={loading ? <Spinner size="tiny" /> : undefined}
          >
            {loading
              ? t("auth.signingIn")
              : totpRequired
                ? t("common.verify")
                : t("auth.signIn")}
          </Button>

          {totpRequired && (
            <Button appearance="subtle" onClick={() => setTotpRequired(false)}>
              {t("common.back")}
            </Button>
          )}
        </form>

        {!totpRequired && gpgStep === "idle" && (
          <>
            <Button
              appearance="outline"
              icon={<KeyMultipleRegular />}
              onClick={handlePasskeyLogin}
              disabled={passkeyLoading}
            >
              {passkeyLoading
                ? t("auth.authenticating")
                : t("auth.signInWithPasskey")}
            </Button>

            <Button
              appearance="outline"
              icon={<LockClosedRegular />}
              onClick={handleGpgBegin}
              disabled={gpgLoading}
            >
              {gpgLoading ? (
                <Spinner size="tiny" />
              ) : (
                t("security.signInWithGpg")
              )}
            </Button>

            {(site?.enabled_providers?.length ?? 0) > 0 && (
              <>
                <Divider>{t("auth.orContinueWith")}</Divider>
                <div className={styles.providers}>
                  {site!.enabled_providers.map((p) => (
                    <Button
                      key={p.slug}
                      appearance="outline"
                      onClick={() => handleSocialLogin(p.slug)}
                    >
                      {p.name}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {!totpRequired && gpgStep === "challenge" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Text weight="semibold">{t("security.gpgLoginTitle")}</Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {t("security.gpgChallengePrompt")}
            </Text>
            <RadioGroup
              value={gpgSignMode}
              onChange={(_, d) =>
                setGpgSignMode(d.value as "clearsign" | "sign")
              }
              layout="horizontal"
            >
              <Radio value="clearsign" label={t("security.gpgModeClearsign")} />
              <Radio value="sign" label={t("security.gpgModeSign")} />
            </RadioGroup>

            {/* Challenge text with copy buttons */}
            <div style={{ position: "relative" }}>
              <pre
                style={{
                  margin: 0,
                  padding: "8px 76px 8px 8px",
                  background: tokens.colorNeutralBackground3,
                  borderRadius: 4,
                  fontSize: 12,
                  fontFamily: "monospace",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {gpgChallengeText}
              </pre>
              <div
                style={{
                  position: "absolute",
                  top: 4,
                  right: 4,
                  display: "flex",
                  gap: 2,
                }}
              >
                <Button
                  appearance="transparent"
                  icon={<CopyRegular />}
                  size="small"
                  onClick={() =>
                    navigator.clipboard.writeText(gpgChallengeText)
                  }
                  title={t("security.gpgCopied")}
                />
                <Button
                  appearance="transparent"
                  icon={<CodeRegular />}
                  size="small"
                  onClick={() => navigator.clipboard.writeText(getGpgCommand())}
                  title={t("security.gpgCopyCommand")}
                />
              </div>
            </div>

            {/* In-browser signing — collapsed behind a toggle */}
            <input
              ref={gpgFileRef}
              type="file"
              accept=".asc,.gpg,.pgp,application/pgp-keys"
              style={{ display: "none" }}
              onChange={handleGpgFileUpload}
            />
            <Button
              appearance="subtle"
              size="small"
              onClick={() => setGpgShowAutoSign((v) => !v)}
              style={{ alignSelf: "flex-start" }}
            >
              {gpgShowAutoSign
                ? t("security.gpgAutoSignHide")
                : t("security.gpgAutoSignTitle")}
            </Button>

            {gpgShowAutoSign && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  padding: "12px 14px",
                  background: tokens.colorNeutralBackground3,
                  borderRadius: 6,
                }}
              >
                <Field label={t("security.gpgPrivateKey")}>
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      alignItems: "flex-start",
                    }}
                  >
                    <Textarea
                      value={gpgPrivateKey}
                      onChange={(e) => setGpgPrivateKey(e.target.value)}
                      placeholder={t("security.gpgPrivateKeyPlaceholder")}
                      rows={3}
                      style={{ fontFamily: "monospace", fontSize: 11, flex: 1 }}
                    />
                    <Button
                      appearance="subtle"
                      icon={<ArrowUploadRegular />}
                      size="small"
                      style={{ marginTop: 2, flexShrink: 0 }}
                      onClick={() => gpgFileRef.current?.click()}
                      title={t("security.gpgUploadKey")}
                    />
                  </div>
                </Field>
                <Field label={t("security.gpgPassphrase")}>
                  <Input
                    type="password"
                    value={gpgPassphrase}
                    onChange={(e) => setGpgPassphrase(e.target.value)}
                    placeholder={t("security.gpgPassphrasePlaceholder")}
                  />
                </Field>
                <Button
                  appearance="secondary"
                  icon={
                    gpgAutoSigning ? (
                      <Spinner size="tiny" />
                    ) : (
                      <KeyMultipleRegular />
                    )
                  }
                  disabled={gpgAutoSigning || !gpgPrivateKey.trim()}
                  onClick={handleGpgAutoSign}
                >
                  {gpgAutoSigning
                    ? t("security.gpgAutoSigning")
                    : t("security.gpgAutoSign")}
                </Button>
                <Text
                  size={100}
                  style={{ color: tokens.colorNeutralForeground3 }}
                >
                  {t("security.gpgPrivacyNote")}
                </Text>
              </div>
            )}

            <Divider />

            <Field label={t("security.gpgSignedMessage")}>
              <Textarea
                value={gpgSignedMessage}
                onChange={(e) => setGpgSignedMessage(e.target.value)}
                placeholder={t("security.gpgSignedMessagePlaceholder")}
                rows={6}
                style={{ fontFamily: "monospace", fontSize: 12 }}
              />
            </Field>
            <div style={{ display: "flex", gap: 8 }}>
              <Button
                appearance="primary"
                icon={gpgLoading ? <Spinner size="tiny" /> : undefined}
                disabled={gpgLoading || !gpgSignedMessage.trim()}
                onClick={handleGpgVerify}
                style={{ flex: 1 }}
              >
                {t("security.gpgVerify")}
              </Button>
              <Button
                appearance="subtle"
                onClick={() => {
                  setGpgStep("idle");
                  setError("");
                  setGpgPrivateKey("");
                  setGpgPassphrase("");
                }}
              >
                {t("common.back")}
              </Button>
            </div>
          </div>
        )}

        {site?.allow_registration && !totpRequired && (
          <div className={styles.footer}>
            <Text>{t("auth.dontHaveAccount")} </Text>
            <Link href="/register">{t("auth.signUp")}</Link>
          </div>
        )}
      </div>
    </div>
  );
}
