// Standalone registration page for a team that mints its own accounts.
//
// Reached at /join/<teamId>, branded with the team so a visitor can confirm
// they are signing up to the right place before handing over a password.
//
// Registration and joining are two steps, because the team's join
// requirements (verified email, 2FA) can only be satisfied by an account that
// already exists. The page therefore stays mounted after the account is
// created and walks the user through whatever is outstanding, then completes
// the join and hands them back to `continue` if one was supplied.

import {
  Avatar,
  Button,
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
import { CheckmarkCircleFilled, CircleRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../lib/api";
import { useApi } from "../lib/api-context";
import { AuthShell } from "../components/AuthShell";
import { Captcha, type CaptchaValue } from "../components/Captcha";
import { PasswordInput } from "../components/PasswordInput";
import { useAuthStore } from "../store/auth";

const useStyles = makeStyles({
  form: { display: "flex", flexDirection: "column", gap: "12px" },
  teamHeader: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginBottom: "8px",
  },
  notice: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    lineHeight: tokens.lineHeightBase300,
  },
  step: { display: "flex", alignItems: "center", gap: "8px" },
});

type Phase = "form" | "requirements";

export function JoinRegister() {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const { teamId } = useParams<{ teamId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const {
    data: info,
    isLoading,
    error: loadError,
  } = useQuery({
    queryKey: ["join-page", teamId],
    queryFn: () => api.joinPageInfo(teamId!),
    enabled: !!teamId,
    retry: false,
  });

  const [phase, setPhase] = useState<Phase>("form");
  const [form, setForm] = useState({
    invite_token: searchParams.get("invite") ?? "",
    username: "",
    password: "",
    display_name: "",
    email: "",
  });
  const [captcha, setCaptcha] = useState<CaptchaValue>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const update =
    (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  // Only consulted once an account exists, so it is disabled until then.
  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ["invite-join-status"],
    queryFn: api.inviteJoinStatus,
    enabled: phase === "requirements",
    retry: false,
  });

  /** Where to send the user once they are a fully-fledged member. Validated
   *  server-side is not possible here, so only same-origin values are
   *  honoured — an attacker-supplied `continue` must not become an open
   *  redirect off the back of a registration link. */
  const continueTo = (() => {
    const raw = searchParams.get("continue");
    if (!raw) return null;
    try {
      const url = new URL(raw, window.location.origin);
      return url.origin === window.location.origin ? url.toString() : null;
    } catch {
      return null;
    }
  })();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!info || !teamId) return;
    setError("");
    setBusy(true);
    try {
      const res = await api.registerWithInvite({
        team_id: teamId,
        invite_token: form.invite_token.trim(),
        username: form.username.trim(),
        password: form.password,
        display_name: form.display_name || undefined,
        email: info.collects_email ? form.email.trim() : undefined,
        ...captcha,
      });
      // The account exists now, so the HttpOnly cookie authenticates the
      // remaining requirements without exposing its session credential.
      setAuth(res.user);
      setPhase("requirements");
      await refetchStatus();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : t("join.registerFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleComplete = async () => {
    setError("");
    setBusy(true);
    try {
      await api.completeInviteJoin();
      if (continueTo) window.location.href = continueTo;
      else navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("join.joinFailed"));
      await refetchStatus();
    } finally {
      setBusy(false);
    }
  };

  if (isLoading)
    return (
      <AuthShell>
        <Spinner />
      </AuthShell>
    );

  // A team that is not currently accepting registrations is indistinguishable
  // from one that does not exist — the server 404s either way.
  if (loadError || !info)
    return (
      <AuthShell>
        <Title2>{t("join.unavailableTitle")}</Title2>
        <Text className={styles.notice} style={{ marginTop: 8 }}>
          {t("join.unavailableDesc")}
        </Text>
      </AuthShell>
    );

  return (
    <AuthShell>
      <div className={styles.teamHeader}>
        <Avatar
          name={info.team.name}
          image={
            info.team.avatar_url ? { src: info.team.avatar_url } : undefined
          }
          size={40}
        />
        <div>
          <Title2>{info.team.name}</Title2>
          {info.team.description && (
            <Text className={styles.notice} block>
              {info.team.description}
            </Text>
          )}
        </div>
      </div>

      {error && (
        <MessageBar intent="error" style={{ marginBottom: 12 }}>
          {error}
        </MessageBar>
      )}

      {phase === "form" ? (
        <form className={styles.form} onSubmit={handleRegister}>
          <Text className={styles.notice}>{t("join.intro")}</Text>

          <Field label={t("join.inviteField")} required>
            <Input
              value={form.invite_token}
              onChange={update("invite_token")}
              placeholder={t("join.invitePlaceholder")}
            />
          </Field>
          <Field label={t("join.usernameField")} required>
            <Input value={form.username} onChange={update("username")} />
          </Field>
          <Field label={t("join.displayNameField")}>
            <Input
              value={form.display_name}
              onChange={update("display_name")}
            />
          </Field>
          {info.collects_email && (
            <Field label={t("join.emailField")} required>
              <Input
                type="email"
                value={form.email}
                onChange={update("email")}
              />
            </Field>
          )}
          <Field label={t("join.passwordField")} required>
            <PasswordInput
              value={form.password}
              onChange={(e) =>
                setForm((f) => ({ ...f, password: e.target.value }))
              }
            />
          </Field>

          {!info.collects_email && (
            <Text className={styles.notice}>{t("join.noEmailNotice")}</Text>
          )}

          {info.captcha_provider !== "none" && (
            <Captcha
              provider={info.captcha_provider}
              siteKey={info.captcha_site_key}
              turnstileEndpoint={info.turnstile_endpoint}
              turnstileChinaSiteKey={info.turnstile_china_site_key}
              onVerified={setCaptcha}
              onError={setError}
            />
          )}

          {/* Stated before signup, not after: an account created here does
              not outlive the team that created it. */}
          <MessageBar intent="warning">
            {t("join.deletionNotice", { team: info.team.name })}
          </MessageBar>

          <Button appearance="primary" type="submit" disabled={busy}>
            {busy ? <Spinner size="tiny" /> : t("join.createAccount")}
          </Button>

          <Text className={styles.notice}>
            {t("join.haveAccount")}{" "}
            <Link href={`/teams/join/${form.invite_token || ""}`}>
              {t("join.useExistingAccount")}
            </Link>
          </Text>
        </form>
      ) : (
        <div className={styles.form}>
          <Text className={styles.notice}>{t("join.requirementsIntro")}</Text>

          {status?.requirements.require_verified_email && (
            <div className={styles.step}>
              {status.unmet.includes("verified_email") ? (
                <CircleRegular />
              ) : (
                <CheckmarkCircleFilled
                  style={{ color: tokens.colorPaletteGreenForeground1 }}
                />
              )}
              <Text>{t("join.requireVerifiedEmail")}</Text>
              {status.unmet.includes("verified_email") && (
                <Link href="/profile" target="_blank">
                  {t("join.goVerify")}
                </Link>
              )}
            </div>
          )}

          {status?.requirements.require_2fa && (
            <div className={styles.step}>
              {status.unmet.includes("2fa") ? (
                <CircleRegular />
              ) : (
                <CheckmarkCircleFilled
                  style={{ color: tokens.colorPaletteGreenForeground1 }}
                />
              )}
              <Text>{t("join.require2FA")}</Text>
              {status.unmet.includes("2fa") && (
                <Link href="/security" target="_blank">
                  {t("join.goEnroll")}
                </Link>
              )}
            </div>
          )}

          <Button appearance="subtle" onClick={() => refetchStatus()}>
            {t("join.recheck")}
          </Button>

          <Button
            appearance="primary"
            onClick={handleComplete}
            disabled={busy || (status?.unmet.length ?? 1) > 0}
          >
            {busy ? <Spinner size="tiny" /> : t("join.finishJoining")}
          </Button>

          <Text className={styles.notice}>{t("join.pendingNotice")}</Text>
        </div>
      )}
    </AuthShell>
  );
}
