// Social login — TOTP step-up for untrusted providers.
//
// A social provider marked trusted=0 (see admin OAuth Sources) short-circuits
// the callback and bounces the browser here with a pending key. We look up
// which account is being logged into for context, then submit the TOTP code;
// the resulting session remains exclusively in the HttpOnly cookie.

import { Field, Input } from "@fluentui/react-components";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiErrorText } from "../lib/apiError";
import { useApi } from "../lib/api-context";
import {
  SocialError,
  SocialForm,
  SocialHeader,
  SocialPendingFallback,
  SocialShell,
} from "../components/SocialPending";
import { useAuthStore } from "../store/auth";

export function Social2fa() {
  const api = useApi();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setAuth } = useAuthStore();
  const { t } = useTranslation();
  const key = searchParams.get("key") ?? "";

  const [totpCode, setTotpCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const { data, error: fetchError } = useQuery({
    queryKey: ["social-2fa-pending", key],
    queryFn: () => api.connectionSocial2faPending(key),
    enabled: !!key,
    retry: false,
  });

  useEffect(() => {
    if (!key) navigate("/login", { replace: true });
  }, [key, navigate]);

  const handleVerify = async () => {
    setError("");
    setSubmitting(true);
    try {
      const res = await api.connectionSocial2faVerify({
        key,
        totp_code: totpCode.trim(),
      });
      setAuth(res.user);
      navigate("/", { replace: true });
    } catch (err) {
      setError(apiErrorText(err, t("auth.loginFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  if (!data) return <SocialPendingFallback expired={!!fetchError} />;

  return (
    <SocialShell>
      <SocialHeader
        avatar={{ name: data.user.display_name, url: data.user.avatar_url }}
        title={t("auth.social2faTitle")}
        subtitle={t("auth.social2faSubtitle", {
          providerName: data.provider_name,
          displayName: data.user.display_name,
        })}
      />
      <SocialError error={error} />
      <SocialForm
        onSubmit={handleVerify}
        submitting={submitting}
        canSubmit={!!totpCode.trim()}
        label={t("common.verify")}
        busyLabel={t("auth.signingIn")}
      >
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
      </SocialForm>
    </SocialShell>
  );
}
