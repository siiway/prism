// Registration page

import {
  Button,
  Divider,
  Field,
  Input,
  Link,
  MessageBar,
  Spinner,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../lib/api";
import { AuthShell } from "../components/AuthShell";
import { Captcha } from "../components/Captcha";
import { PasswordInput } from "../components/PasswordInput";
import type { CaptchaValue } from "../components/Captcha";
import { ProviderButton } from "../components/ProviderButton";
import { useAuthStore } from "../store/auth";
import type { UserProfile } from "../lib/api";

const useStyles = makeStyles({
  form: { display: "flex", flexDirection: "column", gap: "12px" },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
    "@media (max-width: 480px)": {
      gridTemplateColumns: "1fr",
    },
  },
  footer: { textAlign: "center" },
});

export function Register() {
  const styles = useStyles();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setAuth } = useAuthStore();
  const { t } = useTranslation();
  const { data: site } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });

  const [form, setForm] = useState({
    email: "",
    username: "",
    password: "",
    display_name: "",
    invite_token: searchParams.get("invite") ?? "",
  });
  const [captcha, setCaptcha] = useState<CaptchaValue>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const update = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const res = await api.register({
        ...form,
        email: form.email.trim(),
        username: form.username.trim(),
        display_name: form.display_name.trim(),
        invite_token: form.invite_token.trim(),
        ...captcha,
      });
      if ("token" in res && res.token) {
        setAuth(res.token as string, res.user as UserProfile);
        if (site?.require_email_verification) {
          navigate("/verify-choose");
        } else {
          navigate("/");
        }
      } else {
        setSuccess(t("auth.registrationSuccessEmail"));
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : t("auth.registrationFailed"),
      );
    } finally {
      setLoading(false);
    }
  };

  if (!site?.allow_registration) {
    return (
      <AuthShell maxWidth={420}>
        <Title2>{t("auth.registrationDisabled")}</Title2>
        <Text>{t("auth.registrationDisabledText")}</Text>
        <Link href="/login">{t("auth.backToSignIn")}</Link>
      </AuthShell>
    );
  }

  const showInviteField = site?.invite_only || !!form.invite_token;

  return (
    <AuthShell maxWidth={420}>
      <>
        <Title2>{t("auth.createAccount")}</Title2>
        <Text style={{ color: tokens.colorNeutralForeground3 }}>
          {t("auth.join", { siteName: site?.site_name ?? "Prism" })}
        </Text>

        {site?.invite_only && (
          <MessageBar intent="info">{t("auth.inviteOnly")}</MessageBar>
        )}

        {success ? (
          <MessageBar intent="success">{success}</MessageBar>
        ) : (
          <form onSubmit={handleSubmit} className={styles.form}>
            <Field label="Email" required>
              <Input
                type="email"
                value={form.email}
                onChange={update("email")}
                placeholder="you@example.com"
              />
            </Field>

            <Field label="Username" required>
              <Input
                value={form.username}
                onChange={update("username")}
                placeholder="johndoe"
              />
            </Field>
            <Field label="Display name">
              <Input
                value={form.display_name}
                onChange={update("display_name")}
                placeholder="John Doe"
              />
            </Field>

            <Field label="Password" required>
              <PasswordInput
                value={form.password}
                onChange={update("password")}
                placeholder={t("init.passwordPlaceholder")}
                autoComplete="new-password"
              />
            </Field>

            {showInviteField && (
              <Field
                label={t("auth.inviteToken")}
                required={!!site?.invite_only}
                hint={t("auth.inviteTokenHint")}
              >
                <Input
                  value={form.invite_token}
                  onChange={update("invite_token")}
                  placeholder={t("auth.inviteTokenPlaceholder")}
                />
              </Field>
            )}

            {site.captcha_provider !== "none" && (
              <Captcha
                provider={site.captcha_provider}
                siteKey={site.captcha_site_key}
                turnstileEndpoint={site.turnstile_endpoint}
                turnstileChinaSiteKey={site.turnstile_china_site_key}
                onVerified={setCaptcha}
                onError={setError}
              />
            )}

            {error && <MessageBar intent="error">{error}</MessageBar>}

            <Button
              appearance="primary"
              type="submit"
              disabled={loading}
              icon={loading ? <Spinner size="tiny" /> : undefined}
            >
              {loading
                ? t("auth.creatingAccount")
                : t("auth.createAccountAction")}
            </Button>
          </form>
        )}

        {(site?.enabled_providers?.length ?? 0) > 0 && !success && (
          <>
            <Divider>{t("auth.orSignUpWith")}</Divider>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {site!.enabled_providers.map((p) => (
                <ProviderButton
                  key={p.slug}
                  provider={p}
                  onClick={() =>
                    api
                      .connectionBegin(p.slug, {
                        mode: "login",
                        // Carry the invite token through the OAuth round-trip so
                        // invite-only mode is enforced when a social login
                        // creates a new account.
                        ...(form.invite_token
                          ? { invite: form.invite_token }
                          : {}),
                      })
                      .then(({ redirect }) => (window.location.href = redirect))
                  }
                />
              ))}
            </div>
          </>
        )}

        <div className={styles.footer}>
          <Text>{t("auth.alreadyHaveAccount")} </Text>
          <Link href="/login">{t("auth.signIn")}</Link>
        </div>
      </>
    </AuthShell>
  );
}
