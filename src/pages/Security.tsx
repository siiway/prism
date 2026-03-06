// Security page: TOTP, Passkeys, Sessions

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
  Field,
  Input,
  MessageBar,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { DeleteRegular, KeyRegular, PhoneRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { startRegistration } from "@simplewebauthn/browser";
import { api, ApiError } from "../lib/api";

const useStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: "32px" },
  card: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "8px",
    padding: "24px",
    background: tokens.colorNeutralBackground2,
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  actions: { display: "flex", gap: "8px" },
  qrSection: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    alignItems: "center",
  },
  backupCodes: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "8px",
    padding: "12px",
    background: tokens.colorNeutralBackground3,
    borderRadius: "4px",
    fontFamily: "monospace",
  },
});

export function Security() {
  const styles = useStyles();
  const qc = useQueryClient();

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me });
  const { data: passkeysData, refetch: refetchPasskeys } = useQuery({
    queryKey: ["passkeys"],
    queryFn: api.listPasskeys,
  });
  const { data: sessionsData, refetch: refetchSessions } = useQuery({
    queryKey: ["sessions"],
    queryFn: api.listSessions,
  });

  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 6000);
  };

  // ─── TOTP setup ──────────────────────────────────────────────────────────
  const [totpSetup, setTotpSetup] = useState<{
    secret: string;
    uri: string;
  } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpLoading, setTotpLoading] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [disableCode, setDisableCode] = useState("");

  const handleSetupTotp = async () => {
    setTotpLoading(true);
    try {
      const res = await api.totpSetup();
      setTotpSetup(res);
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : "Failed to set up TOTP",
      );
    } finally {
      setTotpLoading(false);
    }
  };

  const handleVerifyTotp = async () => {
    setTotpLoading(true);
    try {
      const res = await api.totpVerify(totpCode);
      setBackupCodes(res.backup_codes);
      setTotpSetup(null);
      setTotpCode("");
      await qc.invalidateQueries({ queryKey: ["me"] });
      showMsg("success", "Two-factor authentication enabled!");
    } catch (err) {
      showMsg("error", err instanceof ApiError ? err.message : "Invalid code");
    } finally {
      setTotpLoading(false);
    }
  };

  const handleDisableTotp = async () => {
    try {
      await api.totpDisable(disableCode);
      setDisableCode("");
      await qc.invalidateQueries({ queryKey: ["me"] });
      showMsg("success", "Two-factor authentication disabled");
    } catch (err) {
      showMsg("error", err instanceof ApiError ? err.message : "Invalid code");
    }
  };

  // ─── Passkeys ────────────────────────────────────────────────────────────
  const [passkeyName, setPasskeyName] = useState("");
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  const handleAddPasskey = async () => {
    setPasskeyLoading(true);
    try {
      const options = await api.passkeyRegBegin();
      const response = await startRegistration({
        optionsJSON: options as Parameters<
          typeof startRegistration
        >[0]["optionsJSON"],
      });
      await api.passkeyRegFinish(response, passkeyName || undefined);
      setPasskeyName("");
      await refetchPasskeys();
      showMsg("success", "Passkey registered!");
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : "Passkey registration failed",
      );
    } finally {
      setPasskeyLoading(false);
    }
  };

  const handleDeletePasskey = async (id: string) => {
    try {
      await api.deletePasskey(id);
      await refetchPasskeys();
      showMsg("success", "Passkey removed");
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : "Failed to remove passkey",
      );
    }
  };

  // ─── Sessions ────────────────────────────────────────────────────────────
  const handleRevokeSession = async (id: string) => {
    try {
      await api.revokeSession(id);
      await refetchSessions();
      showMsg("success", "Session revoked");
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : "Failed to revoke session",
      );
    }
  };

  return (
    <div className={styles.page}>
      <Title2>Security</Title2>

      {message && (
        <MessageBar intent={message.type === "success" ? "success" : "error"}>
          {message.text}
        </MessageBar>
      )}

      {/* TOTP */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <Text weight="semibold" size={400} block>
              Two-Factor Authentication (TOTP)
            </Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              Use an authenticator app like Authy or Google Authenticator.
            </Text>
          </div>
          <Badge
            color={me?.totp_enabled ? "success" : "subtle"}
            appearance="filled"
          >
            {me?.totp_enabled ? "Enabled" : "Disabled"}
          </Badge>
        </div>

        {!me?.totp_enabled && !totpSetup && (
          <Button
            appearance="primary"
            icon={<PhoneRegular />}
            onClick={handleSetupTotp}
            disabled={totpLoading}
          >
            {totpLoading ? <Spinner size="tiny" /> : "Set up TOTP"}
          </Button>
        )}

        {totpSetup && (
          <div className={styles.qrSection}>
            <Text>Scan this QR code with your authenticator app:</Text>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(totpSetup.uri)}&size=200x200`}
              alt="TOTP QR Code"
              width={200}
              height={200}
              style={{ borderRadius: 8 }}
            />
            <Text
              size={200}
              style={{
                fontFamily: "monospace",
                background: tokens.colorNeutralBackground3,
                padding: "4px 8px",
                borderRadius: 4,
              }}
            >
              {totpSetup.secret}
            </Text>
            <Field
              label="Enter the 6-digit code to verify"
              style={{ width: "100%", maxWidth: 260 }}
            >
              <Input
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                placeholder="000000"
                maxLength={6}
                autoComplete="one-time-code"
              />
            </Field>
            <div className={styles.actions}>
              <Button
                appearance="primary"
                onClick={handleVerifyTotp}
                disabled={totpLoading || totpCode.length < 6}
              >
                {totpLoading ? <Spinner size="tiny" /> : "Verify & Enable"}
              </Button>
              <Button onClick={() => setTotpSetup(null)}>Cancel</Button>
            </div>
          </div>
        )}

        {backupCodes && (
          <div>
            <Text weight="semibold" block>
              Save these backup codes — they won't be shown again:
            </Text>
            <div className={styles.backupCodes}>
              {backupCodes.map((c) => (
                <Text key={c} style={{ fontFamily: "monospace" }}>
                  {c}
                </Text>
              ))}
            </div>
            <Button
              size="small"
              onClick={() => setBackupCodes(null)}
              style={{ marginTop: 8 }}
            >
              Done
            </Button>
          </div>
        )}

        {me?.totp_enabled && (
          <Dialog>
            <DialogTrigger disableButtonEnhancement>
              <Button
                appearance="outline"
                style={{ color: tokens.colorPaletteRedForeground1 }}
              >
                Disable TOTP
              </Button>
            </DialogTrigger>
            <DialogSurface>
              <DialogBody>
                <DialogTitle>Disable Two-Factor Authentication</DialogTitle>
                <DialogContent>
                  <Field label="Enter your current TOTP code to confirm">
                    <Input
                      value={disableCode}
                      onChange={(e) => setDisableCode(e.target.value)}
                      placeholder="000000"
                      maxLength={6}
                    />
                  </Field>
                </DialogContent>
                <DialogActions>
                  <DialogTrigger>
                    <Button appearance="secondary">Cancel</Button>
                  </DialogTrigger>
                  <Button
                    appearance="primary"
                    style={{ background: tokens.colorPaletteRedBackground3 }}
                    onClick={handleDisableTotp}
                  >
                    Disable
                  </Button>
                </DialogActions>
              </DialogBody>
            </DialogSurface>
          </Dialog>
        )}
      </div>

      {/* Passkeys */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <Text weight="semibold" size={400} block>
              Passkeys
            </Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              Sign in with biometrics or a hardware security key.
            </Text>
          </div>
        </div>

        {(passkeysData?.passkeys.length ?? 0) > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Added</TableHeaderCell>
                <TableHeaderCell>Last used</TableHeaderCell>
                <TableHeaderCell></TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {passkeysData!.passkeys.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.name ?? "Passkey"}</TableCell>
                  <TableCell>{p.device_type}</TableCell>
                  <TableCell>
                    {new Date(p.created_at * 1000).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {p.last_used_at
                      ? new Date(p.last_used_at * 1000).toLocaleDateString()
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Button
                      icon={<DeleteRegular />}
                      appearance="subtle"
                      onClick={() => handleDeletePasskey(p.id)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <Field label="Passkey name (optional)" style={{ flex: 1 }}>
            <Input
              value={passkeyName}
              onChange={(e) => setPasskeyName(e.target.value)}
              placeholder="My MacBook"
            />
          </Field>
          <Button
            appearance="primary"
            icon={<KeyRegular />}
            onClick={handleAddPasskey}
            disabled={passkeyLoading}
          >
            {passkeyLoading ? <Spinner size="tiny" /> : "Add passkey"}
          </Button>
        </div>
      </div>

      {/* Sessions */}
      <div className={styles.card}>
        <Text weight="semibold" size={400} block>
          Active Sessions
        </Text>
        {(sessionsData?.sessions.length ?? 0) === 0 ? (
          <Text style={{ color: tokens.colorNeutralForeground3 }}>
            No active sessions
          </Text>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Device</TableHeaderCell>
                <TableHeaderCell>IP</TableHeaderCell>
                <TableHeaderCell>Created</TableHeaderCell>
                <TableHeaderCell>Expires</TableHeaderCell>
                <TableHeaderCell></TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessionsData!.sessions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell
                    style={{
                      maxWidth: 200,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {s.user_agent ?? "Unknown"}
                  </TableCell>
                  <TableCell>{s.ip_address ?? "—"}</TableCell>
                  <TableCell>
                    {new Date(s.created_at * 1000).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {new Date(s.expires_at * 1000).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Button
                      icon={<DeleteRegular />}
                      appearance="subtle"
                      onClick={() => handleRevokeSession(s.id)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
