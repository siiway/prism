// RFC 8628 Device Authorization Grant — user verification screen.
//
// A device with no browser shows the user a short code and a URL. The user
// opens this page, enters the code (or arrives with it pre-filled via
// verification_uri_complete), reviews the app and scopes, and approves or
// denies. The device is polling the token endpoint meanwhile.

import {
  Button,
  Input,
  Spinner,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  CheckmarkCircleRegular,
  CheckmarkRegular,
  DismissCircleRegular,
  DismissRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import { AuthShell } from "../../components/AuthShell";
import { OAuthConsentHeader } from "../../components/OAuthConsentHeader";
import { useAuthStore } from "../../store/auth";

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
  scopeList: { display: "flex", flexDirection: "column", gap: "8px" },
  scopeItem: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: tokens.fontSizeBase300,
  },
  actions: { display: "flex", flexDirection: "column", gap: "8px" },
  divider: {
    borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
    margin: "0 calc(-1 * var(--auth-card-pad, 40px))",
  },
  center: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    alignItems: "center",
    textAlign: "center",
  },
  codeInput: {
    fontFamily: "monospace",
    letterSpacing: "4px",
    textAlign: "center",
  },
});

// Labels for the scopes the device flow can grant (site/team scopes are
// refused upstream, so they never appear here). Unknown scopes fall back to
// their raw identifier.
const SCOPE_LABEL_KEYS: Record<string, string> = {
  openid: "oauth.scopeIdentityLabel",
  profile: "oauth.scopeProfileLabel",
  email: "oauth.scopeEmailLabel",
  "profile:write": "oauth.scopeProfileWriteLabel",
  "apps:read": "oauth.scopeAppsLabel",
  "apps:write": "oauth.scopeAppsWriteLabel",
  "teams:read": "oauth.scopeTeamsLabel",
  "teams:write": "oauth.scopeTeamsWriteLabel",
  "teams:create": "oauth.scopeTeamsCreateLabel",
  "teams:delete": "oauth.scopeTeamsDeleteLabel",
  "domains:read": "oauth.scopeDomainsLabel",
  "domains:write": "oauth.scopeDomainsWriteLabel",
  offline_access: "oauth.scopeOfflineLabel",
};

export function DeviceVerify() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuthStore();
  const { t } = useTranslation();

  const userCode = (searchParams.get("user_code") ?? "").trim();
  const [codeInput, setCodeInput] = useState(userCode);
  const [decision, setDecision] = useState<"approved" | "denied" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["device-verify", userCode],
    queryFn: () => api.deviceVerifyInfo(userCode),
    enabled: userCode.length > 0 && !!user,
    retry: false,
  });

  // Not signed in: bounce to login and come back to this exact URL.
  if (userCode && !user) {
    const loginUrl = `/login?redirect=${encodeURIComponent(
      window.location.pathname + window.location.search,
    )}`;
    navigate(loginUrl, { replace: true });
    return (
      <div className={styles.page}>
        <Spinner size="large" />
      </div>
    );
  }

  // Step 1 — no code yet: prompt for it.
  if (!userCode) {
    return (
      <AuthShell maxWidth={440} cardGap={24}>
        <Title2>{t("oauth.device.title")}</Title2>
        <Text>{t("oauth.device.enterCodePrompt")}</Text>
        <Input
          value={codeInput}
          onChange={(_, d) => setCodeInput(d.value)}
          placeholder="XXXX-XXXX"
          input={{ className: styles.codeInput }}
          aria-label={t("oauth.device.codeLabel")}
        />
        <Button
          appearance="primary"
          disabled={codeInput.trim().length === 0}
          onClick={() =>
            navigate(
              `/device?user_code=${encodeURIComponent(codeInput.trim())}`,
            )
          }
        >
          {t("oauth.device.continue")}
        </Button>
      </AuthShell>
    );
  }

  if (isLoading) {
    return (
      <div className={styles.page}>
        <Spinner size="large" />
      </div>
    );
  }

  // Decision already made this session, or the code was invalid/expired.
  if (decision === "approved") {
    return (
      <AuthShell maxWidth={440} cardGap={24}>
        <div className={styles.center}>
          <CheckmarkCircleRegular
            fontSize={48}
            style={{ color: tokens.colorPaletteGreenForeground1 }}
          />
          <Title2>{t("oauth.device.approvedTitle")}</Title2>
          <Text>{t("oauth.device.approvedBody")}</Text>
        </div>
      </AuthShell>
    );
  }
  if (decision === "denied") {
    return (
      <AuthShell maxWidth={440} cardGap={24}>
        <div className={styles.center}>
          <DismissCircleRegular
            fontSize={48}
            style={{ color: tokens.colorPaletteRedForeground1 }}
          />
          <Title2>{t("oauth.device.deniedTitle")}</Title2>
          <Text>{t("oauth.device.deniedBody")}</Text>
        </div>
      </AuthShell>
    );
  }

  if (error || !data) {
    return (
      <AuthShell maxWidth={440} cardGap={24}>
        <div className={styles.center}>
          <DismissCircleRegular
            fontSize={48}
            style={{ color: tokens.colorPaletteRedForeground1 }}
          />
          <Title2>{t("oauth.device.invalidTitle")}</Title2>
          <Text>{t("oauth.device.invalidBody")}</Text>
          <Button appearance="primary" onClick={() => navigate("/device")}>
            {t("oauth.device.continue")}
          </Button>
        </div>
      </AuthShell>
    );
  }

  const decide = async (action: "approve" | "deny") => {
    setSubmitting(true);
    try {
      const res = await api.deviceDecision(userCode, action);
      setDecision(res.status);
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.status === 401 || err.message === "Unauthorized")
      ) {
        navigate(
          `/login?redirect=${encodeURIComponent(
            window.location.pathname + window.location.search,
          )}`,
          { replace: true },
        );
        return;
      }
      // On any other failure treat the request as no longer grantable.
      setDecision("denied");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell maxWidth={440} cardGap={24}>
      <>
        <Title2>{t("oauth.device.title")}</Title2>
        {user && <OAuthConsentHeader app={data.app} user={user} />}
        <div className={styles.divider} />
        <div>
          <Text weight="semibold" block style={{ marginBottom: 12 }}>
            {t("oauth.device.requestingAccess", { appName: data.app.name })}
          </Text>
          <div className={styles.scopeList}>
            {data.scopes.map((scope) => (
              <div key={scope} className={styles.scopeItem}>
                <CheckmarkRegular
                  style={{ color: tokens.colorBrandForeground1, flexShrink: 0 }}
                />
                <Text size={300}>
                  {SCOPE_LABEL_KEYS[scope]
                    ? t(SCOPE_LABEL_KEYS[scope] as Parameters<typeof t>[0])
                    : scope}
                </Text>
              </div>
            ))}
          </div>
        </div>
        <div className={styles.divider} />
        <div className={styles.actions}>
          <Button
            appearance="primary"
            icon={submitting ? <Spinner size="tiny" /> : <CheckmarkRegular />}
            disabled={submitting}
            onClick={() => decide("approve")}
          >
            {t("oauth.device.approve", { appName: data.app.name })}
          </Button>
          <Button
            appearance="outline"
            icon={<DismissRegular />}
            disabled={submitting}
            onClick={() => decide("deny")}
          >
            {t("oauth.device.deny")}
          </Button>
        </div>
        <Text
          size={100}
          style={{ color: tokens.colorNeutralForeground4, textAlign: "center" }}
        >
          {t("oauth.device.footerNote")}
        </Text>
      </>
    </AuthShell>
  );
}
