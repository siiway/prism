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
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../store/auth";

const useStyles = makeStyles({
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: tokens.colorNeutralBackground1,
  },
  card: {
    width: "420px",
    padding: "40px",
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground2,
    display: "flex",
    flexDirection: "column",
    gap: "24px",
    alignItems: "center",
  },
  form: { display: "flex", flexDirection: "column", gap: "12px", width: "100%" },
  actions: { display: "flex", flexDirection: "column", gap: "8px", width: "100%" },
});

const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub",
  google: "Google",
  microsoft: "Microsoft",
  discord: "Discord",
};

export function SocialConfirm() {
  const styles = useStyles();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setAuth } = useAuthStore();
  const key = searchParams.get("key") ?? "";

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const { data, isLoading, error: fetchError } = useQuery({
    queryKey: ["social-pending", key],
    queryFn: () => api.connectionPending(key),
    enabled: !!key,
    retry: false,
  });

  useEffect(() => {
    if (!key) navigate("/login", { replace: true });
  }, [key, navigate]);

  useEffect(() => {
    if (data) {
      if (data.type !== "register") {
        navigate("/login", { replace: true });
        return;
      }
      setUsername(data.suggested_username ?? "");
      setDisplayName(data.suggested_display_name ?? "");
    }
  }, [data, navigate]);

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
      setAuth(res.token, res.user);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create account");
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
      <div className={styles.page}>
        <div className={styles.card}>
          <Title2>Session Expired</Title2>
          <Text style={{ color: tokens.colorNeutralForeground3 }}>
            This link has expired or is invalid.
          </Text>
          <Button appearance="primary" onClick={() => navigate("/login")}>
            Back to login
          </Button>
        </div>
      </div>
    );
  }

  const providerLabel = PROVIDER_LABELS[data.provider] ?? data.provider;

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {data.profile_avatar ? (
          <Avatar
            image={{ src: data.profile_avatar }}
            name={data.profile_name ?? undefined}
            size={64}
          />
        ) : (
          <Avatar name={data.profile_name ?? providerLabel} size={64} />
        )}

        <div style={{ textAlign: "center" }}>
          <Title2>Create a new account</Title2>
          <Text
            block
            style={{ color: tokens.colorNeutralForeground3, marginTop: 8 }}
          >
            Signing in via{" "}
            <strong>{data.profile_name ?? providerLabel}</strong>. Choose your
            username and display name.
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
              {submitting ? "Creating…" : "Create account"}
            </Button>
            <Button appearance="subtle" onClick={() => navigate("/login")}>
              Back to login
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
