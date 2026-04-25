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
  Textarea,
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
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { startRegistration } from "@simplewebauthn/browser";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../lib/api";
import type { GpgKeyInfo, PasskeyInfo, SessionInfo } from "../lib/api";
import { SkeletonSecurityCard } from "../components/Skeletons";

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
    "@media (max-width: 600px)": {
      gridTemplateColumns: "1fr",
    },
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
  const { t } = useTranslation();

  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
  });
  const {
    data: totpData,
    refetch: refetchTotp,
    isLoading: totpQueryLoading,
  } = useQuery({
    queryKey: ["totp-list"],
    queryFn: api.totpList,
  });
  const {
    data: passkeysData,
    refetch: refetchPasskeys,
    isLoading: passkeysLoading,
  } = useQuery({
    queryKey: ["passkeys"],
    queryFn: api.listPasskeys,
  });
  const {
    data: gpgData,
    refetch: refetchGpg,
    isLoading: gpgQueryLoading,
  } = useQuery({
    queryKey: ["gpg-keys"],
    queryFn: api.listGpgKeys,
  });
  const {
    data: sessionsData,
    refetch: refetchSessions,
    isLoading: sessionsLoading,
  } = useQuery({
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

  // ─── Token TTL prefs ─────────────────────────────────────────────────────
  const [accessTtlInput, setAccessTtlInput] = useState("");
  const [refreshTtlInput, setRefreshTtlInput] = useState("");
  const [savingTtl, setSavingTtl] = useState(false);

  useEffect(() => {
    if (!me?.user) return;
    setAccessTtlInput(me.user.access_token_ttl_minutes?.toString() ?? "");
    setRefreshTtlInput(me.user.refresh_token_ttl_days?.toString() ?? "");
  }, [
    me?.user.access_token_ttl_minutes,
    me?.user.refresh_token_ttl_days,
    me?.user,
  ]);

  const parseTtlInput = (v: string): number | null | "invalid" => {
    const trimmed = v.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 1) return "invalid";
    return n;
  };

  const handleSaveTokenTtl = async () => {
    const access = parseTtlInput(accessTtlInput);
    const refresh = parseTtlInput(refreshTtlInput);
    if (access === "invalid" || refresh === "invalid") {
      showMsg("error", t("security.tokenTtlInvalid"));
      return;
    }
    setSavingTtl(true);
    try {
      await api.updateMe({
        access_token_ttl_minutes: access,
        refresh_token_ttl_days: refresh,
      });
      await qc.invalidateQueries({ queryKey: ["me"] });
      showMsg("success", t("security.tokenTtlSaved"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError
          ? err.message
          : t("security.tokenTtlSaveFailed"),
      );
    } finally {
      setSavingTtl(false);
    }
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
        err instanceof ApiError ? err.message : t("security.failedSetupTotp"),
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
      showMsg("success", t("security.authenticatorAdded"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("security.invalidCode"),
      );
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
      showMsg("success", t("security.authenticatorRemoved"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("security.invalidCode"),
      );
    }
  };

  const handleResetBackupCodes = async () => {
    try {
      const res = await api.totpNewBackupCodes(resetBkCode);
      setBackupCodes(res.backup_codes);
      setResetBkCode("");
      await refetchTotp();
      showMsg("success", t("security.backupCodesRegenerated"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("security.invalidCode"),
      );
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
      showMsg("success", t("security.passkeyRegistered"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError
          ? err.message
          : t("security.passkeyRegistrationFailed"),
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
      showMsg("success", t("security.passkeyRemoved"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError
          ? err.message
          : t("security.failedRemovePasskey"),
      );
    }
  };

  // ─── GPG keys ────────────────────────────────────────────────────────────
  const [gpgKeyText, setGpgKeyText] = useState("");
  const [gpgKeyName, setGpgKeyName] = useState("");
  const [gpgLoading, setGpgLoading] = useState(false);
  const [selectedGpg, setSelectedGpg] = useState<GpgKeyInfo | null>(null);

  const handleAddGpgKey = async () => {
    setGpgLoading(true);
    try {
      await api.addGpgKey(gpgKeyText, gpgKeyName || undefined);
      setGpgKeyText("");
      setGpgKeyName("");
      await refetchGpg();
      showMsg("success", t("security.gpgKeyAdded"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("security.gpgKeyAddFailed"),
      );
    } finally {
      setGpgLoading(false);
    }
  };

  const handleDeleteGpgKey = async (id: string) => {
    try {
      await api.deleteGpgKey(id);
      setSelectedGpg(null);
      await refetchGpg();
      showMsg("success", t("security.gpgKeyRemoved"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError
          ? err.message
          : t("security.gpgKeyRemoveFailed"),
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
      showMsg("success", t("security.sessionRevoked"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError
          ? err.message
          : t("security.failedRevokeSession"),
      );
    }
  };

  const backupCodesRemaining = totpData?.backup_codes_remaining ?? 0;
  const isPageLoading =
    meLoading ||
    totpQueryLoading ||
    passkeysLoading ||
    gpgQueryLoading ||
    sessionsLoading;

  return (
    <div className={styles.page}>
      <Title2>{t("security.title")}</Title2>

      {message && (
        <MessageBar intent={message.type === "success" ? "success" : "error"}>
          {message.text}
        </MessageBar>
      )}

      {isPageLoading && (
        <>
          <SkeletonSecurityCard rows={2} />
          <SkeletonSecurityCard rows={3} />
          <SkeletonSecurityCard rows={2} />
          <SkeletonSecurityCard rows={4} />
        </>
      )}

      {/* TOTP */}
      <div
        className={styles.card}
        style={isPageLoading ? { display: "none" } : {}}
      >
        <div className={styles.cardHeader}>
          <div>
            <Text weight="semibold" size={400} block>
              {t("security.totpTitle")}
            </Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {t("security.totpDesc")}
            </Text>
          </div>
          <Badge
            color={me?.totp_enabled ? "success" : "subtle"}
            appearance="filled"
          >
            {me?.totp_enabled ? t("security.enabled") : t("security.disabled")}
          </Badge>
        </div>

        {/* Authenticator list */}
        <>
          {(totpData?.authenticators.filter((a) => a.enabled).length ?? 0) >
            0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>{t("security.nameHeader")}</TableHeaderCell>
                  <TableHeaderCell className={styles.hiddenOnMobile}>
                    {t("security.addedHeader")}
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
                    <strong>{t("security.added")}:</strong>{" "}
                    {selectedTotp
                      ? new Date(
                          selectedTotp.created_at * 1000,
                        ).toLocaleDateString()
                      : ""}
                  </Text>
                </DialogContent>
                <DialogActions>
                  <Button onClick={() => setSelectedTotp(null)}>
                    {t("common.close")}
                  </Button>
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
                    {t("common.remove")}
                  </Button>
                </DialogActions>
              </DialogBody>
            </DialogSurface>
          </Dialog>
        </>

        {/* Add authenticator flow */}
        {!totpSetup && (
          <div className={styles.actions}>
            <Field label={t("security.nameOptional")} style={{ flex: 1 }}>
              <Input
                value={totpName}
                onChange={(e) => setTotpName(e.target.value)}
                placeholder={t("security.namePlaceholder")}
              />
            </Field>
            <Button
              appearance="primary"
              icon={<AddRegular />}
              onClick={handleSetupTotp}
              disabled={totpLoading}
              style={{ alignSelf: "flex-end" }}
            >
              {totpLoading ? (
                <Spinner size="tiny" />
              ) : (
                t("security.addAuthenticator")
              )}
            </Button>
          </div>
        )}

        {totpSetup && (
          <div className={styles.qrSection}>
            <Text>{t("security.scanQrCode")}</Text>
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
              label={t("security.enterCode")}
              style={{ width: "100%", maxWidth: 260 }}
            >
              <Input
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                placeholder={t("security.codePlaceholder")}
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
                {totpLoading ? (
                  <Spinner size="tiny" />
                ) : (
                  t("security.verifyEnable")
                )}
              </Button>
              <Button onClick={() => setTotpSetup(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        )}

        {/* Backup codes display after enabling or reset */}
        {backupCodes && (
          <div>
            <Text weight="semibold" block>
              {t("security.saveBackupCodes")}
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
                {t("common.copy")}
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
                {t("common.download")}
              </Button>
              <Button size="small" onClick={() => setBackupCodes(null)}>
                {t("common.done")}
              </Button>
            </div>
          </div>
        )}

        {/* Backup codes status + reset */}
        {me?.totp_enabled && !backupCodes && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {backupCodesRemaining === 1
                ? t("security.backupCodesRemaining", {
                    count: backupCodesRemaining,
                  })
                : t("security.backupCodesRemainingPlural", {
                    count: backupCodesRemaining,
                  })}
            </Text>
            <Dialog>
              <DialogTrigger disableButtonEnhancement>
                <Button size="small" icon={<ArrowSyncRegular />}>
                  {t("security.resetBackupCodes")}
                </Button>
              </DialogTrigger>
              <DialogSurface>
                <DialogBody>
                  <DialogTitle>
                    {t("security.resetBackupCodesTitle")}
                  </DialogTitle>
                  <DialogContent>
                    <Field label={t("security.enterTotpToConfirm")}>
                      <Input
                        value={resetBkCode}
                        onChange={(e) => setResetBkCode(e.target.value)}
                        placeholder={t("security.codePlaceholder")}
                        maxLength={6}
                        autoComplete="one-time-code"
                      />
                    </Field>
                  </DialogContent>
                  <DialogActions>
                    <DialogTrigger>
                      <Button appearance="secondary">
                        {t("common.cancel")}
                      </Button>
                    </DialogTrigger>
                    <DialogTrigger disableButtonEnhancement>
                      <Button
                        appearance="primary"
                        disabled={resetBkCode.length < 6}
                        onClick={handleResetBackupCodes}
                      >
                        {t("security.resetBackupCodes")}
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
              <DialogTitle>{t("security.removeAuthenticator")}</DialogTitle>
              <DialogContent>
                <Field label={t("security.enterTotpToConfirm")}>
                  <Input
                    value={removeCode}
                    onChange={(e) => setRemoveCode(e.target.value)}
                    placeholder={t("security.codePlaceholder")}
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
                  {t("common.cancel")}
                </Button>
                <Button
                  appearance="primary"
                  style={{ background: tokens.colorPaletteRedBackground3 }}
                  disabled={removeCode.length < 6}
                  onClick={handleRemoveTotp}
                >
                  {t("common.remove")}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      </div>

      {/* Passkeys */}
      <div
        className={styles.card}
        style={isPageLoading ? { display: "none" } : {}}
      >
        <div className={styles.cardHeader}>
          <div>
            <Text weight="semibold" size={400} block>
              {t("security.passkeysTitle")}
            </Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {t("security.passkeysDesc")}
            </Text>
          </div>
        </div>

        <>
          {(passkeysData?.passkeys.length ?? 0) > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>{t("security.nameHeader")}</TableHeaderCell>
                  <TableHeaderCell className={styles.hiddenOnMobile}>
                    {t("security.typeHeader")}
                  </TableHeaderCell>
                  <TableHeaderCell className={styles.hiddenOnMobile}>
                    {t("security.addedHeader")}
                  </TableHeaderCell>
                  <TableHeaderCell className={styles.hiddenOnMobile}>
                    {t("security.lastUsedHeader")}
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
                      <strong>{t("security.typeHeader")}:</strong>{" "}
                      {selectedPasskey?.device_type}
                    </Text>
                    <Text size={200}>
                      <strong>{t("security.added")}:</strong>{" "}
                      {selectedPasskey
                        ? new Date(
                            selectedPasskey.created_at * 1000,
                          ).toLocaleDateString()
                        : ""}
                    </Text>
                    <Text size={200}>
                      <strong>{t("security.lastUsedHeader")}:</strong>{" "}
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
                    {t("common.close")}
                  </Button>
                  <Button
                    appearance="primary"
                    style={{ background: tokens.colorPaletteRedBackground3 }}
                    onClick={() => {
                      if (!selectedPasskey) return;
                      handleDeletePasskey(selectedPasskey.id);
                    }}
                  >
                    {t("security.deletePasskey")}
                  </Button>
                </DialogActions>
              </DialogBody>
            </DialogSurface>
          </Dialog>
        </>

        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <Field label={t("security.passkeyNameOptional")} style={{ flex: 1 }}>
            <Input
              value={passkeyName}
              onChange={(e) => setPasskeyName(e.target.value)}
              placeholder={t("security.passkeyNamePlaceholder")}
            />
          </Field>
          <Button
            appearance="primary"
            icon={<KeyRegular />}
            onClick={handleAddPasskey}
            disabled={passkeyLoading}
          >
            {passkeyLoading ? (
              <Spinner size="tiny" />
            ) : (
              t("security.addPasskey")
            )}
          </Button>
        </div>
      </div>

      {/* GPG Keys */}
      <div
        className={styles.card}
        style={isPageLoading ? { display: "none" } : {}}
      >
        <div className={styles.cardHeader}>
          <div>
            <Text weight="semibold" size={400} block>
              {t("security.gpgKeysTitle")}
            </Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {t("security.gpgKeysDesc")}
            </Text>
          </div>
        </div>

        {(gpgData?.keys.length ?? 0) > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>{t("security.nameHeader")}</TableHeaderCell>
                <TableHeaderCell className={styles.hiddenOnMobile}>
                  {t("security.gpgFingerprintHeader")}
                </TableHeaderCell>
                <TableHeaderCell className={styles.hiddenOnMobile}>
                  {t("security.addedHeader")}
                </TableHeaderCell>
                <TableHeaderCell className={styles.hiddenOnMobile}>
                  {t("security.lastUsedHeader")}
                </TableHeaderCell>
                <TableHeaderCell className={styles.hiddenOnMobile} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {gpgData!.keys.map((k) => (
                <TableRow
                  key={k.id}
                  className={styles.row}
                  onClick={() => setSelectedGpg(k)}
                >
                  <TableCell>{k.name}</TableCell>
                  <TableCell className={styles.hiddenOnMobile}>
                    <span style={{ fontFamily: "monospace", fontSize: 12 }}>
                      {k.fingerprint.slice(-16).toUpperCase()}
                    </span>
                  </TableCell>
                  <TableCell className={styles.hiddenOnMobile}>
                    {new Date(k.created_at * 1000).toLocaleDateString()}
                  </TableCell>
                  <TableCell className={styles.hiddenOnMobile}>
                    {k.last_used_at
                      ? new Date(k.last_used_at * 1000).toLocaleDateString()
                      : "—"}
                  </TableCell>
                  <TableCell className={styles.hiddenOnMobile}>
                    <div onClick={(e) => e.stopPropagation()}>
                      <Button
                        icon={<DeleteRegular />}
                        appearance="subtle"
                        onClick={() => handleDeleteGpgKey(k.id)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* GPG key detail dialog (mobile) */}
        <Dialog
          open={!!selectedGpg}
          onOpenChange={(_, s) => {
            if (!s.open) setSelectedGpg(null);
          }}
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>{selectedGpg?.name}</DialogTitle>
              <DialogContent>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  <Text size={200}>
                    <strong>{t("security.gpgFingerprintHeader")}:</strong>{" "}
                    <span style={{ fontFamily: "monospace" }}>
                      {selectedGpg?.fingerprint.toUpperCase()}
                    </span>
                  </Text>
                  <Text size={200}>
                    <strong>{t("security.added")}:</strong>{" "}
                    {selectedGpg
                      ? new Date(
                          selectedGpg.created_at * 1000,
                        ).toLocaleDateString()
                      : ""}
                  </Text>
                  <Text size={200}>
                    <strong>{t("security.lastUsedHeader")}:</strong>{" "}
                    {selectedGpg?.last_used_at
                      ? new Date(
                          selectedGpg.last_used_at * 1000,
                        ).toLocaleDateString()
                      : "—"}
                  </Text>
                </div>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setSelectedGpg(null)}>
                  {t("common.close")}
                </Button>
                <Button
                  appearance="primary"
                  style={{ background: tokens.colorPaletteRedBackground3 }}
                  onClick={() => {
                    if (selectedGpg) handleDeleteGpgKey(selectedGpg.id);
                  }}
                >
                  {t("security.deleteGpgKey")}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>

        {/* Add new GPG key */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Field label={t("security.gpgKeyName")}>
            <Input
              value={gpgKeyName}
              onChange={(e) => setGpgKeyName(e.target.value)}
              placeholder={t("security.gpgKeyNamePlaceholder")}
            />
          </Field>
          <Field label={t("security.gpgPublicKey")}>
            <Textarea
              value={gpgKeyText}
              onChange={(e) => setGpgKeyText(e.target.value)}
              placeholder={t("security.gpgPublicKeyPlaceholder")}
              rows={6}
              style={{ fontFamily: "monospace", fontSize: 12 }}
            />
          </Field>
          <Button
            appearance="primary"
            icon={gpgLoading ? <Spinner size="tiny" /> : <KeyRegular />}
            disabled={gpgLoading || !gpgKeyText.trim()}
            onClick={handleAddGpgKey}
          >
            {t("security.addGpgKey")}
          </Button>
        </div>
      </div>

      {/* Sessions */}
      <div
        className={styles.card}
        style={isPageLoading ? { display: "none" } : {}}
      >
        <Text weight="semibold" size={400} block>
          {t("security.sessionsTitle")}
        </Text>
        <>
          {(sessionsData?.sessions.length ?? 0) === 0 ? (
            <Text style={{ color: tokens.colorNeutralForeground3 }}>
              {t("security.noActiveSessions")}
            </Text>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>
                    {t("security.deviceHeader")}
                  </TableHeaderCell>
                  <TableHeaderCell className={styles.hiddenOnMobile}>
                    {t("security.ipHeader")}
                  </TableHeaderCell>
                  <TableHeaderCell className={styles.hiddenOnMobile}>
                    {t("security.createdHeader")}
                  </TableHeaderCell>
                  <TableHeaderCell className={styles.hiddenOnMobile}>
                    {t("security.expiresHeader")}
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
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        {s.user_agent ?? t("security.unknown")}
                        {s.is_current && (
                          <Badge
                            color="informative"
                            appearance="filled"
                            size="small"
                          >
                            {t("security.currentSession")}
                          </Badge>
                        )}
                      </div>
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
                <DialogTitle>{t("security.sessionTitle")}</DialogTitle>
                <DialogContent>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                  >
                    <Text size={200}>
                      <strong>{t("security.deviceLabel")}:</strong>{" "}
                      {selectedSession?.user_agent ?? t("security.unknown")}
                    </Text>
                    <Text size={200}>
                      <strong>{t("security.ipLabel")}:</strong>{" "}
                      {selectedSession?.ip_address ?? "—"}
                    </Text>
                    <Text size={200}>
                      <strong>{t("security.createdLabel")}:</strong>{" "}
                      {selectedSession
                        ? new Date(
                            selectedSession.created_at * 1000,
                          ).toLocaleDateString()
                        : ""}
                    </Text>
                    <Text size={200}>
                      <strong>{t("security.expiresLabel")}:</strong>{" "}
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
                    {t("common.close")}
                  </Button>
                  <Button
                    appearance="primary"
                    style={{ background: tokens.colorPaletteRedBackground3 }}
                    onClick={() => {
                      if (!selectedSession) return;
                      handleRevokeSession(selectedSession.id);
                    }}
                  >
                    {t("security.revokeSession")}
                  </Button>
                </DialogActions>
              </DialogBody>
            </DialogSurface>
          </Dialog>
        </>
      </div>

      {/* Token TTL prefs */}
      <div
        className={styles.card}
        style={isPageLoading ? { display: "none" } : {}}
      >
        <div className={styles.cardHeader}>
          <div>
            <Text weight="semibold" size={400} block>
              {t("security.tokenTtlTitle")}
            </Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {t("security.tokenTtlDesc")}
            </Text>
          </div>
        </div>
        <Field
          label={t("security.accessTokenTtlLabel")}
          hint={t("security.accessTokenTtlHint", {
            siteDefault: me?.site_access_token_ttl_minutes ?? 60,
          })}
        >
          <Input
            type="number"
            min={1}
            value={accessTtlInput}
            onChange={(_, d) => setAccessTtlInput(d.value)}
            placeholder={t("security.tokenTtlPlaceholder", {
              value: me?.site_access_token_ttl_minutes ?? 60,
            })}
          />
        </Field>
        <Field
          label={t("security.refreshTokenTtlLabel")}
          hint={t("security.refreshTokenTtlHint", {
            siteDefault: me?.site_refresh_token_ttl_days ?? 30,
          })}
        >
          <Input
            type="number"
            min={1}
            value={refreshTtlInput}
            onChange={(_, d) => setRefreshTtlInput(d.value)}
            placeholder={t("security.tokenTtlPlaceholder", {
              value: me?.site_refresh_token_ttl_days ?? 30,
            })}
          />
        </Field>
        <div className={styles.actions}>
          <Button
            appearance="primary"
            disabled={savingTtl}
            onClick={handleSaveTokenTtl}
          >
            {savingTtl ? <Spinner size="tiny" /> : t("common.save")}
          </Button>
          <Button
            appearance="subtle"
            disabled={savingTtl}
            onClick={() => {
              setAccessTtlInput("");
              setRefreshTtlInput("");
            }}
          >
            {t("security.tokenTtlUseSiteDefault")}
          </Button>
        </div>
      </div>
    </div>
  );
}
