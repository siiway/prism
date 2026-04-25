// OAuth 2.0 Authorization / Consent screen

import {
  Avatar,
  Badge,
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
  GlobeRegular,
  KeyRegular,
  LockClosedRegular,
  PeopleRegular,
  PlugConnectedRegular,
  ShieldRegular,
  WarningRegular,
} from "@fluentui/react-icons";
import { startAuthentication } from "@simplewebauthn/browser";
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../lib/api";
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
  card: {
    width: "100%",
    maxWidth: "440px",
    padding: "40px",
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground2,
    display: "flex",
    flexDirection: "column",
    gap: "24px",
  },
  appRow: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    padding: "16px",
    background: tokens.colorNeutralBackground3,
    borderRadius: "8px",
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
    margin: "0 -40px",
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
  publicClientWarning: {
    padding: "12px 14px",
    borderRadius: "8px",
    border: `1px solid ${tokens.colorPaletteMarigoldBorder1}`,
    background: tokens.colorPaletteMarigoldBackground1,
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
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

  // Auto-decline all site scopes when user has no 2FA enrolled
  useEffect(() => {
    if (!data?.requires_site_grant || data.site_scopes_grantable) return;
    setDeclinedScopes((prev) => {
      const next = new Set(prev);
      data.scopes.filter(isSiteScope).forEach((s) => next.add(s));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when grant flags change; data.scopes/isSiteScope are stable when those flags don't
  }, [data?.requires_site_grant, data?.site_scopes_grantable]);

  const confirmPhrase = data?.site_scope_confirm_phrase ?? "grant site access";
  const requiresSiteGrant = data?.requires_site_grant ?? false;
  const siteScoresGrantable = data?.site_scopes_grantable ?? false;
  const requiresTeamGrant = data?.requires_team_grant ?? false;
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
      });
      window.location.href = res.redirect;
    } catch (err) {
      if (err instanceof ApiError) {
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
        const url = new URL(params.redirect_uri);
        url.searchParams.set("error", "server_error");
        url.searchParams.set("error_description", humanMsg);
        if (params.state) url.searchParams.set("state", params.state);
        window.location.href = url.toString();
      } else {
        const url = new URL(params.redirect_uri);
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

  // Auto-approve first-party apps — but never skip consent for site/team-level scopes
  useEffect(() => {
    if (
      data?.app.is_first_party &&
      !data.requires_site_grant &&
      !data.requires_team_grant &&
      !autoApproved.current
    ) {
      autoApproved.current = true;
      handleDecision("approve");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleDecision is intentionally not a dep; the autoApproved ref guards against double-fire
  }, [data]);

  // If not logged in, redirect to login
  if (!user || !token) {
    const loginUrl = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    navigate(loginUrl, { replace: true });
    return null;
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
      <div className={styles.page}>
        <div className={styles.card}>
          <Title2>{t("oauth.authorizationError")}</Title2>
          <Text style={{ color: tokens.colorPaletteRedForeground1 }}>
            {error instanceof ApiError
              ? error.message
              : t("oauth.invalidRequest")}
          </Text>
        </div>
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
    "admin:webhooks:read": {
      label: t("oauth.scopeAdminWebhooksReadLabel"),
      desc: t("oauth.scopeAdminWebhooksReadDesc"),
    },
    "admin:webhooks:write": {
      label: t("oauth.scopeAdminWebhooksWriteLabel"),
      desc: t("oauth.scopeAdminWebhooksWriteDesc"),
    },
    "admin:webhooks:delete": {
      label: t("oauth.scopeAdminWebhooksDeleteLabel"),
      desc: t("oauth.scopeAdminWebhooksDeleteDesc"),
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
    <div className={styles.page}>
      <div className={styles.card}>
        <Title2>{t("oauth.authorizationRequest")}</Title2>

        {/* App info */}
        <div className={styles.appRow}>
          {data.app.icon_url ? (
            <Avatar
              image={{ src: data.app.icon_url }}
              name={data.app.name}
              size={48}
            />
          ) : (
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 8,
                background: tokens.colorBrandBackground,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <GlobeRegular
                fontSize={24}
                style={{ color: tokens.colorNeutralForegroundOnBrand }}
              />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Text weight="semibold" size={400}>
                {data.app.name}
              </Text>
              {data.app.is_official && (
                <Badge color="brand" appearance="filled" size="small">
                  {t("oauth.official")}
                </Badge>
              )}
              {data.app.is_verified && (
                <Badge
                  color="success"
                  appearance="filled"
                  size="small"
                  icon={<ShieldRegular />}
                >
                  {t("oauth.verified")}
                </Badge>
              )}
            </div>
            {data.app.website_url && (
              <Text
                size={200}
                style={{ color: tokens.colorNeutralForeground3 }}
              >
                {data.app.website_url}
              </Text>
            )}
          </div>
        </div>

        {/* Public-client warning */}
        {data.app.is_public && (
          <div className={styles.publicClientWarning}>
            <WarningRegular
              fontSize={20}
              style={{
                color: tokens.colorPaletteMarigoldForeground1,
                flexShrink: 0,
                marginTop: 2,
              }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Text
                weight="semibold"
                size={300}
                style={{ color: tokens.colorPaletteMarigoldForeground1 }}
              >
                {t("oauth.publicClientWarningTitle")}
              </Text>
              <Text
                size={200}
                style={{ color: tokens.colorNeutralForeground2 }}
              >
                {t("oauth.publicClientWarningDesc")}
              </Text>
            </div>
          </div>
        )}

        {/* Logged in as */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {t("oauth.signingInAs")}
          </Text>
          <Avatar
            name={user.display_name}
            image={user.avatar_url ? { src: user.avatar_url } : undefined}
            size={20}
          />
          <Text size={200} weight="semibold">
            @{user.username}
          </Text>
        </div>

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
                            maxLength={8}
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
                            <span>{team.name}</span>
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
            {t("oauth.authorize", { appName: data.app.name })}
          </Button>
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
      </div>
    </div>
  );
}
