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
import {
  AddRegular,
  ArrowDownloadRegular,
  ArrowSyncRegular,
  CopyRegular,
  DeleteRegular,
  KeyRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { startRegistration } from "@simplewebauthn/browser";
import { api, ApiError } from "../lib/api";
import type { PasskeyInfo, SessionInfo } from "../lib/api";

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
  hiddenOnMobile: {
    "@media (max-width: 768px)": { display: "none" },
  },
  row: {
    cursor: "pointer",
    ":hover": { background: tokens.colorNeutralBackground3 },
  },
});

export function Security() {
  const styles = useStyles();
  const qc = useQueryClient();

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me });
  const { data: totpData, refetch: refetchTotp } = useQuery({
    queryKey: ["totp-list"],
    queryFn: api.totpList,
  });
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

  // ─── TOTP ────────────────────────────────────────────────────────────────
  const [totpSetup, setTotpSetup] = useState<{
    id: string;
    secret: string;
    uri: string;
  } | null>(null);
  const [totpName, setTotpName] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpLoading, setTotpLoading] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [removeCode, setRemoveCode] = useState("");
  const [resetBkCode, setResetBkCode] = useState("");
  const [selectedTotp, setSelectedTotp] = useState<{
    id: string;
    name: string;
    created_at: number;
  } | null>(null);

  const handleSetupTotp = async () => {
    setTotpLoading(true);
    try {
      const res = await api.totpSetup(totpName || undefined);
      setTotpSetup(res);
      setTotpCode("");
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
    if (!totpSetup) return;
    setTotpLoading(true);
    try {
      const res = await api.totpVerify(totpSetup.id, totpCode);
      if (res.backup_codes) setBackupCodes(res.backup_codes);
      setTotpSetup(null);
      setTotpName("");
      setTotpCode("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["me"] }),
        refetchTotp(),
      ]);
      showMsg("success", "Authenticator added!");
    } catch (err) {
      showMsg("error", err instanceof ApiError ? err.message : "Invalid code");
    } finally {
      setTotpLoading(false);
    }
  };

  const handleRemoveTotp = async () => {
    if (!removeId) return;
    try {
      await api.totpRemove(removeId, removeCode);
      setRemoveId(null);
      setRemoveCode("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["me"] }),
        refetchTotp(),
      ]);
      showMsg("success", "Authenticator removed");
    } catch (err) {
      showMsg("error", err instanceof ApiError ? err.message : "Invalid code");
    }
  };

  const handleResetBackupCodes = async () => {
    try {
      const res = await api.totpNewBackupCodes(resetBkCode);
      setBackupCodes(res.backup_codes);
      setResetBkCode("");
      await refetchTotp();
      showMsg("success", "Backup codes regenerated");
    } catch (err) {
      showMsg("error", err instanceof ApiError ? err.message : "Invalid code");
    }
  };

  // ─── Passkeys ────────────────────────────────────────────────────────────
  const [passkeyName, setPasskeyName] = useState("");
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [selectedPasskey, setSelectedPasskey] = useState<PasskeyInfo | null>(
    null,
  );

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
      setSelectedPasskey(null);
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
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(
    null,
  );

  const handleRevokeSession = async (id: string) => {
    try {
      await api.revokeSession(id);
      setSelectedSession(null);
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
              Authenticator Apps (TOTP)
            </Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              Use apps like Authy or Google Authenticator. One set of backup
              codes is shared across all authenticators.
            </Text>
          </div>
          <Badge
            color={me?.totp_enabled ? "success" : "subtle"}
            appearance="filled"
          >
            {me?.totp_enabled ? "Enabled" : "Disabled"}
          </Badge>
        </div>

        {/* Authenticator list */}
        <>
          {(totpData?.authenticators.filter((a) => a.enabled).length ?? 0) >
            0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell className={styles.hiddenOnMobile}>
                    Added
                  </TableHeaderCell>
                  <TableHeaderCell className={styles.hiddenOnMobile} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {totpData!.authenticators
                  .filter((a) => a.enabled)
                  .map((a) => (
                    <TableRow
                      key={a.id}
                      className={styles.row}
                      onClick={() => setSelectedTotp(a)}
                    >
                      <TableCell>{a.name}</TableCell>
                      <TableCell className={styles.hiddenOnMobile}>
                        {new Date(a.created_at * 1000).toLocaleDateString()}
                      </TableCell>
                      <TableCell className={styles.hiddenOnMobile}>
                        <div onClick={(e) => e.stopPropagation()}>
                          <Button
                            icon={<DeleteRegular />}
                            appearance="subtle"
                            onClick={() => {
                              setRemoveId(a.id);
                              setRemoveCode("");
                            }}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}

          {/* TOTP detail dialog (mobile) */}
          <Dialog
            open={!!selectedTotp}
            onOpenChange={(_, s) => {
              if (!s.open) setSelectedTotp(null);
            }}
          >
            <DialogSurface>
              <DialogBody>
                <DialogTitle>{selectedTotp?.name}</DialogTitle>
                <DialogContent>
                  <Text size={200}>
                    <strong>Added:</strong>{" "}
                    {selectedTotp
                      ? new Date(
                          selectedTotp.created_at * 1000,
                        ).toLocaleDateString()
                      : ""}
                  </Text>
                </DialogContent>
                <DialogActions>
                  <Button onClick={() => setSelectedTotp(null)}>Close</Button>
                  <Button
                    appearance="primary"
                    style={{ background: tokens.colorPaletteRedBackground3 }}
                    onClick={() => {
                      if (!selectedTotp) return;
                      setRemoveId(selectedTotp.id);
                      setRemoveCode("");
                      setSelectedTotp(null);
                    }}
                  >
                    Remove
                  </Button>
                </DialogActions>
              </DialogBody>
            </DialogSurface>
          </Dialog>
        </>

        {/* Add authenticator flow */}
        {!totpSetup && (
          <div className={styles.actions}>
            <Field label="Name (optional)" style={{ flex: 1 }}>
              <Input
                value={totpName}
                onChange={(e) => setTotpName(e.target.value)}
                placeholder="My Phone"
              />
            </Field>
            <Button
              appearance="primary"
              icon={<AddRegular />}
              onClick={handleSetupTotp}
              disabled={totpLoading}
              style={{ alignSelf: "flex-end" }}
            >
              {totpLoading ? <Spinner size="tiny" /> : "Add authenticator"}
            </Button>
          </div>
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

        {/* Backup codes display after enabling or reset */}
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
            <div className={styles.actions} style={{ marginTop: 8 }}>
              <Button
                size="small"
                icon={<CopyRegular />}
                onClick={() =>
                  navigator.clipboard.writeText(backupCodes.join("\n"))
                }
              >
                Copy
              </Button>
              <Button
                size="small"
                icon={<ArrowDownloadRegular />}
                onClick={() => {
                  const blob = new Blob([backupCodes.join("\n")], {
                    type: "text/plain",
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "prism-backup-codes.txt";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Download
              </Button>
              <Button size="small" onClick={() => setBackupCodes(null)}>
                Done
              </Button>
            </div>
          </div>
        )}

        {/* Backup codes status + reset */}
        {me?.totp_enabled && !backupCodes && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {totpData?.backup_codes_remaining ?? 0} backup code
              {totpData?.backup_codes_remaining !== 1 ? "s" : ""} remaining
            </Text>
            <Dialog>
              <DialogTrigger disableButtonEnhancement>
                <Button size="small" icon={<ArrowSyncRegular />}>
                  Reset backup codes
                </Button>
              </DialogTrigger>
              <DialogSurface>
                <DialogBody>
                  <DialogTitle>Reset Backup Codes</DialogTitle>
                  <DialogContent>
                    <Field label="Enter a TOTP code to confirm">
                      <Input
                        value={resetBkCode}
                        onChange={(e) => setResetBkCode(e.target.value)}
                        placeholder="000000"
                        maxLength={6}
                        autoComplete="one-time-code"
                      />
                    </Field>
                  </DialogContent>
                  <DialogActions>
                    <DialogTrigger>
                      <Button appearance="secondary">Cancel</Button>
                    </DialogTrigger>
                    <DialogTrigger disableButtonEnhancement>
                      <Button
                        appearance="primary"
                        disabled={resetBkCode.length < 6}
                        onClick={handleResetBackupCodes}
                      >
                        Reset
                      </Button>
                    </DialogTrigger>
                  </DialogActions>
                </DialogBody>
              </DialogSurface>
            </Dialog>
          </div>
        )}

        {/* Remove authenticator dialog */}
        <Dialog
          open={!!removeId}
          onOpenChange={(_, s) => {
            if (!s.open) setRemoveId(null);
          }}
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Remove Authenticator</DialogTitle>
              <DialogContent>
                <Field label="Enter a TOTP code to confirm">
                  <Input
                    value={removeCode}
                    onChange={(e) => setRemoveCode(e.target.value)}
                    placeholder="000000"
                    maxLength={6}
                    autoComplete="one-time-code"
                  />
                </Field>
              </DialogContent>
              <DialogActions>
                <Button
                  appearance="secondary"
                  onClick={() => setRemoveId(null)}
                >
                  Cancel
                </Button>
                <Button
                  appearance="primary"
                  style={{ background: tokens.colorPaletteRedBackground3 }}
                  disabled={removeCode.length < 6}
                  onClick={handleRemoveTotp}
                >
                  Remove
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
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

        <>
          {(passkeysData?.passkeys.length ?? 0) > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell className={styles.hiddenOnMobile}>
                    Type
                  </TableHeaderCell>
                  <TableHeaderCell className={styles.hiddenOnMobile}>
                    Added
                  </TableHeaderCell>
                  <TableHeaderCell className={styles.hiddenOnMobile}>
                    Last used
                  </TableHeaderCell>
                  <TableHeaderCell className={styles.hiddenOnMobile} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {passkeysData!.passkeys.map((p) => (
                  <TableRow
                    key={p.id}
                    className={styles.row}
                    onClick={() => setSelectedPasskey(p)}
                  >
                    <TableCell>{p.name ?? "Passkey"}</TableCell>
                    <TableCell className={styles.hiddenOnMobile}>
                      {p.device_type}
                    </TableCell>
                    <TableCell className={styles.hiddenOnMobile}>
                      {new Date(p.created_at * 1000).toLocaleDateString()}
                    </TableCell>
                    <TableCell className={styles.hiddenOnMobile}>
                      {p.last_used_at
                        ? new Date(p.last_used_at * 1000).toLocaleDateString()
                        : "—"}
                    </TableCell>
                    <TableCell className={styles.hiddenOnMobile}>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Button
                          icon={<DeleteRegular />}
                          appearance="subtle"
                          onClick={() => handleDeletePasskey(p.id)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Passkey detail dialog (mobile) */}
          <Dialog
            open={!!selectedPasskey}
            onOpenChange={(_, s) => {
              if (!s.open) setSelectedPasskey(null);
            }}
          >
            <DialogSurface>
              <DialogBody>
                <DialogTitle>{selectedPasskey?.name ?? "Passkey"}</DialogTitle>
                <DialogContent>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                  >
                    <Text size={200}>
                      <strong>Type:</strong> {selectedPasskey?.device_type}
                    </Text>
                    <Text size={200}>
                      <strong>Added:</strong>{" "}
                      {selectedPasskey
                        ? new Date(
                            selectedPasskey.created_at * 1000,
                          ).toLocaleDateString()
                        : ""}
                    </Text>
                    <Text size={200}>
                      <strong>Last used:</strong>{" "}
                      {selectedPasskey?.last_used_at
                        ? new Date(
                            selectedPasskey.last_used_at * 1000,
                          ).toLocaleDateString()
                        : "—"}
                    </Text>
                  </div>
                </DialogContent>
                <DialogActions>
                  <Button onClick={() => setSelectedPasskey(null)}>
                    Close
                  </Button>
                  <Button
                    appearance="primary"
                    style={{ background: tokens.colorPaletteRedBackground3 }}
                    onClick={() => {
                      if (!selectedPasskey) return;
                      handleDeletePasskey(selectedPasskey.id);
                    }}
                  >
                    Delete
                  </Button>
                </DialogActions>
              </DialogBody>
            </DialogSurface>
          </Dialog>
        </>

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
        <>
          {(sessionsData?.sessions.length ?? 0) === 0 ? (
            <Text style={{ color: tokens.colorNeutralForeground3 }}>
              No active sessions
            </Text>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Device</TableHeaderCell>
                  <TableHeaderCell className={styles.hiddenOnMobile}>
                    IP
                  </TableHeaderCell>
                  <TableHeaderCell className={styles.hiddenOnMobile}>
                    Created
                  </TableHeaderCell>
                  <TableHeaderCell className={styles.hiddenOnMobile}>
                    Expires
                  </TableHeaderCell>
                  <TableHeaderCell className={styles.hiddenOnMobile} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessionsData!.sessions.map((s) => (
                  <TableRow
                    key={s.id}
                    className={styles.row}
                    onClick={() => setSelectedSession(s)}
                  >
                    <TableCell
                      style={{
                        maxWidth: 200,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {s.user_agent ?? "Unknown"}
                    </TableCell>
                    <TableCell className={styles.hiddenOnMobile}>
                      {s.ip_address ?? "—"}
                    </TableCell>
                    <TableCell className={styles.hiddenOnMobile}>
                      {new Date(s.created_at * 1000).toLocaleDateString()}
                    </TableCell>
                    <TableCell className={styles.hiddenOnMobile}>
                      {new Date(s.expires_at * 1000).toLocaleDateString()}
                    </TableCell>
                    <TableCell className={styles.hiddenOnMobile}>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Button
                          icon={<DeleteRegular />}
                          appearance="subtle"
                          onClick={() => handleRevokeSession(s.id)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Session detail dialog (mobile) */}
          <Dialog
            open={!!selectedSession}
            onOpenChange={(_, s) => {
              if (!s.open) setSelectedSession(null);
            }}
          >
            <DialogSurface>
              <DialogBody>
                <DialogTitle>Session</DialogTitle>
                <DialogContent>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                  >
                    <Text size={200}>
                      <strong>Device:</strong>{" "}
                      {selectedSession?.user_agent ?? "Unknown"}
                    </Text>
                    <Text size={200}>
                      <strong>IP:</strong> {selectedSession?.ip_address ?? "—"}
                    </Text>
                    <Text size={200}>
                      <strong>Created:</strong>{" "}
                      {selectedSession
                        ? new Date(
                            selectedSession.created_at * 1000,
                          ).toLocaleDateString()
                        : ""}
                    </Text>
                    <Text size={200}>
                      <strong>Expires:</strong>{" "}
                      {selectedSession
                        ? new Date(
                            selectedSession.expires_at * 1000,
                          ).toLocaleDateString()
                        : ""}
                    </Text>
                  </div>
                </DialogContent>
                <DialogActions>
                  <Button onClick={() => setSelectedSession(null)}>
                    Close
                  </Button>
                  <Button
                    appearance="primary"
                    style={{ background: tokens.colorPaletteRedBackground3 }}
                    onClick={() => {
                      if (!selectedSession) return;
                      handleRevokeSession(selectedSession.id);
                    }}
                  >
                    Revoke
                  </Button>
                </DialogActions>
              </DialogBody>
            </DialogSurface>
          </Dialog>
        </>
      </div>
    </div>
  );
}
