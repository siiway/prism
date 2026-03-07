// Social login — select which Prism account to use

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
import { api } from "../lib/api";
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
  },
  accountList: { display: "flex", flexDirection: "column", gap: "8px" },
  accountRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "12px 16px",
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground1,
    cursor: "pointer",
    ":hover": { background: tokens.colorNeutralBackground3 },
  },
});

const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub",
  google: "Google",
  microsoft: "Microsoft",
  discord: "Discord",
};

export function SocialSelect() {
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
    if (data && data.type !== "select") navigate("/login", { replace: true });
  }, [data, navigate]);

  const handleSelect = async (userId: string) => {
    try {
      const res = await api.connectionComplete({
        key,
        action: "login",
        user_id: userId,
      });
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

  if (error || !data.users?.length) {
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
        <div>
          <Title2>Which account do you want to use?</Title2>
          <Text
            block
            style={{ color: tokens.colorNeutralForeground3, marginTop: 8 }}
          >
            Multiple Prism accounts are linked to your {providerLabel} account
            {data.profile_name ? ` (${data.profile_name})` : ""}. Pick one to
            sign in.
          </Text>
        </div>

        <div className={styles.accountList}>
          {data.users.map((u) => (
            <div
              key={u.id}
              className={styles.accountRow}
              onClick={() => handleSelect(u.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && handleSelect(u.id)}
            >
              <Avatar
                name={u.display_name}
                image={u.avatar_url ? { src: u.avatar_url } : undefined}
                size={40}
              />
              <div>
                <Text weight="semibold" block>
                  {u.display_name}
                </Text>
                <Text
                  size={200}
                  style={{ color: tokens.colorNeutralForeground3 }}
                >
                  @{u.username}
                </Text>
              </div>
            </div>
          ))}
        </div>

        <Button appearance="subtle" onClick={() => navigate("/login")}>
          Back to login
        </Button>
      </div>
    </div>
  );
}
