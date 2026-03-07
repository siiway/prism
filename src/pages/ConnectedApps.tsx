// Connected Apps — OAuth consents management

import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  DismissRegular,
  GlobeRegular,
  ShieldRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type OAuthConsent } from "../lib/api";

const useStyles = makeStyles({
  list: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  card: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    padding: "16px 20px",
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground2,
  },
  appIcon: {
    width: "48px",
    height: "48px",
    borderRadius: "8px",
    background: tokens.colorNeutralBackground3,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  info: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  nameRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  scopes: {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px",
    marginTop: "4px",
  },
});

export function ConnectedApps() {
  const styles = useStyles();
  const qc = useQueryClient();
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["consents"],
    queryFn: api.listConsents,
  });

  const handleRevoke = async (consent: OAuthConsent) => {
    setRevoking(consent.client_id);
    try {
      await api.revokeConsent(consent.client_id);
      await qc.invalidateQueries({ queryKey: ["consents"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Revoke failed");
    } finally {
      setRevoking(null);
    }
  };

  const consents = data?.consents ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <Title2>Connected Apps</Title2>
        <Text
          block
          style={{ color: tokens.colorNeutralForeground3, marginTop: 4 }}
        >
          Applications you have authorized to access your account. Revoking
          access signs you out of that app immediately.
        </Text>
      </div>

      {error && (
        <Text style={{ color: tokens.colorPaletteRedForeground1 }}>
          {error}
        </Text>
      )}

      {isLoading ? (
        <Text style={{ color: tokens.colorNeutralForeground3 }}>Loading…</Text>
      ) : consents.length === 0 ? (
        <Text style={{ color: tokens.colorNeutralForeground3 }}>
          No applications have been authorized yet.
        </Text>
      ) : (
        <div className={styles.list}>
          {consents.map((consent) => (
            <div key={consent.client_id} className={styles.card}>
              {consent.app.icon_url ? (
                <Avatar
                  image={{ src: consent.app.icon_url }}
                  name={consent.app.name}
                  size={48}
                  shape="square"
                />
              ) : (
                <div className={styles.appIcon}>
                  <GlobeRegular
                    fontSize={24}
                    style={{ color: tokens.colorNeutralForeground3 }}
                  />
                </div>
              )}

              <div className={styles.info}>
                <div className={styles.nameRow}>
                  <Text weight="semibold" size={400}>
                    {consent.app.name}
                  </Text>
                  {consent.app.is_verified && (
                    <Badge
                      color="success"
                      appearance="filled"
                      size="small"
                      icon={<ShieldRegular />}
                    >
                      Verified
                    </Badge>
                  )}
                </div>

                {consent.app.website_url && (
                  <Text
                    size={200}
                    style={{ color: tokens.colorNeutralForeground3 }}
                  >
                    {consent.app.website_url}
                  </Text>
                )}

                <div className={styles.scopes}>
                  {consent.scopes.map((s) => (
                    <Badge
                      key={s}
                      appearance="tint"
                      color="informative"
                      size="small"
                    >
                      {s}
                    </Badge>
                  ))}
                </div>

                <Text
                  size={100}
                  style={{
                    color: tokens.colorNeutralForeground3,
                    marginTop: 2,
                  }}
                >
                  Authorized{" "}
                  {new Date(consent.granted_at * 1000).toLocaleDateString()}
                </Text>
              </div>

              <Dialog>
                <DialogTrigger disableButtonEnhancement>
                  <Button
                    appearance="outline"
                    icon={<DismissRegular />}
                    size="small"
                    style={{ flexShrink: 0 }}
                    disabled={revoking === consent.client_id}
                  >
                    Revoke
                  </Button>
                </DialogTrigger>
                <DialogSurface>
                  <DialogBody>
                    <DialogTitle>
                      Revoke access for "{consent.app.name}"?
                    </DialogTitle>
                    <DialogContent>
                      This will sign you out of {consent.app.name} and delete
                      all active tokens. The app will need your authorization
                      again to access your account.
                    </DialogContent>
                    <DialogActions>
                      <DialogTrigger>
                        <Button>Cancel</Button>
                      </DialogTrigger>
                      <Button
                        appearance="primary"
                        style={{
                          background: tokens.colorPaletteRedBackground3,
                        }}
                        onClick={() => handleRevoke(consent)}
                      >
                        Revoke access
                      </Button>
                    </DialogActions>
                  </DialogBody>
                </DialogSurface>
              </Dialog>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
