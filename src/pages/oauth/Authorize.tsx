// OAuth 2.0 Authorization / Consent screen

import {
  Avatar,
  Button,
  Checkbox,
  Dropdown,
  Input,
  Option,
  Spinner,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  CheckmarkRegular,
  DismissRegular,
  KeyRegular,
  LockClosedRegular,
  PeopleRegular,
  PlugConnectedRegular,
  WarningRegular,
} from "@fluentui/react-icons";
import { startAuthentication } from "@simplewebauthn/browser";
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../lib/api";
import { AuthShell } from "../../components/AuthShell";
import { useAuthStore } from "../../store/auth";
import { OAuthConsentHeader } from "../../components/OAuthConsentHeader";

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
  scopeList: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  scopeItem: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: tokens.fontSizeBase300,
  },
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  divider: {
    borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
    // Full-bleed across the AuthShell card regardless of its padding
    margin: "0 calc(-1 * var(--auth-card-pad, 40px))",
  },
  siteScopeWarning: {
    padding: "16px",
    borderRadius: "8px",
    border: `1.5px solid ${tokens.colorPaletteRedBorder1}`,
    background: tokens.colorPaletteRedBackground1,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  siteScopeFields: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    padding: "16px",
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground3,
  },
  siteField: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  teamScopeSection: {
    padding: "16px",
    borderRadius: "8px",
    border: `1.5px solid ${tokens.colorPaletteMarigoldBorder1}`,
    background: tokens.colorPaletteMarigoldBackground1,
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
});

export function Authorize() {
  const styles = useStyles();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, token } = useAuthStore();
  const { t } = useTranslation();

  const params = Object.fromEntries(searchParams.entries());

  const { data, isLoading, error } = useQuery({
    queryKey: ["oauth-authorize", params.client_id, params.redirect_uri],
    queryFn: () => api.oauthAuthorizeInfo(params),
    retry: false,
  });

  useEffect(() => {
    if (
      error instanceof ApiError &&
      error.status === 403 &&
      typeof error.data === "object" &&
      error.data !== null &&
      (error.data as Record<string, unknown>).error === "unauthorized_whitelist"
    ) {
      const appName = (error.data as Record<string, unknown>).app_name ?? "";
      navigate(`/unauthorized?app_name=${encodeURIComponent(String(appName))}`);
    }
  }, [error, navigate]);

  const [loading, setLoading] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [siteError, setSiteError] = useState<string | null>(null);
  const [twoFaMode, setTwoFaMode] = useState<"totp" | "passkey">("totp");
  const [passkeyVerifyToken, setPasskeyVerifyToken] = useState("");
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const autoApproved = useRef(false);

  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [teamScopeError, setTeamScopeError] = useState<string | null>(null);
  const [declinedScopes, setDeclinedScopes] = useState<Set<string>>(new Set());

  const isSiteScope = useCallback((s: string) => s.startsWith("site:"), []);

  // Auto-decline all site scopes by default, so users must explicitly opt-in.
  // Render-time set (guarded by an identity ref) so the React 19 strict
  // rule against setState-in-effect is satisfied.
  const [autoDeclinedFor, setAutoDeclinedFor] = useState<{
    siteGrant: boolean;
  } | null>(null);
  if (
    data?.requires_site_grant &&
    autoDeclinedFor?.siteGrant !== data.requires_site_grant
  ) {
    setAutoDeclinedFor({
      siteGrant: data.requires_site_grant,
    });
    setDeclinedScopes((prev) => {
      const next = new Set(prev);
      data.scopes.filter(isSiteScope).forEach((s) => next.add(s));
      return next;
    });
  }

  const confirmPhrase = data?.site_scope_confirm_phrase ?? "grant site access";
  const requiresSiteGrant = data?.requires_site_grant ?? false;
  const siteScoresGrantable = data?.site_scopes_grantable ?? false;
  const requiresTeamGrant = data?.requires_team_grant ?? false;

  // "Log back in" — offered when the user already has a token for this app
  // and the scopes they're about to grant match the prior consent exactly,
  // so the new token cleanly replaces the old one. Skipped for team grants
  // because the user could pick a different team than they did last time.
  const approvedScopesSorted = (data?.scopes ?? [])
    .filter((s) => !declinedScopes.has(s))
    .slice()
    .sort();
  const priorScopesSorted = (data?.existing_consent_scopes ?? [])
    .slice()
    .sort();
  const canLogBackIn =
    !requiresTeamGrant &&
    (data?.existing_token_count ?? 0) > 0 &&
    data?.existing_consent_scopes != null &&
    approvedScopesSorted.length === priorScopesSorted.length &&
    approvedScopesSorted.every((s, i) => s === priorScopesSorted[i]);
  // Site grant is "pending" only if there are still site scopes not yet declined
  const hasPendingSiteScopes =
    requiresSiteGrant &&
    (data?.scopes ?? [])
      .filter(isSiteScope)
      .some((s) => !declinedScopes.has(s));
  const twoFaDone =
    twoFaMode === "passkey"
      ? passkeyVerifyToken.length > 0
      : totpCode.trim().length > 0;
  const siteGrantReady =
    !hasPendingSiteScopes ||
    (twoFaDone && confirmText.trim().toLowerCase() === confirmPhrase);
  const teamGrantReady = !requiresTeamGrant || selectedTeamId.length > 0;

  const handleDecision = async (action: "approve" | "deny") => {
    if (!data) return;
    setSiteError(null);
    setTeamScopeError(null);
    setLoading(true);
    try {
      const approvedScopes = data.scopes.filter((s) => !declinedScopes.has(s));
      const res = await api.oauthApprove({
        client_id: params.client_id,
        redirect_uri: params.redirect_uri,
        scope: approvedScopes.join(" "),
        state: params.state,
        code_challenge: params.code_challenge,
        code_challenge_method: params.code_challenge_method,
        nonce: params.nonce,
        // RFC 9126: when the request was pushed, forward its request_uri; the
        // server reads redirect_uri / PKCE / nonce / resource from it.
        ...(params.request_uri ? { request_uri: params.request_uri } : {}),
        // OIDC: forward max_age so the server can enforce re-authentication.
        ...(params.max_age ? { max_age: Number(params.max_age) } : {}),
        ...(params.prompt ? { prompt: params.prompt } : {}),
        action,
        ...(requiresSiteGrant && action === "approve"
          ? {
              ...(twoFaMode === "passkey"
                ? { passkey_verify_token: passkeyVerifyToken }
                : { totp_code: totpCode.trim() }),
              confirm_text: confirmText.trim(),
            }
          : {}),
        ...(requiresTeamGrant && action === "approve"
          ? { team_id: selectedTeamId }
          : {}),
        ...(action === "approve" && canLogBackIn
          ? { revoke_existing_tokens: true }
          : {}),
      });
      window.location.href = res.redirect;
    } catch (err) {
      if (err instanceof ApiError) {
        // Session expired / invalid during the POST — redirect to login
        // so the user can re-authenticate and return to the consent screen.
        if (err.status === 401 || err.message === "Unauthorized") {
          const loginUrl = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
          navigate(loginUrl, { replace: true });
          return;
        }

        const errorCode = err.message; // ApiError.message = the "error" field from JSON
        const humanMsg =
          typeof err.data === "object" &&
          err.data !== null &&
          "message" in (err.data as object)
            ? String((err.data as Record<string, unknown>).message)
            : err.message;
        if (
          errorCode === "site_scope_totp_invalid" ||
          errorCode === "site_scope_totp_required" ||
          errorCode === "site_scope_confirm_required" ||
          errorCode === "site_scope_admin_required"
        ) {
          setSiteError(humanMsg);
          setLoading(false);
          return;
        }
        if (
          errorCode === "team_id_required" ||
          errorCode === "team_scope_forbidden" ||
          errorCode === "team_scope_owner_required"
        ) {
          setTeamScopeError(humanMsg);
          setLoading(false);
          return;
        }
        // With a pushed request the browser URL carries no redirect_uri; use
        // the one the server resolved and returned via app-info.
        const redirectTarget = data?.redirect_uri ?? params.redirect_uri;
        const url = new URL(redirectTarget);
        url.searchParams.set("error", "server_error");
        url.searchParams.set("error_description", humanMsg);
        if (params.state) url.searchParams.set("state", params.state);
        window.location.href = url.toString();
      } else {
        const redirectTarget = data?.redirect_uri ?? params.redirect_uri;
        const url = new URL(redirectTarget);
        url.searchParams.set("error", "server_error");
        if (params.state) url.searchParams.set("state", params.state);
        window.location.href = url.toString();
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeyVerify = async () => {
    setSiteError(null);
    setPasskeyLoading(true);
    try {
      const beginData = await api.passkeyVerifyBegin();
      const authResponse = await startAuthentication({
        optionsJSON: beginData as Parameters<
          typeof startAuthentication
        >[0]["optionsJSON"],
      });
      const result = await api.passkeyVerifyFinish(
        (beginData as { challenge: string }).challenge,
        authResponse,
      );
      setPasskeyVerifyToken(result.verify_token);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? typeof err.data === "object" &&
            err.data !== null &&
            "message" in (err.data as object)
            ? String((err.data as Record<string, unknown>).message)
            : err.message
          : t("oauth.siteScopePasskeyFailed");
      setSiteError(msg);
    } finally {
      setPasskeyLoading(false);
    }
  };

  // A "reauth_done" marker on the URL means the user just re-authenticated for
  // this request (we set it on the return from /login), so a prompt=login /
  // max_age requirement is now satisfied even though the server still reports it.
  const reauthSatisfied = params.reauth_done === "1";

  // OIDC prompt=none: no UI is allowed. If the server says the request can't be
  // satisfied silently, bounce the error straight back to the client.
  useEffect(() => {
    if (data?.prompt_none_error) {
      const target = data.redirect_uri;
      if (!target) return;
      const url = new URL(target);
      url.searchParams.set("error", data.prompt_none_error);
      const st = data.state ?? params.state;
      if (st) url.searchParams.set("state", st);
      window.location.href = url.toString();
    }
  }, [data, params.state]);

  // OIDC prompt=login / max_age: force a fresh authentication, then return here
  // with a marker so the requirement is treated as satisfied (no loop). Only
  // for interactive prompts — prompt=none errors above instead.
  useEffect(() => {
    if (
      data &&
      data.reauth_required &&
      data.prompt !== "none" &&
      !reauthSatisfied
    ) {
      const back = new URL(window.location.href);
      back.searchParams.set("reauth_done", "1");
      const returnTo = back.pathname + back.search;
      navigate(`/login?redirect=${encodeURIComponent(returnTo)}&reauth=1`, {
        replace: true,
      });
    }
  }, [data, navigate, reauthSatisfied]);

  // Auto-approve first-party apps, or any app under prompt=none whose prior
  // consent already covers the request — but never skip consent for
  // site/team-level scopes, nor when the client explicitly asked for consent.
  useEffect(() => {
    if (!user || !token || !data || autoApproved.current) return;
    if (data.requires_site_grant || data.requires_team_grant) return;
    if (data.prompt === "consent") return;
    if (data.reauth_required && !reauthSatisfied) return;
    const silentPromptNone = data.prompt === "none" && !data.prompt_none_error;
    if (data.app.is_first_party || silentPromptNone) {
      autoApproved.current = true;
      // Defer out of the effect body so the approval's setState doesn't run
      // synchronously during render.
      queueMicrotask(() => handleDecision("approve"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleDecision is intentionally not a dep; the autoApproved ref guards against double-fire
  }, [data, user, token]);

  // If not logged in, redirect to login (client-side safety net; the route
  // loader handles the SSR redirect). Guarded against window-less SSR.
  // Also catches the case where the SSR-seeded session is stale: the
  // /app-info API returns user:null when the cookie/JWT has expired while the
  // Zustand store still carries the old token (seeded from SSR).
  useEffect(() => {
    if (!user || !token) {
      const loginUrl = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      navigate(loginUrl, { replace: true });
    }
  }, [user, token, navigate]);

  // API-level session check: even when the Zustand store still has a token
  // (SSR-seeded), the /app-info endpoint may return user:null if the cookie
  // expired or was revoked while the page was sitting open. Redirect to login.
  useEffect(() => {
    if (data && !data.user) {
      const loginUrl = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      navigate(loginUrl, { replace: true });
    }
  }, [data, navigate]);

  // While waiting for the auth-redirect effect to fire, show a spinner.
  // The route loader handles the SSR redirect (302), so this only runs on
  // the client as a safety net when the store is momentarily out of sync.
  if (!user || !token) {
    return (
      <div className={styles.page}>
        <Spinner size="large" />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={styles.page}>
        <Spinner size="large" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <AuthShell maxWidth={440} cardGap={24}>
        <Title2>{t("oauth.authorizationError")}</Title2>
        <Text style={{ color: tokens.colorPaletteRedForeground1 }}>
          {error instanceof ApiError
            ? error.message
            : t("oauth.invalidRequest")}
        </Text>
      </AuthShell>
    );
  }

  // A prompt=none error redirect or a prompt=login/max_age re-auth is being
  // navigated by the effects above — show a spinner rather than flashing the
  // consent screen.
  if (
    data.prompt_none_error ||
    (data.reauth_required && data.prompt !== "none" && !reauthSatisfied)
  ) {
    return (
      <div className={styles.page}>
        <Spinner size="large" />
      </div>
    );
  }

  const SCOPE_INFO: Record<string, { label: string; desc: string }> = {
    openid: {
      label: t("oauth.scopeIdentityLabel"),
      desc: t("oauth.scopeIdentityDesc"),
    },
    profile: {
      label: t("oauth.scopeProfileLabel"),
      desc: t("oauth.scopeProfileDesc"),
    },
    email: {
      label: t("oauth.scopeEmailLabel"),
      desc: t("oauth.scopeEmailDesc"),
    },
    "profile:write": {
      label: t("oauth.scopeProfileWriteLabel"),
      desc: t("oauth.scopeProfileWriteDesc"),
    },
    "apps:read": {
      label: t("oauth.scopeAppsLabel"),
      desc: t("oauth.scopeAppsDesc"),
    },
    "apps:write": {
      label: t("oauth.scopeAppsWriteLabel"),
      desc: t("oauth.scopeAppsWriteDesc"),
    },
    "teams:read": {
      label: t("oauth.scopeTeamsLabel"),
      desc: t("oauth.scopeTeamsDesc"),
    },
    "teams:write": {
      label: t("oauth.scopeTeamsWriteLabel"),
      desc: t("oauth.scopeTeamsWriteDesc"),
    },
    "teams:create": {
      label: t("oauth.scopeTeamsCreateLabel"),
      desc: t("oauth.scopeTeamsCreateDesc"),
    },
    "teams:delete": {
      label: t("oauth.scopeTeamsDeleteLabel"),
      desc: t("oauth.scopeTeamsDeleteDesc"),
    },
    "domains:read": {
      label: t("oauth.scopeDomainsLabel"),
      desc: t("oauth.scopeDomainsDesc"),
    },
    "domains:write": {
      label: t("oauth.scopeDomainsWriteLabel"),
      desc: t("oauth.scopeDomainsWriteDesc"),
    },
    "admin:users:read": {
      label: t("oauth.scopeAdminUsersReadLabel"),
      desc: t("oauth.scopeAdminUsersReadDesc"),
    },
    "admin:users:write": {
      label: t("oauth.scopeAdminUsersWriteLabel"),
      desc: t("oauth.scopeAdminUsersWriteDesc"),
    },
    "admin:users:delete": {
      label: t("oauth.scopeAdminUsersDeleteLabel"),
      desc: t("oauth.scopeAdminUsersDeleteDesc"),
    },
    "admin:config:read": {
      label: t("oauth.scopeAdminConfigReadLabel"),
      desc: t("oauth.scopeAdminConfigReadDesc"),
    },
    "admin:config:write": {
      label: t("oauth.scopeAdminConfigWriteLabel"),
      desc: t("oauth.scopeAdminConfigWriteDesc"),
    },
    "admin:invites:read": {
      label: t("oauth.scopeAdminInvitesReadLabel"),
      desc: t("oauth.scopeAdminInvitesReadDesc"),
    },
    "admin:invites:create": {
      label: t("oauth.scopeAdminInvitesCreateLabel"),
      desc: t("oauth.scopeAdminInvitesCreateDesc"),
    },
    "admin:invites:delete": {
      label: t("oauth.scopeAdminInvitesDeleteLabel"),
      desc: t("oauth.scopeAdminInvitesDeleteDesc"),
    },
    offline_access: {
      label: t("oauth.scopeOfflineLabel"),
      desc: t("oauth.scopeOfflineDesc"),
    },
    "site:user:read": {
      label: t("oauth.scopeSiteUserReadLabel"),
      desc: t("oauth.scopeSiteUserReadDesc"),
    },
    "site:user:write": {
      label: t("oauth.scopeSiteUserWriteLabel"),
      desc: t("oauth.scopeSiteUserWriteDesc"),
    },
    "site:user:delete": {
      label: t("oauth.scopeSiteUserDeleteLabel"),
      desc: t("oauth.scopeSiteUserDeleteDesc"),
    },
    "site:team:read": {
      label: t("oauth.scopeSiteTeamReadLabel"),
      desc: t("oauth.scopeSiteTeamReadDesc"),
    },
    "site:team:write": {
      label: t("oauth.scopeSiteTeamWriteLabel"),
      desc: t("oauth.scopeSiteTeamWriteDesc"),
    },
    "site:team:delete": {
      label: t("oauth.scopeSiteTeamDeleteLabel"),
      desc: t("oauth.scopeSiteTeamDeleteDesc"),
    },
    "site:config:read": {
      label: t("oauth.scopeSiteConfigReadLabel"),
      desc: t("oauth.scopeSiteConfigReadDesc"),
    },
    "site:config:write": {
      label: t("oauth.scopeSiteConfigWriteLabel"),
      desc: t("oauth.scopeSiteConfigWriteDesc"),
    },
    "site:token:revoke": {
      label: t("oauth.scopeSiteTokenRevokeLabel"),
      desc: t("oauth.scopeSiteTokenRevokeDesc"),
    },
  };

  return (
    <AuthShell maxWidth={440} cardGap={24}>
      <>
        <Title2>{t("oauth.authorizationRequest")}</Title2>

        {/* App info */}
        <OAuthConsentHeader app={data.app} user={user} />

        <div className={styles.divider} />

        {/* Requested scopes */}
        <div>
          <Text weight="semibold" block style={{ marginBottom: 12 }}>
            {t("oauth.requestingAccess", { appName: data.app.name })}
          </Text>
          <div className={styles.scopeList}>
            {data.scopes
              .filter((s) => !s.startsWith("app:") && !isSiteScope(s))
              .map((scope) => {
                const info = SCOPE_INFO[scope];
                const isOptional = (data.optional_scopes ?? []).includes(scope);
                const isDeclined = declinedScopes.has(scope);
                return (
                  <div key={scope} className={styles.scopeItem}>
                    {isOptional ? (
                      <Checkbox
                        checked={!isDeclined}
                        onChange={(_, d) => {
                          setDeclinedScopes((prev) => {
                            const next = new Set(prev);
                            if (d.checked) next.delete(scope);
                            else next.add(scope);
                            return next;
                          });
                        }}
                        style={{ flexShrink: 0 }}
                      />
                    ) : (
                      <CheckmarkRegular
                        style={{
                          color: tokens.colorBrandForeground1,
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <div style={{ opacity: isDeclined ? 0.45 : 1 }}>
                      <Text weight="semibold" block size={300}>
                        {info?.label ?? scope}
                      </Text>
                      {isOptional && (
                        <Text
                          size={100}
                          block
                          style={{ color: tokens.colorNeutralForeground3 }}
                        >
                          {t("oauth.optionalScopeHint")}
                        </Text>
                      )}
                      {info?.desc && (
                        <Text
                          size={200}
                          block
                          style={{
                            color: tokens.colorNeutralForeground3,
                            ...(isOptional ? { marginTop: 2 } : {}),
                          }}
                        >
                          {info.desc}
                        </Text>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>

          {/* Site-level scopes — danger section */}
          {requiresSiteGrant && (
            <div style={{ marginTop: 16 }}>
              <div className={styles.siteScopeWarning}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <WarningRegular
                    fontSize={20}
                    style={{
                      color: tokens.colorPaletteRedForeground1,
                      flexShrink: 0,
                    }}
                  />
                  <Text
                    weight="semibold"
                    style={{ color: tokens.colorPaletteRedForeground1 }}
                  >
                    {t("oauth.siteScopeWarningTitle")}
                  </Text>
                </div>
                <Text
                  size={200}
                  style={{ color: tokens.colorPaletteRedForeground1 }}
                >
                  {t("oauth.siteScopeWarningDesc")}
                </Text>
                <div className={styles.scopeList} style={{ marginTop: 4 }}>
                  {data.scopes.filter(isSiteScope).map((scope) => {
                    const info = SCOPE_INFO[scope];
                    const isDeclined = declinedScopes.has(scope);
                    return (
                      <div key={scope} className={styles.scopeItem}>
                        <Checkbox
                          checked={!isDeclined}
                          disabled={
                            user?.role !== "admin" || !siteScoresGrantable
                          }
                          onChange={(_, d) => {
                            setDeclinedScopes((prev) => {
                              const next = new Set(prev);
                              if (d.checked) next.delete(scope);
                              else next.add(scope);
                              return next;
                            });
                            setSiteError(null);
                          }}
                          style={{ flexShrink: 0 }}
                        />
                        <div style={{ opacity: isDeclined ? 0.45 : 1 }}>
                          <Text weight="semibold" block size={300}>
                            {info?.label ?? scope}
                          </Text>
                          {info?.desc && (
                            <Text
                              size={200}
                              style={{ color: tokens.colorNeutralForeground3 }}
                            >
                              {info.desc}
                            </Text>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {user?.role !== "admin" && (
                <Text
                  size={200}
                  style={{
                    color: tokens.colorPaletteRedForeground1,
                    marginTop: 8,
                  }}
                >
                  {t("oauth.siteScopeAdminOnly")}
                </Text>
              )}

              {user?.role === "admin" && !siteScoresGrantable && (
                <Text
                  size={200}
                  style={{
                    color: tokens.colorPaletteRedForeground1,
                    marginTop: 8,
                  }}
                >
                  {t("oauth.siteScopeNeeds2FA")}
                </Text>
              )}

              {user?.role === "admin" &&
                siteScoresGrantable &&
                hasPendingSiteScopes && (
                  <div
                    className={styles.siteScopeFields}
                    style={{ marginTop: 12 }}
                  >
                    <div className={styles.siteField}>
                      {twoFaMode === "totp" ? (
                        <>
                          <Text
                            size={200}
                            weight="semibold"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <LockClosedRegular fontSize={14} />
                            {t("oauth.siteScopeRequires2FA")}
                          </Text>
                          <Text
                            size={100}
                            style={{ color: tokens.colorNeutralForeground3 }}
                          >
                            {t("oauth.siteScopeRequires2FAHint")}
                          </Text>
                          <Input
                            value={totpCode}
                            onChange={(_, d) => {
                              setTotpCode(d.value);
                              setSiteError(null);
                            }}
                            placeholder="000000"
                            maxLength={6}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            style={{
                              fontFamily: "monospace",
                              letterSpacing: 4,
                            }}
                          />
                          <Button
                            appearance="subtle"
                            size="small"
                            icon={<KeyRegular />}
                            style={{ alignSelf: "flex-start", marginTop: 2 }}
                            onClick={() => {
                              setTwoFaMode("passkey");
                              setTotpCode("");
                              setSiteError(null);
                            }}
                          >
                            {t("oauth.siteScopeUsePasskey")}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Text
                            size={200}
                            weight="semibold"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <KeyRegular fontSize={14} />
                            {t("oauth.siteScopePasskeyVerify")}
                          </Text>
                          {passkeyVerifyToken ? (
                            <Text
                              size={200}
                              style={{
                                color: tokens.colorPaletteGreenForeground1,
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              <CheckmarkRegular />
                              {t("oauth.siteScopePasskeyVerified")}
                            </Text>
                          ) : (
                            <Button
                              appearance="primary"
                              icon={
                                passkeyLoading ? (
                                  <Spinner size="tiny" />
                                ) : (
                                  <KeyRegular />
                                )
                              }
                              disabled={passkeyLoading}
                              onClick={handlePasskeyVerify}
                            >
                              {t("oauth.siteScopePasskeyVerify")}
                            </Button>
                          )}
                          <Button
                            appearance="subtle"
                            size="small"
                            icon={<LockClosedRegular />}
                            style={{ alignSelf: "flex-start", marginTop: 2 }}
                            onClick={() => {
                              setTwoFaMode("totp");
                              setPasskeyVerifyToken("");
                              setSiteError(null);
                            }}
                          >
                            {t("oauth.siteScopeUseTotp")}
                          </Button>
                        </>
                      )}
                    </div>
                    <div className={styles.siteField}>
                      <Text size={200} weight="semibold">
                        {t("oauth.siteScopeConfirmLabel")}
                      </Text>
                      <Text
                        size={100}
                        style={{ color: tokens.colorNeutralForeground3 }}
                      >
                        {t("oauth.siteScopeConfirmHint")}
                      </Text>
                      <Input
                        value={confirmText}
                        onChange={(_, d) => {
                          setConfirmText(d.value);
                          setSiteError(null);
                        }}
                        placeholder={t("oauth.siteScopeConfirmPlaceholder")}
                      />
                      {confirmText.length > 0 &&
                        confirmText.trim().toLowerCase() !== confirmPhrase && (
                          <Text
                            size={100}
                            style={{ color: tokens.colorPaletteRedForeground1 }}
                          >
                            {t("oauth.siteScopeConfirmMismatch")}
                          </Text>
                        )}
                    </div>
                    {siteError && (
                      <Text
                        size={200}
                        style={{ color: tokens.colorPaletteRedForeground1 }}
                      >
                        {siteError}
                      </Text>
                    )}
                  </div>
                )}
            </div>
          )}

          {/* Team-scoped permissions */}
          {requiresTeamGrant && (
            <div style={{ marginTop: 16 }}>
              <div className={styles.teamScopeSection}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <PeopleRegular
                    fontSize={20}
                    style={{
                      color: tokens.colorPaletteMarigoldForeground1,
                      flexShrink: 0,
                    }}
                  />
                  <Text
                    weight="semibold"
                    style={{ color: tokens.colorPaletteMarigoldForeground1 }}
                  >
                    {t("oauth.teamScopeTitle")}
                  </Text>
                </div>
                <Text
                  size={200}
                  style={{ color: tokens.colorNeutralForeground2 }}
                >
                  {t("oauth.teamScopeDesc")}
                </Text>

                {/* Requested permissions list */}
                <div className={styles.scopeList}>
                  {(data.team_grant_permissions ?? []).map((perm) => {
                    const labelKey = `teamScopePerm${perm
                      .split(":")
                      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
                      .join("")}` as Parameters<typeof t>[0];
                    return (
                      <div key={perm} className={styles.scopeItem}>
                        <CheckmarkRegular
                          style={{
                            color: tokens.colorPaletteMarigoldForeground1,
                            flexShrink: 0,
                          }}
                        />
                        <Text size={300}>
                          {t(`oauth.${labelKey}` as Parameters<typeof t>[0])}
                        </Text>
                      </div>
                    );
                  })}
                </div>

                {/* Team picker */}
                {(data.user_admin_teams ?? []).length === 0 ? (
                  <Text
                    size={200}
                    style={{ color: tokens.colorPaletteRedForeground1 }}
                  >
                    {t("oauth.teamScopeNoTeams")}
                  </Text>
                ) : (
                  <div className={styles.siteField}>
                    <Text size={200} weight="semibold">
                      {t("oauth.teamScopeSelectLabel")}
                    </Text>
                    <Dropdown
                      placeholder={t("oauth.teamScopeSelectPlaceholder")}
                      value={
                        data.user_admin_teams.find(
                          (t) => t.id === selectedTeamId,
                        )?.name ?? ""
                      }
                      selectedOptions={selectedTeamId ? [selectedTeamId] : []}
                      onOptionSelect={(_, d) => {
                        setSelectedTeamId(d.optionValue ?? "");
                        setTeamScopeError(null);
                      }}
                    >
                      {data.user_admin_teams.map((team) => (
                        <Option key={team.id} value={team.id} text={team.name}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                            }}
                          >
                            {team.avatar_url ? (
                              <Avatar
                                image={{ src: team.avatar_url }}
                                name={team.name}
                                size={20}
                              />
                            ) : (
                              <Avatar name={team.name} size={20} />
                            )}
                            <Text>{team.name}</Text>
                            <Text
                              size={100}
                              style={{
                                color: tokens.colorNeutralForeground3,
                                marginLeft: 4,
                              }}
                            >
                              {team.role}
                            </Text>
                          </div>
                        </Option>
                      ))}
                    </Dropdown>
                  </div>
                )}

                {teamScopeError && (
                  <Text
                    size={200}
                    style={{ color: tokens.colorPaletteRedForeground1 }}
                  >
                    {teamScopeError}
                  </Text>
                )}
              </div>
            </div>
          )}

          {/* Scopes the app asked for but isn't allowed to receive — surfaced
              so the user can see the gap between what was requested and what
              the app is registered to use. */}
          {(data.rejected_scopes ?? []).length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Text
                size={200}
                weight="semibold"
                block
                style={{
                  color: tokens.colorPaletteDarkOrangeForeground1,
                  marginBottom: 4,
                }}
              >
                {t("oauth.rejectedScopesHeading")}
              </Text>
              <Text
                size={200}
                block
                style={{
                  color: tokens.colorNeutralForeground3,
                  marginBottom: 8,
                }}
              >
                {t("oauth.rejectedScopesHint")}
              </Text>
              <div className={styles.scopeList}>
                {(data.rejected_scopes ?? []).map((rs) => (
                  <div
                    key={rs.scope}
                    className={styles.scopeItem}
                    style={{ alignItems: "flex-start" }}
                  >
                    <DismissRegular
                      style={{
                        color: tokens.colorPaletteDarkOrangeForeground1,
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    />
                    <div>
                      <Text
                        size={300}
                        style={{
                          fontFamily: "monospace",
                          wordBreak: "break-all",
                        }}
                      >
                        {rs.scope}
                      </Text>
                      <Text
                        block
                        size={200}
                        style={{ color: tokens.colorNeutralForeground3 }}
                      >
                        {t(`oauth.rejectedScopeReason_${rs.reason}`)}
                      </Text>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* App-delegation scopes */}
          {(data.app_scopes ?? []).length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Text
                size={200}
                weight="semibold"
                block
                style={{
                  color: tokens.colorNeutralForeground3,
                  marginBottom: 8,
                }}
              >
                {t("oauth.appPermissionsHeading")}
              </Text>
              <div className={styles.scopeList}>
                {(data.app_scopes ?? []).map((as) => (
                  <div key={as.scope} className={styles.scopeItem}>
                    <PlugConnectedRegular
                      style={{
                        color: tokens.colorBrandForeground1,
                        flexShrink: 0,
                      }}
                    />
                    <div>
                      <Text weight="semibold" block size={300}>
                        {as.scope_title ?? as.app_name}
                        <Text
                          size={200}
                          style={{
                            color: tokens.colorNeutralForeground3,
                            marginLeft: 6,
                            fontWeight: "normal",
                          }}
                        >
                          · {as.app_name} · {as.inner_scope}
                        </Text>
                      </Text>
                      <Text
                        size={200}
                        style={{ color: tokens.colorNeutralForeground3 }}
                      >
                        {as.scope_desc ??
                          t("oauth.appPermissionDesc", {
                            appName: data.app.name,
                            targetApp: as.app_name,
                            scope: as.inner_scope,
                          })}
                      </Text>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {data.app.description && (
          <Text
            size={200}
            style={{
              color: tokens.colorNeutralForeground3,
              fontStyle: "italic",
            }}
          >
            "{data.app.description}"
          </Text>
        )}

        <div className={styles.divider} />

        <div className={styles.actions}>
          <Button
            appearance="primary"
            icon={loading ? <Spinner size="tiny" /> : <CheckmarkRegular />}
            disabled={loading || !siteGrantReady || !teamGrantReady}
            onClick={() => handleDecision("approve")}
          >
            {canLogBackIn
              ? t("oauth.logBackIn", { appName: data.app.name })
              : t("oauth.authorize", { appName: data.app.name })}
          </Button>
          {canLogBackIn && (
            <Text
              size={100}
              style={{
                color: tokens.colorNeutralForeground3,
                textAlign: "center",
                marginTop: -4,
              }}
            >
              {t("oauth.logBackInHint", {
                count: data.existing_token_count,
              })}
            </Text>
          )}
          <Button
            appearance="outline"
            icon={<DismissRegular />}
            disabled={loading}
            onClick={() => handleDecision("deny")}
          >
            {t("oauth.deny")}
          </Button>
        </div>

        <Text
          size={100}
          style={{ color: tokens.colorNeutralForeground4, textAlign: "center" }}
        >
          {t("oauth.footerNote", { appName: data.app.name })}
        </Text>
      </>
    </AuthShell>
  );
}
