// Social platform connections page

import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  MessageBar,
  Text,
  Title2,
  makeStyles,
  Spinner,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  ArrowClockwiseRegular,
  DeleteRegular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../lib/api";
import { SkeletonAppCards } from "../components/Skeletons";

const useStyles = makeStyles({
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
    gap: "16px",
  },
  providerCard: {
    padding: "20px",
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground2,
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  providerHeader: { display: "flex", alignItems: "center", gap: "12px" },
  connRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 10px",
    borderRadius: "6px",
    background: tokens.colorNeutralBackground3,
    gap: "8px",
  },
});

const PROVIDER_COLORS: Record<string, string> = {
  github: "#24292e",
  google: "#4285f4",
  microsoft: "#0078d4",
  discord: "#5865f2",
  telegram: "#2AABEE",
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid_state:
    "Login session expired or link was already used. Please try connecting again.",
  profile_fetch_failed:
    "Could not retrieve your profile from the provider. Check that the app has the correct permissions and try again.",
  token_exchange_failed:
    "Failed to complete sign-in with the provider. Please try again.",
  no_access_token:
    "The provider did not return an access token. Please try again.",
  no_user_id: "Could not read your account ID from the provider.",
  missing_params: "The provider returned an incomplete response.",
  access_denied:
    "You cancelled the sign-in or denied the requested permissions.",
  registration_disabled:
    "New registrations are currently disabled on this server.",
  user_creation_failed:
    "Account creation failed. Please contact an administrator.",
  already_connected: "This account is already linked to your profile.",
  account_taken: "This account is already linked to another user.",
  invalid_signature:
    "The response from Telegram could not be verified. Please try again.",
  auth_expired:
    "The Telegram authentication session expired. Please try again.",
  unsupported_refresh:
    "This provider does not support refreshing linked profile data.",
  account_mismatch:
    "Could not refresh this connection because the provider returned a different account.",
};

function getDisplayName(profile: unknown): string | null {
  if (!profile || typeof profile !== "object") return null;
  const p = profile as Record<string, unknown>;
  const telegramName =
    [p.first_name, p.last_name].filter(Boolean).join(" ") || null;
  return (
    (p.name as string) ||
    telegramName ||
    (p.login as string) ||
    (p.username as string) ||
    (p.global_name as string) ||
    (p.email as string) ||
    null
  );
}

function getProfileTextField(profile: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = profile[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "bigint") {
      return String(value);
    }
  }
  return null;
}

function getConnectionDetails(conn: {
  profile: unknown;
  provider_user_id: string;
}) {
  const profile =
    conn.profile && typeof conn.profile === "object"
      ? (conn.profile as Record<string, unknown>)
      : null;
  const telegramNickname = profile
    ? [profile.first_name, profile.last_name]
        .filter((part): part is string => typeof part === "string" && !!part)
        .join(" ")
        .trim() || null
    : null;
  const nickname = profile
    ? (getProfileTextField(profile, [
        "nickname",
        "display_name",
        "name",
        "global_name",
      ]) ?? telegramNickname)
    : null;
  const username = profile
    ? getProfileTextField(profile, [
        "username",
        "login",
        "preferred_username",
        "user_name",
      ])
    : null;
  const platformId =
    (profile
      ? getProfileTextField(profile, ["id", "sub", "user_id", "uid"])
      : null) ?? conn.provider_user_id;
  return {
    nickname,
    username,
    platformId,
    display: nickname ?? username ?? getDisplayName(conn.profile) ?? platformId,
  };
}

export function Connections() {
  const styles = useStyles();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { data: connectionsData, isLoading: connsLoading } = useQuery({
    queryKey: ["connections"],
    queryFn: api.listConnections,
  });
  const { data: site, isLoading: siteLoading } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });

  const isLoading = connsLoading || siteLoading;

  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [refreshingConnectionId, setRefreshingConnectionId] = useState<
    string | null
  >(null);

  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 8000);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    const success = params.get("success");
    if (error) {
      showMsg(
        "error",
        ERROR_MESSAGES[error] ??
          `Connection failed: ${error.replace(/_/g, " ")}`,
      );
      window.history.replaceState({}, "", window.location.pathname);
    } else if (success === "connected") {
      showMsg("success", t("connections.connectedSuccessfully"));
      window.history.replaceState({}, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getConnections = (providerId: string) =>
    connectionsData?.connections.filter((c) => c.provider === providerId) ?? [];

  const handleConnect = async (providerId: string) => {
    try {
      const { token: intent } = await api.connectionIntent();
      const { redirect } = await api.connectionBegin(providerId, {
        mode: "connect",
        intent,
      });
      window.location.href = redirect;
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError
          ? err.message
          : t("connections.failedStartConnection"),
      );
    }
  };

  const handleDisconnect = async (id: string, providerName: string) => {
    try {
      await api.disconnectConnection(id);
      await qc.invalidateQueries({ queryKey: ["connections"] });
      showMsg(
        "success",
        t("connections.disconnectedFrom", { provider: providerName }),
      );
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError
          ? err.message
          : t("connections.disconnectFailed"),
      );
    }
  };

  const handleRefresh = async (id: string, providerName: string) => {
    setRefreshingConnectionId(id);
    try {
      await api.refreshConnection(id);
      await qc.invalidateQueries({ queryKey: ["connections"] });
      showMsg("success", t("connections.refreshedFrom", { provider: providerName }));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError
          ? (ERROR_MESSAGES[err.message] ?? err.message)
          : t("connections.refreshFailed"),
      );
    } finally {
      setRefreshingConnectionId((curr) => (curr === id ? null : curr));
    }
  };

  const providers = site?.enabled_providers ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Title2>{t("connections.title")}</Title2>
      <Text style={{ color: tokens.colorNeutralForeground3 }}>
        {t("connections.description")}
      </Text>

      {message && (
        <MessageBar intent={message.type === "success" ? "success" : "error"}>
          {message.text}
        </MessageBar>
      )}

      {isLoading ? <SkeletonAppCards count={4} /> : null}

      <div className={styles.grid} style={isLoading ? { display: "none" } : {}}>
        {providers.map((p) => {
          const conns = getConnections(p.slug);
          const color = PROVIDER_COLORS[p.provider] ?? "#666";

          return (
            <div key={p.slug} className={styles.providerCard}>
              <div className={styles.providerHeader}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    background: color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Text
                    style={{ color: "white", fontWeight: 700, fontSize: 16 }}
                  >
                    {p.name[0]}
                  </Text>
                </div>
                <div style={{ flex: 1 }}>
                  <Text weight="semibold" block>
                    {p.name}
                  </Text>
                  {conns.length > 0 ? (
                    <Badge color="success" appearance="tint" size="small">
                      {t("connections.connected", { count: conns.length })}
                    </Badge>
                  ) : (
                    <Badge color="subtle" appearance="tint" size="small">
                      {t("connections.notConnected")}
                    </Badge>
                  )}
                </div>
              </div>

              {conns.map((conn) => {
                const details = getConnectionDetails(conn);
                const displayName = details.display;
                return (
                  <div key={conn.id} className={styles.connRow}>
                    <div style={{ minWidth: 0 }}>
                      <Text
                        size={200}
                        weight="semibold"
                        block
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {displayName ?? conn.provider_user_id}
                      </Text>
                      {details.nickname ? (
                        <Text
                          size={100}
                          block
                          style={{ color: tokens.colorNeutralForeground3 }}
                        >
                          {t("connections.detailNickname", {
                            value: details.nickname,
                          })}
                        </Text>
                      ) : null}
                      {details.username ? (
                        <Text
                          size={100}
                          block
                          style={{ color: tokens.colorNeutralForeground3 }}
                        >
                          {t("connections.detailUsername", {
                            value: details.username,
                          })}
                        </Text>
                      ) : null}
                      {details.platformId ? (
                        <Text
                          size={100}
                          block
                          style={{ color: tokens.colorNeutralForeground3 }}
                        >
                          {t("connections.detailId", {
                            value: details.platformId,
                          })}
                        </Text>
                      ) : null}
                      <Text
                        size={100}
                        style={{ color: tokens.colorNeutralForeground3 }}
                      >
                        {t("connections.connectedOn", {
                          date: new Date(
                            conn.connected_at * 1000,
                          ).toLocaleDateString(),
                        })}
                      </Text>
                    </div>

                    <div style={{ display: "flex", gap: 4 }}>
                      <Button
                        icon={
                          refreshingConnectionId === conn.id ? (
                            <Spinner size="tiny" />
                          ) : (
                            <ArrowClockwiseRegular />
                          )
                        }
                        appearance="subtle"
                        size="small"
                        title={t("connections.refreshAction")}
                        onClick={() => handleRefresh(conn.id, p.name)}
                        disabled={refreshingConnectionId === conn.id}
                      />
                      <Dialog>
                        <DialogTrigger disableButtonEnhancement>
                          <Button
                            icon={<DeleteRegular />}
                            appearance="subtle"
                            size="small"
                            title={t("connections.disconnectAction")}
                          />
                        </DialogTrigger>
                        <DialogSurface>
                          <DialogBody>
                            <DialogTitle>
                              {t("connections.disconnectTitle", {
                                provider: p.name,
                              })}
                            </DialogTitle>
                            <DialogContent>
                              {displayName
                                ? t("connections.disconnectDesc", {
                                    name: displayName,
                                  })
                                : null}{" "}
                              {t("connections.disconnectWarning")}
                            </DialogContent>
                            <DialogActions>
                              <DialogTrigger>
                                <Button>{t("common.cancel")}</Button>
                              </DialogTrigger>
                              <Button
                                appearance="primary"
                                onClick={() => handleDisconnect(conn.id, p.name)}
                              >
                                {t("connections.disconnectAction")}
                              </Button>
                            </DialogActions>
                          </DialogBody>
                        </DialogSurface>
                      </Dialog>
                    </div>
                  </div>
                );
              })}

              <Button
                appearance="outline"
                size="small"
                icon={<AddRegular />}
                onClick={() => handleConnect(p.slug)}
              >
                {conns.length > 0
                  ? t("connections.addAnother", { provider: p.name })
                  : t("connections.connect", { provider: p.name })}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
