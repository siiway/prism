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
  tokens,
} from "@fluentui/react-components";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";

const useStyles = makeStyles({
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
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
});

const PROVIDERS = [
  { id: "github", name: "GitHub", color: "#24292e" },
  { id: "google", name: "Google", color: "#4285f4" },
  { id: "microsoft", name: "Microsoft", color: "#0078d4" },
  { id: "discord", name: "Discord", color: "#5865f2" },
];

export function Connections() {
  const styles = useStyles();
  const qc = useQueryClient();
  const { data: connectionsData } = useQuery({
    queryKey: ["connections"],
    queryFn: api.listConnections,
  });
  const { data: site } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });

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
  };

  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 8000);
  };

  // Read ?error= / ?success= injected by the OAuth callback redirect
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
      showMsg("success", "Account connected successfully.");
      window.history.replaceState({}, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getConnection = (providerId: string) =>
    connectionsData?.connections.find((c) => c.provider === providerId);

  const handleConnect = (providerId: string) => {
    window.location.href = `/api/connections/${providerId}/begin?mode=connect`;
  };

  const handleDisconnect = async (providerId: string) => {
    try {
      await api.disconnectProvider(providerId);
      await qc.invalidateQueries({ queryKey: ["connections"] });
      showMsg("success", `Disconnected from ${providerId}`);
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : "Disconnect failed",
      );
    }
  };

  const enabledProviders = new Set(site?.enabled_providers ?? []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Title2>Linked Accounts</Title2>
      <Text style={{ color: tokens.colorNeutralForeground3 }}>
        Connect third-party accounts to sign in faster and share your identity.
      </Text>

      {message && (
        <MessageBar intent={message.type === "success" ? "success" : "error"}>
          {message.text}
        </MessageBar>
      )}

      <div className={styles.grid}>
        {PROVIDERS.map((p) => {
          const conn = getConnection(p.id);
          const enabled = enabledProviders.has(p.id);

          return (
            <div key={p.id} className={styles.providerCard}>
              <div className={styles.providerHeader}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    background: p.color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
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
                  {conn ? (
                    <Badge color="success" appearance="tint" size="small">
                      Connected
                    </Badge>
                  ) : (
                    <Badge color="subtle" appearance="tint" size="small">
                      Not connected
                    </Badge>
                  )}
                </div>
              </div>

              {conn && (
                <Text
                  size={200}
                  style={{ color: tokens.colorNeutralForeground3 }}
                >
                  Connected{" "}
                  {new Date(
                    (conn.connected_at as number) * 1000,
                  ).toLocaleDateString()}
                </Text>
              )}

              {!enabled ? (
                <Text
                  size={200}
                  style={{ color: tokens.colorNeutralForeground3 }}
                >
                  Not configured by admin
                </Text>
              ) : conn ? (
                <Dialog>
                  <DialogTrigger disableButtonEnhancement>
                    <Button appearance="outline" size="small">
                      Disconnect
                    </Button>
                  </DialogTrigger>
                  <DialogSurface>
                    <DialogBody>
                      <DialogTitle>Disconnect {p.name}?</DialogTitle>
                      <DialogContent>
                        You'll no longer be able to sign in with {p.name}. Make
                        sure you have another sign-in method available.
                      </DialogContent>
                      <DialogActions>
                        <DialogTrigger>
                          <Button>Cancel</Button>
                        </DialogTrigger>
                        <Button
                          appearance="primary"
                          onClick={() => handleDisconnect(p.id)}
                        >
                          Disconnect
                        </Button>
                      </DialogActions>
                    </DialogBody>
                  </DialogSurface>
                </Dialog>
              ) : (
                <Button
                  appearance="outline"
                  size="small"
                  onClick={() => handleConnect(p.id)}
                >
                  Connect {p.name}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
