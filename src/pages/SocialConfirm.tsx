// Social login — confirm new account creation

import {
  Avatar,
  Button,
  Spinner,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useEffect } from "react";
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
    width: "400px",
    padding: "40px",
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground2,
    display: "flex",
    flexDirection: "column",
    gap: "24px",
    alignItems: "center",
    textAlign: "center",
  },
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

  const { data, isLoading, error } = useQuery({
    queryKey: ["social-pending", key],
    queryFn: () => api.connectionPending(key),
    enabled: !!key,
    retry: false,
  });

  useEffect(() => {
    if (!key) navigate("/login", { replace: true });
  }, [key, navigate]);

  useEffect(() => {
    if (data && data.type !== "register") navigate("/login", { replace: true });
  }, [data, navigate]);

  const handleCreate = async () => {
    try {
      const res = await api.connectionComplete({ key, action: "register" });
      setAuth(res.token, res.user);
      navigate("/", { replace: true });
    } catch (err) {
      console.error(err);
    }
  };

  if (isLoading || !data) {
    return (
      <div className={styles.page}>
        <Spinner size="large" />
      </div>
    );
  }

  if (error) {
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
            size={72}
          />
        ) : (
          <Avatar name={data.profile_name ?? providerLabel} size={72} />
        )}

        <div>
          <Title2>Create a new account?</Title2>
          <Text
            block
            style={{ color: tokens.colorNeutralForeground3, marginTop: 8 }}
          >
            No Prism account is linked to{" "}
            <strong>{data.profile_name ?? "your " + providerLabel + " account"}</strong>.
            Would you like to create one?
          </Text>
        </div>

        <div className={styles.actions}>
          <Button appearance="primary" onClick={handleCreate}>
            Create account
          </Button>
          <Button appearance="subtle" onClick={() => navigate("/login")}>
            Back to login
          </Button>
        </div>
      </div>
    </div>
  );
}
