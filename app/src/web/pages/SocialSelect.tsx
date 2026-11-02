// Social login — select which Prism account to use

import {
  Avatar,
  Card,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSiteName } from "../lib/useSiteName";
import { apiErrorText } from "../lib/apiError";
import { useApi } from "../lib/api-context";
import {
  BackToLogin,
  SocialError,
  SocialHeader,
  SocialPendingFallback,
  SocialShell,
} from "../components/SocialPending";
import { useAuthStore } from "../store/auth";

const useStyles = makeStyles({
  accountList: { display: "flex", flexDirection: "column", gap: "8px" },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: "12px",
    cursor: "pointer",
    transition: "background 0.15s",
    ":hover": { background: tokens.colorNeutralBackground3 },
  },
  muted: { color: tokens.colorNeutralForeground3 },
});

export function SocialSelect() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setAuth } = useAuthStore();
  const { t } = useTranslation();
  const siteName = useSiteName();
  const key = searchParams.get("key") ?? "";
  const [error, setError] = useState("");

  const { data, error: fetchError } = useQuery({
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
    setError("");
    try {
      const res = await api.connectionComplete({
        key,
        action: "login",
        user_id: userId,
      });
      if ("type" in res && res.type === "2fa") {
        navigate(`/social-2fa?key=${encodeURIComponent(res.pending_key)}`, {
          replace: true,
        });
        return;
      }
      if ("user" in res) {
        setAuth(res.user);
        navigate("/", { replace: true });
      }
    } catch (err) {
      setError(apiErrorText(err, t("auth.loginFailed")));
    }
  };

  // No accounts to choose from means the state is unusable: treat it as gone.
  if (!data?.users?.length)
    return <SocialPendingFallback expired={!!data || !!fetchError} />;

  const profileSuffix = data.profile_name ? ` (${data.profile_name})` : "";

  return (
    <SocialShell>
      <SocialHeader
        title={t("auth.whichAccount")}
        subtitle={t("auth.multipleAccountsLinked", {
          siteName,
          provider: data.provider_name,
          profileSuffix,
        })}
        centered={false}
      />
      <SocialError error={error} />

      <div className={styles.accountList}>
        {data.users.map((u) => (
          <Card
            key={u.id}
            className={styles.accountRow}
            onClick={() => handleSelect(u.id)}
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
              <Text size={200} className={styles.muted}>
                @{u.username}
              </Text>
            </div>
          </Card>
        ))}
      </div>

      <BackToLogin />
    </SocialShell>
  );
}
