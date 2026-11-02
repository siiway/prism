// Social login — confirm new account creation with custom username / display name

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

export function SocialConfirm() {
  const api = useApi();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setAuth } = useAuthStore();
  const { t } = useTranslation();
  const key = searchParams.get("key") ?? "";

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
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

  const handleCreate = async () => {
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
      setError(apiErrorText(err, t("auth.registrationFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  if (!data) return <SocialPendingFallback expired={!!fetchError} />;

  const providerName = data.profile_name ?? data.provider_name;

  return (
    <SocialShell>
      <SocialHeader
        avatar={{ name: providerName, url: data.profile_avatar }}
        title={t("auth.createNewAccount")}
        subtitle={t("auth.signingInVia", { providerName })}
      />
      <SocialError error={error} />
      <SocialForm
        onSubmit={handleCreate}
        submitting={submitting}
        canSubmit={!!username.trim() && !!displayName.trim()}
        label={t("auth.createAccountAction")}
        busyLabel={t("auth.creating")}
      >
        <Field label={t("auth.username")} required>
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
        <Field label={t("auth.displayName")} required>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t("auth.displayNamePlaceholder")}
            maxLength={64}
          />
        </Field>
      </SocialForm>
    </SocialShell>
  );
}
