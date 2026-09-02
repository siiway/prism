// Social login — confirm new account creation with custom username / display name

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

const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub",
  google: "Google",
  microsoft: "Microsoft",
  discord: "Discord",
  x: "X",
};

export function SocialConfirm() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setAuth } = useAuthStore();
  const { t } = useTranslation();
  const key = searchParams.get("key") ?? "";

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const {
    data,
    isLoading,
    error: fetchError,
  } = useQuery({
    queryKey: ["social-pending", key],
    queryFn: () => api.connectionPending(key),
    enabled: !!key,
    retry: false,
  });

  useEffect(() => {
    if (!key) navigate("/login", { replace: true });
  }, [key, navigate]);

  useEffect(() => {
    if (data && data.type !== "register") {
      navigate("/login", { replace: true });
    }
  }, [data, navigate]);

  // Seed the form draft from the suggested values once per data identity.
  // Render-time set per React 19's set-state-in-effect rule.
  const [seededFrom, setSeededFrom] = useState<typeof data>(undefined);
  if (data && data.type === "register" && data !== seededFrom) {
    setSeededFrom(data);
    setUsername(data.suggested_username ?? "");
    setDisplayName(data.suggested_display_name ?? "");
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await api.connectionComplete({
        key,
        action: "register",
        username: username.trim(),
        display_name: displayName.trim(),
      });
      // The register path never returns a 2FA gate — a brand-new account
      // can't have TOTP enrolled — but the union type on connectionComplete
      // makes us narrow.
      if ("user" in res) {
        setAuth(res.user);
        navigate("/", { replace: true });
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to create account",
      );
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

  const providerLabel = PROVIDER_LABELS[data.provider] ?? data.provider;

  return (
    <AuthShell maxWidth={420} cardGap={24}>
      <>
        {data.profile_avatar ? (
          <Avatar
            image={{ src: data.profile_avatar }}
            name={data.profile_name ?? undefined}
            size={64}
            style={{ alignSelf: "center" }}
          />
        ) : (
          <Avatar
            name={data.profile_name ?? providerLabel}
            size={64}
            style={{ alignSelf: "center" }}
          />
        )}

        <div style={{ textAlign: "center" }}>
          <Title2>{t("auth.createNewAccount")}</Title2>
          <Text
            block
            style={{ color: tokens.colorNeutralForeground3, marginTop: 8 }}
          >
            {t("auth.signingInVia", {
              providerName: data.profile_name ?? providerLabel,
            })}
          </Text>
        </div>

        {error && (
          <MessageBar intent="error" style={{ width: "100%" }}>
            {error}
          </MessageBar>
        )}

        <form onSubmit={handleCreate} className={styles.form}>
          <Field label="Username" required>
            <Input
              value={username}
              onChange={(e) =>
                setUsername(
                  e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""),
                )
              }
              placeholder="your_username"
              maxLength={32}
              autoComplete="username"
              autoFocus
            />
          </Field>
          <Field label="Display name" required>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your Name"
              maxLength={64}
            />
          </Field>

          <div className={styles.actions}>
            <Button
              appearance="primary"
              type="submit"
              disabled={submitting || !username.trim() || !displayName.trim()}
              icon={submitting ? <Spinner size="tiny" /> : undefined}
            >
              {submitting ? t("auth.creating") : t("auth.createAccountAction")}
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
