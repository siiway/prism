// Security page: password, two-factor authenticators, passkeys, GPG keys,
// active sessions and OAuth token preferences. Lists are rows with their
// details inline; adding anything opens a dialog from the card's action.

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
  Spinner,
  Switch,
  Text,
  Textarea,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  ArrowDownloadRegular,
  CopyRegular,
  DeleteRegular,
  DesktopRegular,
  KeyMultipleRegular,
  KeyRegular,
  PhoneRegular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { startRegistration } from "@simplewebauthn/browser";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import { ApiError } from "../lib/api";
import { useApi } from "../lib/api-context";
import type { SessionInfo, SessionIpInfo } from "../lib/api";
import {
  formatIpGeo,
  formatNetwork,
  geoDetailRows,
  parseIpGeo,
} from "../lib/geo";
import { formatDate } from "../lib/datetime";
import { useAuthStore } from "../store/auth";
import { PageHeader } from "../components/PageHeader";
import { PasswordInput } from "../components/PasswordInput";
import { SkeletonSecurityCard } from "../components/Skeletons";
import { DurationInput } from "../components/DurationInput";
import { LabeledLine } from "../components/LabeledLine";
import {
  SettingsBody,
  SettingsCard,
  SettingsEmpty,
  SettingsFooter,
  SettingsPage,
  SettingsRow,
  SettingsToast,
} from "../components/Settings";
import { useToastMessage } from "../lib/useToastMessage";
import { useConfirm } from "../lib/useConfirm";

// Turn a raw User-Agent string into a friendly "Browser on OS" label for
// the sessions list. Returns null when the UA is empty/unparseable so the
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

const isMobileUa = (ua: string | null) =>
  !!ua && /iPhone|iPad|iPod|Android/.test(ua);

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

const useStyles = makeStyles({
  formNarrow: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    maxWidth: "380px",
  },
  duration: { width: "220px", maxWidth: "100%" },
  mono: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
  // Long IPv6 addresses would push the rest of the line around (issue #1).
  ip: {
    display: "inline-block",
    maxWidth: "180px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    verticalAlign: "bottom",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
  qrSection: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    alignItems: "center",
  },
  qr: {
    width: "200px",
    height: "200px",
    borderRadius: tokens.borderRadiusLarge,
    background: "white",
    padding: "8px",
    boxSizing: "border-box",
  },
  secret: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    background: tokens.colorNeutralBackground3,
    padding: "4px 8px",
    borderRadius: tokens.borderRadiusMedium,
    wordBreak: "break-all",
  },
  codeField: { width: "100%", maxWidth: "260px" },
  backupCodes: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "8px",
    padding: "12px",
    background: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusMedium,
    fontFamily: tokens.fontFamilyMonospace,
    "@media (max-width: 600px)": {
      gridTemplateColumns: "1fr",
    },
  },
  dialogStack: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  danger: {
    background: tokens.colorPaletteRedBackground3,
    ":hover": { background: tokens.colorPaletteRedForeground1 },
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
    borderRadius: tokens.borderRadiusMedium,
    background: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  muted: { color: tokens.colorNeutralForeground3 },
  detailTitle: { marginTop: "6px" },
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
  const { confirm, confirmDialog } = useConfirm();
  const errorText = (err: unknown, fallbackKey: string) =>
    err instanceof ApiError ? err.message : t(fallbackKey);

  // ─── Password ────────────────────────────────────────────────────────────
  const [pwOpen, setPwOpen] = useState(false);
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [pwLoading, setPwLoading] = useState(false);

  const closePassword = () => {
    setPwOpen(false);
    setPwForm({ current: "", next: "", confirm: "" });
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwForm.next !== pwForm.confirm) {
      showMsg("error", t("profile.passwordMismatch"));
      return;
    }
    setPwLoading(true);
    try {
      await api.changePassword(pwForm.current, pwForm.next);
      closePassword();
      showMsg("success", t("profile.passwordChanged"));
    } catch (err) {
      showMsg("error", errorText(err, "profile.passwordChangeFailed"));
    } finally {
      setPwLoading(false);
    }
  };

  // ─── OAuth settings (Token TTL prefs & auto authorization notify) ───────
  const [accessTtl, setAccessTtl] = useState<number | null>(null);
  const [refreshTtl, setRefreshTtl] = useState<number | null>(null);
  const [notifyOnAutoAuth, setNotifyOnAutoAuth] = useState(false);
  const [savingOAuthSettings, setSavingOAuthSettings] = useState(false);

  // Sync server prefs into local draft. Expressed as a render-time set
  // (guarded by an identity ref) per React 19's set-state-in-effect rule.
  const [syncedOAuthSettingsSource, setSyncedOAuthSettingsSource] = useState<{
    a: number | null;
    r: number | null;
    n: boolean;
  } | null>(null);
  if (
    me?.user &&
    (syncedOAuthSettingsSource === null ||
      syncedOAuthSettingsSource.a !== me.user.access_token_ttl_minutes ||
      syncedOAuthSettingsSource.r !== me.user.refresh_token_ttl_days ||
      syncedOAuthSettingsSource.n !== me.user.notify_on_auto_authorization)
  ) {
    setAccessTtl(me.user.access_token_ttl_minutes);
    setRefreshTtl(me.user.refresh_token_ttl_days);
    setNotifyOnAutoAuth(me.user.notify_on_auto_authorization);
    setSyncedOAuthSettingsSource({
      a: me.user.access_token_ttl_minutes,
      r: me.user.refresh_token_ttl_days,
      n: me.user.notify_on_auto_authorization,
    });
  }
  const oauthDirty =
    !!syncedOAuthSettingsSource &&
    (accessTtl !== syncedOAuthSettingsSource.a ||
      refreshTtl !== syncedOAuthSettingsSource.r ||
      notifyOnAutoAuth !== syncedOAuthSettingsSource.n);

  const isValidTtl = (v: number | null): boolean =>
    v === null || (Number.isInteger(v) && v >= 1);

  const handleSaveOAuthSettings = async () => {
    if (!isValidTtl(accessTtl) || !isValidTtl(refreshTtl)) {
      showMsg("error", t("security.tokenTtlInvalid"));
      return;
    }
    setSavingOAuthSettings(true);
    try {
      await api.updateMe({
        access_token_ttl_minutes: accessTtl,
        refresh_token_ttl_days: refreshTtl,
        notify_on_auto_authorization: notifyOnAutoAuth,
      });
      await qc.invalidateQueries({ queryKey: ["me"] });
      showMsg("success", t("security.oauthSettingsSaved"));
    } catch (err) {
      showMsg("error", errorText(err, "security.oauthSettingsSaveFailed"));
    } finally {
      setSavingOAuthSettings(false);
    }
  };

  // ─── TOTP ────────────────────────────────────────────────────────────────
  const [totpOpen, setTotpOpen] = useState(false);
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
  const [resetOpen, setResetOpen] = useState(false);
  const [resetBkCode, setResetBkCode] = useState("");

  const closeTotp = () => {
    setTotpOpen(false);
    setTotpSetup(null);
    setTotpName("");
    setTotpCode("");
  };

  const handleSetupTotp = async () => {
    setTotpLoading(true);
    try {
      const res = await api.totpSetup(totpName.trim() || undefined);
      setTotpSetup(res);
      setTotpCode("");
    } catch (err) {
      showMsg("error", errorText(err, "security.failedSetupTotp"));
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
      closeTotp();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["me"] }),
        refetchTotp(),
      ]);
      showMsg("success", t("security.authenticatorAdded"));
    } catch (err) {
      showMsg("error", errorText(err, "security.invalidCode"));
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
      showMsg("error", errorText(err, "security.invalidCode"));
    }
  };

  const handleResetBackupCodes = async () => {
    try {
      const res = await api.totpNewBackupCodes(resetBkCode);
      setBackupCodes(res.backup_codes);
      setResetBkCode("");
      setResetOpen(false);
      await refetchTotp();
      showMsg("success", t("security.backupCodesRegenerated"));
    } catch (err) {
      showMsg("error", errorText(err, "security.invalidCode"));
    }
  };

  // ─── Passkeys ────────────────────────────────────────────────────────────
  const [passkeyOpen, setPasskeyOpen] = useState(false);
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
      await api.passkeyRegFinish(response, passkeyName.trim() || undefined);
      setPasskeyName("");
      setPasskeyOpen(false);
      await refetchPasskeys();
      showMsg("success", t("security.passkeyRegistered"));
    } catch (err) {
      showMsg("error", errorText(err, "security.passkeyRegistrationFailed"));
    } finally {
      setPasskeyLoading(false);
    }
  };

  const handleDeletePasskey = async (id: string) => {
    try {
      await api.deletePasskey(id);
      await refetchPasskeys();
      showMsg("success", t("security.passkeyRemoved"));
    } catch (err) {
      showMsg("error", errorText(err, "security.failedRemovePasskey"));
    }
  };

  // ─── GPG keys ────────────────────────────────────────────────────────────
  const [gpgOpen, setGpgOpen] = useState(false);
  const [gpgKeyText, setGpgKeyText] = useState("");
  const [gpgKeyName, setGpgKeyName] = useState("");
  const [gpgLoading, setGpgLoading] = useState(false);
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
      showMsg("error", errorText(err, "security.gpgRequire2faSaveFailed"));
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
      setGpgOpen(false);
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
      showMsg("error", errorText(err, "security.gpgKeyAddFailed"));
    } finally {
      setGpgLoading(false);
    }
  };

  const handleDeleteGpgKey = async (id: string) => {
    try {
      await api.deleteGpgKey(id);
      await refetchGpg();
      showMsg("success", t("security.gpgKeyRemoved"));
    } catch (err) {
      showMsg("error", errorText(err, "security.gpgKeyRemoveFailed"));
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
      showMsg("error", errorText(err, "security.failedRevokeSession"));
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
      showMsg("error", errorText(err, "security.failedRevokeSession"));
    } finally {
      setRevokingAll(false);
    }
  };

  const backupCodesRemaining = totpData?.backup_codes_remaining ?? 0;
  const authenticators = (totpData?.authenticators ?? []).filter(
    (a) => a.enabled,
  );
  const passkeys = passkeysData?.passkeys ?? [];
  const gpgKeys = gpgData?.keys ?? [];
  const sessions = sessionsData?.sessions ?? [];
  const isPageLoading =
    meLoading ||
    totpQueryLoading ||
    passkeysLoading ||
    gpgQueryLoading ||
    sessionsLoading;

  const usage = (created: number, lastUsed?: number | null) =>
    [
      t("security.addedOn", { date: formatDate(created) }),
      lastUsed
        ? t("security.lastUsedOn", { date: formatDate(lastUsed) })
        : t("security.neverUsed"),
    ].join(" · ");

  const removeButton = (label: string, onClick: () => void) => (
    <Tooltip content={label} relationship="label">
      <Button
        size="small"
        appearance="subtle"
        icon={<DeleteRegular />}
        onClick={onClick}
      />
    </Tooltip>
  );

  return (
    <SettingsPage>
      <PageHeader
        title={t("security.title")}
        subtitle={t("security.subtitle")}
        style={{ marginBottom: 4 }}
      />
      <SettingsToast message={message} />

      {isPageLoading ? (
        <>
          <SkeletonSecurityCard rows={2} />
          <SkeletonSecurityCard rows={3} />
          <SkeletonSecurityCard rows={2} />
          <SkeletonSecurityCard rows={4} />
        </>
      ) : (
        <>
          {/* ── Password ── */}
          <SettingsCard
            title={t("security.passwordTitle")}
            description={t("security.passwordDesc")}
            action={
              !pwOpen && (
                <Button size="small" onClick={() => setPwOpen(true)}>
                  {t("profile.changePassword")}
                </Button>
              )
            }
          >
            {pwOpen && (
              <form onSubmit={handlePasswordChange}>
                <SettingsBody>
                  <div className={styles.formNarrow}>
                    <Field label={t("profile.currentPassword")}>
                      <PasswordInput
                        autoFocus
                        autoComplete="current-password"
                        value={pwForm.current}
                        onChange={(e) =>
                          setPwForm((f) => ({ ...f, current: e.target.value }))
                        }
                      />
                    </Field>
                    <Field label={t("profile.newPassword")}>
                      <PasswordInput
                        autoComplete="new-password"
                        value={pwForm.next}
                        onChange={(e) =>
                          setPwForm((f) => ({ ...f, next: e.target.value }))
                        }
                        placeholder={t("profile.newPasswordPlaceholder")}
                      />
                    </Field>
                    <Field label={t("profile.confirmNewPassword")}>
                      <PasswordInput
                        autoComplete="new-password"
                        value={pwForm.confirm}
                        onChange={(e) =>
                          setPwForm((f) => ({ ...f, confirm: e.target.value }))
                        }
                        placeholder={t("profile.confirmNewPasswordPlaceholder")}
                      />
                    </Field>
                  </div>
                </SettingsBody>
                <SettingsFooter>
                  <Button type="button" onClick={closePassword}>
                    {t("common.cancel")}
                  </Button>
                  <Button
                    appearance="primary"
                    type="submit"
                    disabled={
                      pwLoading ||
                      !pwForm.current ||
                      !pwForm.next ||
                      !pwForm.confirm
                    }
                  >
                    {pwLoading ? (
                      <Spinner size="tiny" />
                    ) : (
                      t("profile.updatePassword")
                    )}
                  </Button>
                </SettingsFooter>
              </form>
            )}
          </SettingsCard>

          {/* ── Authenticator apps ── */}
          <SettingsCard
            title={t("security.totpTitle")}
            description={t("security.totpDesc")}
            badge={
              <Badge
                color={me?.totp_enabled ? "success" : "subtle"}
                appearance="tint"
                size="small"
              >
                {me?.totp_enabled
                  ? t("security.enabled")
                  : t("security.disabled")}
              </Badge>
            }
            action={
              <Button
                size="small"
                icon={<AddRegular />}
                onClick={() => setTotpOpen(true)}
              >
                {t("security.addAuthenticator")}
              </Button>
            }
          >
            {authenticators.length === 0 ? (
              <SettingsEmpty>{t("security.noAuthenticators")}</SettingsEmpty>
            ) : (
              authenticators.map((a) => (
                <SettingsRow
                  key={a.id}
                  icon={<PhoneRegular />}
                  label={a.name}
                  description={t("security.addedOn", {
                    date: formatDate(a.created_at),
                  })}
                >
                  {removeButton(t("security.removeAuthenticator"), () => {
                    setRemoveId(a.id);
                    setRemoveCode("");
                  })}
                </SettingsRow>
              ))
            )}
            {me?.totp_enabled && (
              <SettingsRow
                icon={<KeyMultipleRegular />}
                label={t("security.backupCodesTitle")}
                description={
                  backupCodesRemaining === 1
                    ? t("security.backupCodesRemaining", {
                        count: backupCodesRemaining,
                      })
                    : t("security.backupCodesRemainingPlural", {
                        count: backupCodesRemaining,
                      })
                }
              >
                <Button size="small" onClick={() => setResetOpen(true)}>
                  {t("security.resetBackupCodes")}
                </Button>
              </SettingsRow>
            )}
          </SettingsCard>

          {/* ── Passkeys ── */}
          <SettingsCard
            title={t("security.passkeysTitle")}
            description={t("security.passkeysDesc")}
            action={
              <Button
                size="small"
                icon={<AddRegular />}
                onClick={() => setPasskeyOpen(true)}
              >
                {t("security.addPasskey")}
              </Button>
            }
          >
            {passkeys.length === 0 ? (
              <SettingsEmpty>{t("security.noPasskeys")}</SettingsEmpty>
            ) : (
              passkeys.map((p) => (
                <SettingsRow
                  key={p.id}
                  icon={<KeyRegular />}
                  label={p.name ?? t("security.passkeysTitle")}
                  description={usage(p.created_at, p.last_used_at)}
                >
                  {removeButton(t("security.deletePasskey"), async () => {
                    const ok = await confirm({
                      title: t("security.removePasskeyTitle"),
                      body: t("security.removePasskeyBody", {
                        name: p.name ?? t("security.passkeysTitle"),
                      }),
                      confirmLabel: t("common.remove"),
                    });
                    if (ok) void handleDeletePasskey(p.id);
                  })}
                </SettingsRow>
              ))
            )}
          </SettingsCard>

          {/* ── GPG keys ── */}
          <SettingsCard
            title={t("security.gpgKeysTitle")}
            description={
              <>
                {t("security.gpgKeysDesc")}
                {gpgKeys.length > 0 && user?.username && (
                  <>
                    {" "}
                    <FluentLink
                      href={`/users/${encodeURIComponent(user.username)}.gpg`}
                      target="_blank"
                      rel="noopener"
                    >
                      {t("publicProfile.gpgKeysDownload")}
                    </FluentLink>
                  </>
                )}
              </>
            }
            action={
              <Button
                size="small"
                icon={<AddRegular />}
                onClick={() => setGpgOpen(true)}
              >
                {t("security.addGpgKey")}
              </Button>
            }
          >
            {gpgKeys.length === 0 ? (
              <SettingsEmpty>{t("security.noGpgKeys")}</SettingsEmpty>
            ) : (
              gpgKeys.map((k) => (
                <SettingsRow
                  key={k.id}
                  icon={<KeyRegular />}
                  label={k.name}
                  description={
                    <>
                      <span
                        className={styles.mono}
                        title={k.fingerprint.toUpperCase()}
                      >
                        {k.fingerprint.slice(-16).toUpperCase()}
                      </span>
                      {" · "}
                      {usage(k.created_at, k.last_used_at)}
                    </>
                  }
                >
                  {removeButton(t("security.deleteGpgKey"), async () => {
                    const ok = await confirm({
                      title: t("security.removeGpgKeyTitle"),
                      body: t("security.removeGpgKeyBody", { name: k.name }),
                      confirmLabel: t("common.remove"),
                    });
                    if (ok) void handleDeleteGpgKey(k.id);
                  })}
                </SettingsRow>
              ))
            )}
            {/* Whether GPG sign-in still walks the TOTP gate. Always shown so
                it can be set before an authenticator is enrolled. */}
            <SettingsRow
              label={t("security.gpgRequire2faLabel")}
              description={t("security.gpgRequire2faHint")}
            >
              <Switch
                aria-label={t("security.gpgRequire2faLabel")}
                checked={me?.user.gpg_require_2fa ?? true}
                disabled={gpgRequire2faSaving || !me?.user}
                onChange={(_, d) => handleToggleGpgRequire2fa(d.checked)}
              />
            </SettingsRow>
          </SettingsCard>

          {/* ── Sessions ── */}
          <SettingsCard
            title={t("security.sessionsTitle")}
            description={t("security.sessionsDesc")}
            action={
              sessions.length > 1 && (
                <Button size="small" onClick={() => setRevokeAllOpen(true)}>
                  {t("security.revokeAllSessions")}
                </Button>
              )
            }
          >
            {sessions.length === 0 ? (
              <SettingsEmpty>{t("security.noActiveSessions")}</SettingsEmpty>
            ) : (
              sessions.map((s) => {
                const device =
                  describeDevice(s.user_agent) ?? t("security.unknown");
                const location = formatIpGeo(s.ip_geo);
                return (
                  <SettingsRow
                    key={s.id}
                    icon={
                      isMobileUa(s.user_agent) ? (
                        <PhoneRegular />
                      ) : (
                        <DesktopRegular />
                      )
                    }
                    label={
                      <>
                        {/* Hover reveals the full User-Agent — the label alone
                            can't tell two of your own devices apart (issue #2).
                            A plain title, not a Tooltip: a description
                            Tooltip portals its content and breaks hydration. */}
                        <span title={s.user_agent ?? undefined}>{device}</span>
                        {s.is_current && (
                          <Badge color="brand" appearance="tint" size="small">
                            {t("security.currentSession")}
                          </Badge>
                        )}
                      </>
                    }
                    description={
                      <>
                        {s.ip_address && (
                          <>
                            <span className={styles.ip} title={s.ip_address}>
                              {s.ip_address}
                            </span>
                            {" · "}
                          </>
                        )}
                        {location && `${location} · `}
                        {t("security.signedInOn", {
                          date: formatDateTime(s.created_at),
                        })}
                      </>
                    }
                  >
                    <Button
                      size="small"
                      appearance="subtle"
                      onClick={() => setSelectedSession(s)}
                    >
                      {t("security.details")}
                    </Button>
                    {!s.is_current &&
                      removeButton(t("security.revokeSession"), () =>
                        handleRevokeSession(s.id),
                      )}
                  </SettingsRow>
                );
              })
            )}
          </SettingsCard>

          {/* ── OAuth settings ── */}
          <SettingsCard
            title={t("security.oauthSettingsTitle")}
            description={t("security.oauthSettingsDesc")}
          >
            <SettingsRow
              label={t("security.accessTokenTtlLabel")}
              description={t("security.accessTokenTtlHint", {
                siteDefault: me?.site_access_token_ttl_minutes ?? 60,
              })}
            >
              <div className={styles.duration}>
                <DurationInput
                  value={accessTtl}
                  unit="minutes"
                  onChange={setAccessTtl}
                  placeholder={t("security.tokenTtlPlaceholder", {
                    value: `${me?.site_access_token_ttl_minutes ?? 60} min`,
                  })}
                />
              </div>
            </SettingsRow>
            <SettingsRow
              label={t("security.refreshTokenTtlLabel")}
              description={t("security.refreshTokenTtlHint", {
                siteDefault: me?.site_refresh_token_ttl_days ?? 30,
              })}
            >
              <div className={styles.duration}>
                <DurationInput
                  value={refreshTtl}
                  unit="days"
                  onChange={setRefreshTtl}
                  placeholder={t("security.tokenTtlPlaceholder", {
                    value: `${me?.site_refresh_token_ttl_days ?? 30} days`,
                  })}
                />
              </div>
            </SettingsRow>
            <SettingsRow
              label={t("security.notifyOnAutoAuthLabel")}
              description={t("security.notifyOnAutoAuthDesc")}
            >
              <Switch
                aria-label={t("security.notifyOnAutoAuthLabel")}
                checked={notifyOnAutoAuth}
                onChange={(_, d) => setNotifyOnAutoAuth(d.checked)}
              />
            </SettingsRow>
            <SettingsFooter>
              <Button
                appearance="subtle"
                disabled={
                  savingOAuthSettings ||
                  (accessTtl === null && refreshTtl === null)
                }
                onClick={() => {
                  setAccessTtl(null);
                  setRefreshTtl(null);
                }}
              >
                {t("security.tokenTtlUseSiteDefault")}
              </Button>
              <Button
                appearance="primary"
                disabled={savingOAuthSettings || !oauthDirty}
                onClick={handleSaveOAuthSettings}
              >
                {savingOAuthSettings ? (
                  <Spinner size="tiny" />
                ) : (
                  t("common.saveChanges")
                )}
              </Button>
            </SettingsFooter>
          </SettingsCard>
        </>
      )}

      {/* Renders nothing for ordinary accounts. */}
      <AccountRestrictionPanel />

      {/* ── Dialogs ── */}

      {/* Add authenticator: name, then scan and confirm a code. */}
      <Dialog
        open={totpOpen}
        onOpenChange={(_, d) => {
          if (!d.open) closeTotp();
        }}
      >
        <DialogSurface>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (totpSetup) void handleVerifyTotp();
              else void handleSetupTotp();
            }}
          >
            <DialogBody>
              <DialogTitle>{t("security.addAuthenticator")}</DialogTitle>
              <DialogContent>
                {!totpSetup ? (
                  <div className={styles.dialogStack}>
                    <Text className={styles.muted}>
                      {t("security.addAuthenticatorDesc")}
                    </Text>
                    <Field label={t("security.nameOptional")}>
                      <Input
                        autoFocus
                        value={totpName}
                        onChange={(e) => setTotpName(e.target.value)}
                        placeholder={t("security.namePlaceholder")}
                      />
                    </Field>
                  </div>
                ) : (
                  <div className={styles.qrSection}>
                    <Text>{t("security.scanQrCode")}</Text>
                    {totpQrSvg && (
                      <div
                        role="img"
                        aria-label="TOTP QR Code"
                        className={styles.qr}
                        // Generated locally by the qrcode library — no
                        // untrusted markup, so safe to drop into the DOM.
                        dangerouslySetInnerHTML={{ __html: totpQrSvg }}
                      />
                    )}
                    <span className={styles.secret}>{totpSetup.secret}</span>
                    <Field
                      label={t("security.enterCode")}
                      className={styles.codeField}
                    >
                      <Input
                        autoFocus
                        value={totpCode}
                        onChange={(e) => setTotpCode(e.target.value)}
                        placeholder={t("security.codePlaceholder")}
                        maxLength={6}
                        autoComplete="one-time-code"
                        inputMode="numeric"
                      />
                    </Field>
                  </div>
                )}
              </DialogContent>
              <DialogActions>
                <Button type="button" onClick={closeTotp}>
                  {t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  appearance="primary"
                  disabled={totpLoading || (!!totpSetup && totpCode.length < 6)}
                >
                  {totpLoading ? (
                    <Spinner size="tiny" />
                  ) : totpSetup ? (
                    t("security.verifyEnable")
                  ) : (
                    t("common.next")
                  )}
                </Button>
              </DialogActions>
            </DialogBody>
          </form>
        </DialogSurface>
      </Dialog>

      {/* Backup codes, shown once after enabling or resetting. */}
      <Dialog open={!!backupCodes} modalType="alert">
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("security.backupCodesTitle")}</DialogTitle>
            <DialogContent>
              <div className={styles.dialogStack}>
                <Text>{t("security.saveBackupCodes")}</Text>
                <div className={styles.backupCodes}>
                  {backupCodes?.map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                </div>
              </div>
            </DialogContent>
            <DialogActions>
              <Button
                icon={<CopyRegular />}
                onClick={() =>
                  navigator.clipboard.writeText((backupCodes ?? []).join("\n"))
                }
              >
                {t("common.copy")}
              </Button>
              <Button
                icon={<ArrowDownloadRegular />}
                onClick={() => {
                  const blob = new Blob([(backupCodes ?? []).join("\n")], {
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
              <Button appearance="primary" onClick={() => setBackupCodes(null)}>
                {t("common.done")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Reset backup codes */}
      <Dialog
        open={resetOpen}
        onOpenChange={(_, d) => {
          if (!d.open) {
            setResetOpen(false);
            setResetBkCode("");
          }
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("security.resetBackupCodesTitle")}</DialogTitle>
            <DialogContent>
              <Field label={t("security.enterTotpToConfirm")}>
                <Input
                  autoFocus
                  value={resetBkCode}
                  onChange={(e) => setResetBkCode(e.target.value)}
                  placeholder={t("security.codePlaceholder")}
                  maxLength={6}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                />
              </Field>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button>{t("common.cancel")}</Button>
              </DialogTrigger>
              <Button
                appearance="primary"
                disabled={resetBkCode.length < 6}
                onClick={handleResetBackupCodes}
              >
                {t("security.resetBackupCodes")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Remove authenticator */}
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
                  autoFocus
                  value={removeCode}
                  onChange={(e) => setRemoveCode(e.target.value)}
                  placeholder={t("security.codePlaceholder")}
                  maxLength={6}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                />
              </Field>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setRemoveId(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                appearance="primary"
                className={styles.danger}
                disabled={removeCode.length < 6}
                onClick={handleRemoveTotp}
              >
                {t("common.remove")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Add passkey: optional name, then the browser's own prompt. */}
      <Dialog
        open={passkeyOpen}
        onOpenChange={(_, d) => {
          if (!d.open && !passkeyLoading) setPasskeyOpen(false);
        }}
      >
        <DialogSurface>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleAddPasskey();
            }}
          >
            <DialogBody>
              <DialogTitle>{t("security.addPasskey")}</DialogTitle>
              <DialogContent>
                <div className={styles.dialogStack}>
                  <Text className={styles.muted}>
                    {t("security.addPasskeyDesc")}
                  </Text>
                  <Field label={t("security.passkeyNameOptional")}>
                    <Input
                      autoFocus
                      value={passkeyName}
                      onChange={(e) => setPasskeyName(e.target.value)}
                      placeholder={t("security.passkeyNamePlaceholder")}
                    />
                  </Field>
                </div>
              </DialogContent>
              <DialogActions>
                <Button
                  type="button"
                  disabled={passkeyLoading}
                  onClick={() => setPasskeyOpen(false)}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  appearance="primary"
                  disabled={passkeyLoading}
                >
                  {passkeyLoading ? (
                    <Spinner size="tiny" />
                  ) : (
                    t("security.addPasskey")
                  )}
                </Button>
              </DialogActions>
            </DialogBody>
          </form>
        </DialogSurface>
      </Dialog>

      {/* Add GPG key(s) */}
      <Dialog
        open={gpgOpen}
        onOpenChange={(_, d) => {
          if (!d.open && !gpgLoading) setGpgOpen(false);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("security.addGpgKey")}</DialogTitle>
            <DialogContent>
              <div className={styles.dialogStack}>
                <Field label={t("security.gpgKeyName")}>
                  <Input
                    autoFocus
                    value={gpgKeyName}
                    onChange={(e) => setGpgKeyName(e.target.value)}
                    placeholder={t("security.gpgKeyNamePlaceholder")}
                  />
                </Field>
                <Field
                  label={t("security.gpgPublicKey")}
                  hint={t("security.gpgMultiKeyHint")}
                  required
                >
                  <Textarea
                    value={gpgKeyText}
                    onChange={(e) => setGpgKeyText(e.target.value)}
                    placeholder={t("security.gpgPublicKeyPlaceholder")}
                    rows={8}
                    textarea={{ className: styles.mono }}
                  />
                </Field>
              </div>
            </DialogContent>
            <DialogActions>
              <Button disabled={gpgLoading} onClick={() => setGpgOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                appearance="primary"
                disabled={gpgLoading || !gpgKeyText.trim()}
                onClick={handleAddGpgKey}
              >
                {gpgLoading ? <Spinner size="tiny" /> : t("security.addGpgKey")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Session details */}
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
              <div className={styles.dialogStack}>
                <LabeledLine label={t("security.deviceLabel")}>
                  {describeDevice(selectedSession?.user_agent ?? null) ??
                    t("security.unknown")}
                </LabeledLine>
                {/* Full User-Agent, so an unfamiliar session can be
                    identified precisely (issue #2). */}
                <LabeledLine label={t("security.userAgentLabel")}>
                  <span className={styles.mono}>
                    {selectedSession?.user_agent ?? t("security.unknown")}
                  </span>
                </LabeledLine>
                <LabeledLine label={t("security.ipLabel")}>
                  <span className={styles.mono}>
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
                    continent, timezone, colo, ASN, coordinates, … Hidden when
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
                        className={styles.detailTitle}
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
                    first (issue #5). */}
                <Text
                  weight="semibold"
                  size={300}
                  className={styles.detailTitle}
                >
                  {t("security.ipHistoryTitle")}
                </Text>
                {sessionIpsLoading ? (
                  <Spinner size="tiny" />
                ) : (sessionIpsData?.ips.length ?? 0) === 0 ? (
                  <Text size={200} className={styles.muted}>
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
                          <span className={styles.mono}>{ip.ip_address}</span>
                          <Text size={200}>
                            {loc || t("security.unknownLocation")}
                          </Text>
                          {net && (
                            <Text size={200} className={styles.muted}>
                              {net}
                            </Text>
                          )}
                          <Text size={200} className={styles.muted}>
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
              {selectedSession && !selectedSession.is_current && (
                <Button
                  appearance="primary"
                  className={styles.danger}
                  onClick={() => handleRevokeSession(selectedSession.id)}
                >
                  {t("security.revokeSession")}
                </Button>
              )}
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {confirmDialog}

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
                className={styles.danger}
                disabled={revokingAll}
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
    </SettingsPage>
  );
}
