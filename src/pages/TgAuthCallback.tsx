// Telegram auth callback — reads #tgAuthResult fragment and verifies with backend

import { Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../store/auth";

const useStyles = makeStyles({
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
    gap: "16px",
    background: tokens.colorNeutralBackground1,
  },
});

export function TgAuthCallback() {
  const styles = useStyles();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { setAuth } = useAuthStore();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const nonce = params.get("tg_nonce");
    const slug = params.get("tg_slug");

    if (!nonce || !slug) {
      navigate("/login?error=missing_params", { replace: true });
      return;
    }

    // Telegram delivers auth data as a URL fragment: #tgAuthResult=BASE64_JSON
    const hash = window.location.hash;
    const prefix = "#tgAuthResult=";
    if (!hash.startsWith(prefix)) {
      navigate("/login?error=missing_params", { replace: true });
      return;
    }

    let tgData: Record<string, string>;
    try {
      const raw = atob(hash.slice(prefix.length));
      tgData = JSON.parse(raw) as Record<string, string>;
    } catch {
      navigate("/login?error=missing_params", { replace: true });
      return;
    }

    api
      .verifyTelegramAuth(slug, { nonce, tg_data: tgData })
      .then(async (res) => {
        if (res.type === "connect") {
          navigate("/connections?success=connected", { replace: true });
        } else if (res.type === "login" && res.token) {
          localStorage.setItem("token", res.token);
          const { user } = await api.me();
          setAuth(res.token, user);
          navigate("/", { replace: true });
        } else if (res.type === "register" && res.pending_key) {
          navigate(
            `/social-confirm?key=${encodeURIComponent(res.pending_key)}`,
            { replace: true },
          );
        } else if (res.type === "select" && res.pending_key) {
          navigate(
            `/social-select?key=${encodeURIComponent(res.pending_key)}`,
            { replace: true },
          );
        } else {
          navigate("/login?error=token_exchange_failed", { replace: true });
        }
      })
      .catch((err) => {
        const code =
          err instanceof ApiError
            ? err.message.toLowerCase().replace(/\s+/g, "_")
            : "token_exchange_failed";
        navigate(`/login?error=${code}`, { replace: true });
      });
  }, []);

  return (
    <div className={styles.page}>
      <Spinner size="large" />
      <Text style={{ color: tokens.colorNeutralForeground3 }}>
        Verifying Telegram login…
      </Text>
    </div>
  );
}
