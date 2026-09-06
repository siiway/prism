// Security page: TOTP, Passkeys, Sessions

import { AccountRestrictionPanel } from "../components/AccountRestrictionPanel";

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
  Link as FluentLink,
  MessageBar,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Textarea,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  ArrowDownloadRegular,
  ArrowSyncRegular,
  CopyRegular,
  DeleteRegular,
  DesktopRegular,
  KeyRegular,
  SignOutRegular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { startRegistration } from "@simplewebauthn/browser";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import { ApiError } from "../lib/api";
import { useApi } from "../lib/api-context";
import type {
  GpgKeyInfo,
  PasskeyInfo,
  SessionInfo,
  SessionIpInfo,
} from "../lib/api";
import {
  formatIpGeo,
  formatNetwork,
  geoDetailRows,
  parseIpGeo,
} from "../lib/geo";
import { useAuthStore } from "../store/auth";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { SkeletonSecurityCard } from "../components/Skeletons";
import { DurationInput } from "../components/DurationInput";
import { LabeledLine } from "../components/LabeledLine";
import { useToastMessage } from "../lib/useToastMessage";

// Turn a raw User-Agent string into a friendly "Browser on OS" label for
// the sessions table. Returns null when the UA is empty/unparseable so the
// caller can fall back to the localized "unknown" string.
function describeDevice(userAgent: string | null): string | null {
  if (!userAgent) return null;
  let browser = "";
  if (/Edg\//.test(userAgent)) browser = "Edge";
  else if (/OPR\//.test(userAgent) || /Opera\//.test(userAgent))
    browser = "Opera";
  else if (/Firefox\//.test(userAgent)) browser = "Firefox";
  else if (/Chrome\//.test(userAgent)) browser = "Chrome";
  else if (/Safari\//.test(userAgent)) browser = "Safari";

  let os = "";
  if (/Windows NT 10/.test(userAgent)) os = "Windows";
  else if (/Windows NT/.test(userAgent)) os = "Windows";
  else if (/iPhone|iPad|iPod/.test(userAgent)) os = "iOS";
  else if (/Mac OS X/.test(userAgent)) os = "macOS";
  else if (/Android/.test(userAgent)) os = "Android";
  else if (/Linux/.test(userAgent)) os = "Linux";

  if (browser && os) return `${browser} on ${os}`;
  return browser || os || userAgent;
}

// Absolute date+time down to the minute (issue #6). The stored timestamps are
// already second-resolution; the old view only rendered the date, which is
// why two sessions minutes apart looked identical.
function formatDateTime(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Longest IPv6 addresses overflow the cell and collide with the next column
// (issue #1). We render them in a fixed-width box that ellipsises the overflow
// and show the full value on hover / focus via a Tooltip.
const IP_CELL_MAX_WIDTH = 150;

const useStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: "20px" },
  card: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "10px",
    padding: "18px",
    background: tokens.colorNeutralBackground1,
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  actions: { display: "flex", gap: "8px" },
  tableScroll: { overflowX: "auto" },
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
    borderRadius: "6px",
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
  ipCell: {
    display: "inline-block",
    maxWidth: `${IP_CELL_MAX_WIDTH}px`,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    verticalAlign: "middle",
    fontFamily: "monospace",
    fontSize: tokens.fontSizeBase200,
  },
  sessionsFooter: {
    display: "flex",
    justifyContent: "flex-end",
    marginTop: "4px",
  },
  ipHistoryList: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    maxHeight: "260px",
    overflowY: "auto",
  },
  ipHistoryItem: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "8px 10px",
    borderRadius: "6px",
    background: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  monoText: { fontFamily: "monospace", fontSize: tokens.fontSizeBase200 },
});

export function Security() {
  const api = useApi();
  const styles = useStyles();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { user } = useAuthStore();

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

  const { message, showMsg } = useToastMessage(6000);

  // ─── Token TTL prefs ─────────────────────────────────────────────────────
  const [accessTtl, setAccessTtl] = useState<number | null>(null);
  const [refreshTtl, setRefreshTtl] = useState<number | null>(null);
  const [savingTtl, setSavingTtl] = useState(false);

  // Sync server prefs into local draft. Expressed as a render-time set
  // (guarded by an identity ref) per React 19's set-state-in-effect rule.
  const [syncedTtlSource, setSyncedTtlSource] = useState<{
    a: number | null;
    r: number | null;
  } | null>(null);
  if (
    me?.user &&
    (syncedTtlSource === null ||
      syncedTtlSource.a !== me.user.access_token_ttl_minutes ||
      syncedTtlSource.r !== me.user.refresh_token_ttl_days)
  ) {
    setAccessTtl(me.user.access_token_ttl_minutes);
    setRefreshTtl(me.user.refresh_token_ttl_days);
    setSyncedTtlSource({
      a: me.user.access_token_ttl_minutes,
      r: me.user.refresh_token_ttl_days,
    });
  }

  const isValidTtl = (v: number | null): boolean =>
    v === null || (Number.isInteger(v) && v >= 1);

  const handleSaveTokenTtl = async () => {
    if (!isValidTtl(accessTtl) || !isValidTtl(refreshTtl)) {
      showMsg("error", t("security.tokenTtlInvalid"));
      return;
    }
    setSavingTtl(true);
    try {
      await api.updateMe({
        access_token_ttl_minutes: accessTtl,
        refresh_token_ttl_days: refreshTtl,
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
  // Render the QR client-side so the TOTP URI never leaves the browser.
  // (The previous implementation hit api.qrserver.com, which would have
  // received the otpauth URI — i.e. the shared secret — even when proxied.)
  const [totpQrSvg, setTotpQrSvg] = useState<string | null>(null);
  useEffect(() => {
    if (!totpSetup) return;
    let cancelled = false;
    QRCode.toString(totpSetup.uri, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 200,
    }).then((svg) => {
      if (!cancelled) setTotpQrSvg(svg);
    });
    return () => {
      cancelled = true;
    };
  }, [totpSetup]);
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
      const res = await api.totpSetup(totpName.trim() || undefined);
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
      await api.passkeyRegFinish(response, passkeyName.trim() || undefined);
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
  const [gpgRequire2faSaving, setGpgRequire2faSaving] = useState(false);

  const handleToggleGpgRequire2fa = async (checked: boolean) => {
    setGpgRequire2faSaving(true);
    try {
      await api.updateMe({ gpg_require_2fa: checked });
      await qc.invalidateQueries({ queryKey: ["me"] });
      showMsg(
        "success",
        checked
          ? t("security.gpgRequire2faEnabled")
          : t("security.gpgRequire2faDisabled"),
      );
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError
          ? err.message
          : t("security.gpgRequire2faSaveFailed"),
      );
    } finally {
      setGpgRequire2faSaving(false);
    }
  };

  const handleAddGpgKey = async () => {
    setGpgLoading(true);
    try {
      const res = await api.addGpgKey(
        gpgKeyText,
        gpgKeyName.trim() || undefined,
      );
      setGpgKeyText("");
      setGpgKeyName("");
      await refetchGpg();
      const parts = [
        res.added > 1
          ? t("security.gpgKeysAdded", { count: res.added })
          : t("security.gpgKeyAdded"),
      ];
      if (res.skipped > 0) {
        parts.push(t("security.gpgKeysSkipped", { count: res.skipped }));
      }
      showMsg("success", parts.join(" "));
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
  const [revokeAllOpen, setRevokeAllOpen] = useState(false);
  const [revokingAll, setRevokingAll] = useState(false);

  // IP history for the session whose detail dialog is open. Fetched lazily so
  // the sessions list itself stays a single cheap query.
  const { data: sessionIpsData, isLoading: sessionIpsLoading } = useQuery({
    queryKey: ["session-ips", selectedSession?.id],
    queryFn: () => api.listSessionIps(selectedSession!.id),
    enabled: !!selectedSession,
  });

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

  const handleRevokeAllSessions = async () => {
    setRevokingAll(true);
    try {
      const res = await api.revokeAllOtherSessions();
      setRevokeAllOpen(false);
      setSelectedSession(null);
      await refetchSessions();
      showMsg(
        "success",
        t("security.sessionsRevokedCount", { n: res.revoked }),
      );
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError
          ? err.message
          : t("security.failedRevokeSession"),
      );
    } finally {
      setRevokingAll(false);
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
      <PageHeader title={t("security.title")} style={{ marginBottom: 0 }} />

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
            <div className={styles.tableScroll}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>
                      {t("security.nameHeader")}
                    </TableHeaderCell>
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
            </div>
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
                  <LabeledLine label={t("security.added")}>
                    {selectedTotp
                      ? new Date(
                          selectedTotp.created_at * 1000,
                        ).toLocaleDateString()
                      : ""}
                  </LabeledLine>
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
            {totpQrSvg && (
              <div
                role="img"
                aria-label="TOTP QR Code"
                style={{
                  width: 200,
                  height: 200,
                  borderRadius: 8,
                  background: "white",
                  padding: 8,
                  boxSizing: "border-box",
                }}
                // Generated locally by the qrcode library — no untrusted
                // markup, so safe to drop straight into the DOM.
                dangerouslySetInnerHTML={{ __html: totpQrSvg }}
              />
            )}
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
            <div className={styles.tableScroll}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>
                      {t("security.nameHeader")}
                    </TableHeaderCell>
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
            </div>
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
                    <LabeledLine label={t("security.typeHeader")}>
                      {selectedPasskey?.device_type}
                    </LabeledLine>
                    <LabeledLine label={t("security.added")}>
                      {selectedPasskey
                        ? new Date(
                            selectedPasskey.created_at * 1000,
                          ).toLocaleDateString()
                        : ""}
                    </LabeledLine>
                    <LabeledLine label={t("security.lastUsedHeader")}>
                      {selectedPasskey?.last_used_at
                        ? new Date(
                            selectedPasskey.last_used_at * 1000,
                          ).toLocaleDateString()
                        : "—"}
                    </LabeledLine>
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
            {(gpgData?.keys.length ?? 0) > 0 && user?.username && (
              <Text
                size={200}
                block
                style={{ color: tokens.colorNeutralForeground3 }}
              >
                <FluentLink
                  href={`/users/${encodeURIComponent(user.username)}.gpg`}
                  target="_blank"
                  rel="noopener"
                >
                  {t("publicProfile.gpgKeysDownload")}
                </FluentLink>
                {" · "}
                <span style={{ fontFamily: "monospace" }}>
                  /users/{user.username}.gpg
                </span>
              </Text>
            )}
          </div>
        </div>

        {(gpgData?.keys.length ?? 0) > 0 && (
          <div className={styles.tableScroll}>
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
                      <Text font="monospace" size={200}>
                        {k.fingerprint.slice(-16).toUpperCase()}
                      </Text>
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
          </div>
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
                  <LabeledLine label={t("security.gpgFingerprintHeader")} mono>
                    {selectedGpg?.fingerprint.toUpperCase()}
                  </LabeledLine>
                  <LabeledLine label={t("security.added")}>
                    {selectedGpg
                      ? new Date(
                          selectedGpg.created_at * 1000,
                        ).toLocaleDateString()
                      : ""}
                  </LabeledLine>
                  <LabeledLine label={t("security.lastUsedHeader")}>
                    {selectedGpg?.last_used_at
                      ? new Date(
                          selectedGpg.last_used_at * 1000,
                        ).toLocaleDateString()
                      : "—"}
                  </LabeledLine>
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

        {/* Per-account: whether gpg-login should still walk the TOTP gate.
            Only meaningful when the account has an enrolled authenticator,
            but the switch is always visible so users can pre-configure it
            before enabling TOTP. */}
        <Field
          label={t("security.gpgRequire2faLabel")}
          hint={t("security.gpgRequire2faHint")}
        >
          <Switch
            checked={me?.user.gpg_require_2fa ?? true}
            disabled={gpgRequire2faSaving || !me?.user}
            onChange={(_, d) => handleToggleGpgRequire2fa(d.checked)}
            label={
              (me?.user.gpg_require_2fa ?? true)
                ? t("security.gpgRequire2faOn")
                : t("security.gpgRequire2faOff")
            }
          />
        </Field>

        {/* Add new GPG key */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Field label={t("security.gpgKeyName")}>
            <Input
              value={gpgKeyName}
              onChange={(e) => setGpgKeyName(e.target.value)}
              placeholder={t("security.gpgKeyNamePlaceholder")}
            />
          </Field>
          <Field
            label={t("security.gpgPublicKey")}
            hint={t("security.gpgMultiKeyHint")}
          >
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
            <EmptyState
              icon={<DesktopRegular />}
              title={t("security.noActiveSessions")}
            />
          ) : (
            <div className={styles.tableScroll}>
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
                      {t("security.locationHeader")}
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
                  {sessionsData!.sessions.map((s) => {
                    const device =
                      describeDevice(s.user_agent) ?? t("security.unknown");
                    const location = formatIpGeo(s.ip_geo);
                    return (
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
                            {/* Hover reveals the full User-Agent — the
                                "Firefox on Linux" label alone is too vague to
                                tell two of your own devices apart (issue #2). */}
                            <Tooltip
                              content={s.user_agent ?? t("security.unknown")}
                              relationship="label"
                            >
                              <span>{device}</span>
                            </Tooltip>
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
                          {s.ip_address ? (
                            <Tooltip
                              content={s.ip_address}
                              relationship="label"
                            >
                              <span className={styles.ipCell}>
                                {s.ip_address}
                              </span>
                            </Tooltip>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className={styles.hiddenOnMobile}>
                          {location || "—"}
                        </TableCell>
                        <TableCell className={styles.hiddenOnMobile}>
                          {formatDateTime(s.created_at)}
                        </TableCell>
                        <TableCell className={styles.hiddenOnMobile}>
                          {formatDateTime(s.expires_at)}
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
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Revoke-all: the panic button for "sign me out everywhere else".
              Kept out of the empty state (nothing to revoke) and disabled while
              only the current session exists. */}
          {(sessionsData?.sessions.length ?? 0) > 1 && (
            <div className={styles.sessionsFooter}>
              <Button
                appearance="primary"
                icon={<SignOutRegular />}
                style={{ background: tokens.colorPaletteRedBackground3 }}
                onClick={() => setRevokeAllOpen(true)}
              >
                {t("security.revokeAllSessions")}
              </Button>
            </div>
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
                    <LabeledLine label={t("security.deviceLabel")}>
                      {describeDevice(selectedSession?.user_agent ?? null) ??
                        t("security.unknown")}
                    </LabeledLine>
                    {/* Full User-Agent, so an unfamiliar session can be
                        identified precisely (issue #2). */}
                    <LabeledLine label={t("security.userAgentLabel")}>
                      <span className={styles.monoText}>
                        {selectedSession?.user_agent ?? t("security.unknown")}
                      </span>
                    </LabeledLine>
                    <LabeledLine label={t("security.ipLabel")}>
                      <span className={styles.monoText}>
                        {selectedSession?.ip_address ?? "—"}
                      </span>
                    </LabeledLine>
                    <LabeledLine label={t("security.locationLabel")}>
                      {formatIpGeo(selectedSession?.ip_geo) || "—"}
                    </LabeledLine>
                    <LabeledLine label={t("security.createdLabel")}>
                      {selectedSession
                        ? formatDateTime(selectedSession.created_at)
                        : ""}
                    </LabeledLine>
                    <LabeledLine label={t("security.expiresLabel")}>
                      {selectedSession
                        ? formatDateTime(selectedSession.expires_at)
                        : ""}
                    </LabeledLine>

                    {/* Everything Cloudflare told us about the session's IP —
                        continent, timezone, colo, ASN, coordinates, … — so an
                        unfamiliar session can be scrutinised fully. Hidden when
                        no geolocation was captured (local dev / non-CF). */}
                    {(() => {
                      const rows = geoDetailRows(
                        parseIpGeo(selectedSession?.ip_geo),
                        (k) => t(k),
                      );
                      if (rows.length === 0) return null;
                      return (
                        <>
                          <Text
                            weight="semibold"
                            size={300}
                            style={{ marginTop: 6 }}
                          >
                            {t("security.ipDetailsTitle")}
                          </Text>
                          {rows.map((r) => (
                            <LabeledLine key={r.label} label={r.label}>
                              {r.value}
                            </LabeledLine>
                          ))}
                        </>
                      );
                    })()}

                    {/* Every IP this session has been used from, most recent
                        first — each with its location, network and last-seen
                        time (issue #5). */}
                    <Text weight="semibold" size={300} style={{ marginTop: 6 }}>
                      {t("security.ipHistoryTitle")}
                    </Text>
                    {sessionIpsLoading ? (
                      <Spinner size="tiny" />
                    ) : (sessionIpsData?.ips.length ?? 0) === 0 ? (
                      <Text
                        size={200}
                        style={{ color: tokens.colorNeutralForeground3 }}
                      >
                        {t("security.ipHistoryEmpty")}
                      </Text>
                    ) : (
                      <div className={styles.ipHistoryList}>
                        {sessionIpsData!.ips.map((ip: SessionIpInfo) => {
                          const g = parseIpGeo(ip.geo);
                          const loc = formatIpGeo(ip.geo);
                          const net = formatNetwork(g?.asn, g?.org);
                          return (
                            <div
                              key={ip.ip_address}
                              className={styles.ipHistoryItem}
                            >
                              <span className={styles.monoText}>
                                {ip.ip_address}
                              </span>
                              <Text
                                size={200}
                                style={{
                                  color: tokens.colorNeutralForeground2,
                                }}
                              >
                                {loc || t("security.unknownLocation")}
                              </Text>
                              {net && (
                                <Text
                                  size={200}
                                  style={{
                                    color: tokens.colorNeutralForeground3,
                                  }}
                                >
                                  {net}
                                </Text>
                              )}
                              <Text
                                size={200}
                                style={{
                                  color: tokens.colorNeutralForeground3,
                                }}
                              >
                                {t("security.lastSeenLabel", {
                                  time: formatDateTime(ip.last_seen),
                                })}
                              </Text>
                            </div>
                          );
                        })}
                      </div>
                    )}
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

          {/* Revoke-all confirmation */}
          <Dialog
            open={revokeAllOpen}
            onOpenChange={(_, s) => {
              if (!s.open) setRevokeAllOpen(false);
            }}
          >
            <DialogSurface>
              <DialogBody>
                <DialogTitle>{t("security.revokeAllSessions")}</DialogTitle>
                <DialogContent>{t("security.revokeAllConfirm")}</DialogContent>
                <DialogActions>
                  <Button
                    disabled={revokingAll}
                    onClick={() => setRevokeAllOpen(false)}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    appearance="primary"
                    disabled={revokingAll}
                    style={{ background: tokens.colorPaletteRedBackground3 }}
                    onClick={handleRevokeAllSessions}
                  >
                    {revokingAll ? (
                      <Spinner size="tiny" />
                    ) : (
                      t("security.revokeAllSessions")
                    )}
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
          <DurationInput
            value={accessTtl}
            unit="minutes"
            onChange={setAccessTtl}
            placeholder={t("security.tokenTtlPlaceholder", {
              value: `${me?.site_access_token_ttl_minutes ?? 60} min`,
            })}
          />
        </Field>
        <Field
          label={t("security.refreshTokenTtlLabel")}
          hint={t("security.refreshTokenTtlHint", {
            siteDefault: me?.site_refresh_token_ttl_days ?? 30,
          })}
        >
          <DurationInput
            value={refreshTtl}
            unit="days"
            onChange={setRefreshTtl}
            placeholder={t("security.tokenTtlPlaceholder", {
              value: `${me?.site_refresh_token_ttl_days ?? 30} days`,
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
              setAccessTtl(null);
              setRefreshTtl(null);
            }}
          >
            {t("security.tokenTtlUseSiteDefault")}
          </Button>
        </div>
      </div>

      {/* Renders nothing for ordinary accounts. */}
      <AccountRestrictionPanel />
    </div>
  );
}
