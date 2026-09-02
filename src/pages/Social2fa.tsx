// Social login — TOTP step-up for untrusted providers.
//
// A social provider marked trusted=0 (see admin OAuth Sources) short-circuits
// the callback and bounces the browser here with a pending key. We look up
// which account is being logged into for context, then submit the TOTP code
// via POST /connections/2fa/verify to receive the session token.

import {
  Avatar,
  Button,
  Field,
  Input,
  MessageBar,
  Spinner,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../lib/api";
import { useApi } from "../lib/api-context";
import { AuthShell } from "../components/AuthShell";
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
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    width: "100%",
  },
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    width: "100%",
  },
});

export function Social2fa() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setAuth } = useAuthStore();
  const { t } = useTranslation();
  const key = searchParams.get("key") ?? "";

  const [totpCode, setTotpCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const {
    data,
    isLoading,
    error: fetchError,
  } = useQuery({
    queryKey: ["social-2fa-pending", key],
    queryFn: () => api.connectionSocial2faPending(key),
    enabled: !!key,
    retry: false,
  });

  useEffect(() => {
    if (!key) navigate("/login", { replace: true });
  }, [key, navigate]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await api.connectionSocial2faVerify({
        key,
        totp_code: totpCode.trim(),
      });
      setAuth(res.token, res.user);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("auth.loginFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading || !data) {
    return (
      <div className={styles.page}>
        <Spinner size="large" />
      </div>
    );
  }

  if (fetchError) {
    return (
      <AuthShell maxWidth={420} cardGap={24}>
        <Title2>{t("auth.sessionExpired")}</Title2>
        <Text style={{ color: tokens.colorNeutralForeground3 }}>
          {t("auth.sessionExpiredText")}
        </Text>
        <Button appearance="primary" onClick={() => navigate("/login")}>
          {t("auth.backToLogin")}
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell maxWidth={420} cardGap={24}>
      <>
        <Avatar
          image={
            data.user.avatar_url ? { src: data.user.avatar_url } : undefined
          }
          name={data.user.display_name}
          size={64}
          style={{ alignSelf: "center" }}
        />

        <div style={{ textAlign: "center" }}>
          <Title2>{t("auth.social2faTitle")}</Title2>
          <Text
            block
            style={{ color: tokens.colorNeutralForeground3, marginTop: 8 }}
          >
            {t("auth.social2faSubtitle", {
              providerName: data.provider_name,
              displayName: data.user.display_name,
            })}
          </Text>
        </div>

        {error && (
          <MessageBar intent="error" style={{ width: "100%" }}>
            {error}
          </MessageBar>
        )}

        <form onSubmit={handleVerify} className={styles.form}>
          <Field label={t("auth.twoFactorCode")}>
            <Input
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              placeholder={t("auth.twoFactorPlaceholder")}
              maxLength={11}
              autoComplete="one-time-code"
              autoFocus
            />
          </Field>

          <div className={styles.actions}>
            <Button
              appearance="primary"
              type="submit"
              disabled={submitting || !totpCode.trim()}
              icon={submitting ? <Spinner size="tiny" /> : undefined}
            >
              {submitting ? t("auth.signingIn") : t("common.verify")}
            </Button>
            <Button appearance="subtle" onClick={() => navigate("/login")}>
              {t("auth.backToLogin")}
            </Button>
          </div>
        </form>
      </>
    </AuthShell>
  );
}
