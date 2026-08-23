// One account, everything about it, in one place.
//
// The users table gives an operator a row and a couple of toggles. This is
// the page you open when someone writes in: identity, credentials, second
// factors, tokens, linked providers, addresses, domains, app grants, teams,
// and the account's own audit log — each with the action that fixes it.
//
// Every mutation here is a site-admin action recorded in both the platform
// log and the user's own, which is why the page shows that log at the bottom
// rather than hiding it behind another click.

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
  Divider,
  Field,
  Input,
  MessageBar,
  Spinner,
  Switch,
  Tab,
  TabList,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Title3,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowLeftRegular,
  CheckmarkCircleRegular,
  DeleteRegular,
  KeyResetRegular,
  PlugDisconnectedRegular,
  StarRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import { AuditLog } from "../../components/AuditLog";
import { CopyIdButton } from "../../components/CopyIdButton";
import { PasswordInput } from "../../components/PasswordInput";
import { useToastMessage } from "../../lib/useToastMessage";
import { formatDateTime } from "../../lib/datetime";
import { maskIp, parseClient } from "../../lib/auditFormat";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 },
  header: { display: "flex", alignItems: "center", gap: "12px" },
  headerText: { display: "flex", flexDirection: "column", minWidth: 0 },
  section: { display: "flex", flexDirection: "column", gap: "10px" },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
    "@media (max-width: 640px)": { gridTemplateColumns: "1fr" },
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
  },
  muted: { color: tokens.colorNeutralForeground3 },
  mono: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
  tableScroll: { overflowX: "auto" },
  empty: { color: tokens.colorNeutralForeground3, padding: "8px 0" },
  danger: { background: tokens.colorPaletteRedBackground3 },
});

function ts(value: number | null | undefined): string {
  return value ? formatDateTime(value) : "—";
}

/** A titled block with an optional right-aligned action. */
function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const styles = useStyles();
  return (
    <div className={styles.section}>
      <div
        className={styles.row}
        style={{ justifyContent: "space-between", width: "100%" }}
      >
        <Title3>{title}</Title3>
        {action}
      </div>
      <Divider />
      {children}
    </div>
  );
}

// ─── Identity ─────────────────────────────────────────────────────────────────

function IdentityCard({
  userId,
  showMsg,
}: {
  userId: string;
  showMsg: (type: "success" | "error", text: string) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string> | null>(null);

  const { data } = useQuery({
    queryKey: ["admin-user", userId],
    queryFn: () => api.adminGetUser(userId),
  });
  const user = data?.user;

  const save = useMutation({
    mutationFn: (values: Record<string, string>) =>
      api.adminUpdateUser(userId, values),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin-user", userId] });
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
      setDraft(null);
      showMsg("success", t("admin.userUpdated"));
    },
    onError: (err) =>
      showMsg("error", err instanceof ApiError ? err.message : String(err)),
  });

  if (!user) return <Spinner size="tiny" />;

  const editing = draft !== null;
  const value = (key: keyof typeof user) =>
    editing ? (draft?.[key] ?? "") : String(user[key] ?? "");

  return (
    <Section
      title={t("admin.identitySection")}
      action={
        editing ? (
          <div className={styles.row}>
            <Button size="small" onClick={() => setDraft(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              size="small"
              appearance="primary"
              disabled={save.isPending}
              onClick={() => draft && save.mutate(draft)}
            >
              {t("common.save")}
            </Button>
          </div>
        ) : (
          <Button
            size="small"
            onClick={() =>
              setDraft({
                username: user.username,
                email: user.email,
                display_name: user.display_name,
              })
            }
          >
            {t("common.edit")}
          </Button>
        )
      }
    >
      <div className={styles.grid}>
        <Field label={t("admin.usernameLabel")}>
          <Input
            readOnly={!editing}
            value={value("username")}
            onChange={(_, d) =>
              setDraft((prev) => prev && { ...prev, username: d.value })
            }
          />
        </Field>
        <Field
          label={t("admin.emailHeader")}
          hint={editing ? t("admin.emailChangeHint") : undefined}
        >
          <Input
            readOnly={!editing}
            value={value("email")}
            onChange={(_, d) =>
              setDraft((prev) => prev && { ...prev, email: d.value })
            }
          />
        </Field>
        <Field label={t("admin.displayNameLabel")}>
          <Input
            readOnly={!editing}
            value={value("display_name")}
            onChange={(_, d) =>
              setDraft((prev) => prev && { ...prev, display_name: d.value })
            }
          />
        </Field>
        <Field label={t("admin.roleHeader")}>
          <Input readOnly value={user.role} />
        </Field>
      </div>
    </Section>
  );
}

// ─── Credentials & second factors ─────────────────────────────────────────────

function SecurityCard({
  userId,
  showMsg,
}: {
  userId: string;
  showMsg: (type: "success" | "error", text: string) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [revokeSessions, setRevokeSessions] = useState(true);
  const [settingPassword, setSettingPassword] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-user-security", userId],
    queryFn: () => api.adminUserSecurity(userId),
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["admin-user-security", userId] });

  const setPw = useMutation({
    mutationFn: () =>
      api.adminSetUserPassword(userId, password, { revokeSessions }),
    onSuccess: async (res) => {
      await invalidate();
      setSettingPassword(false);
      setPassword("");
      showMsg("success", res.message);
    },
    onError: (err) =>
      showMsg("error", err instanceof ApiError ? err.message : String(err)),
  });

  const reset2fa = useMutation({
    mutationFn: () => api.adminReset2fa(userId),
    onSuccess: async (res) => {
      await invalidate();
      setConfirmReset(false);
      showMsg("success", res.message);
    },
    onError: (err) =>
      showMsg("error", err instanceof ApiError ? err.message : String(err)),
  });

  const removeFactor = useMutation({
    mutationFn: (f: { kind: "totp" | "passkey"; id: string }) =>
      f.kind === "totp"
        ? api.adminDeleteUserTotp(userId, f.id)
        : api.adminDeleteUserPasskey(userId, f.id),
    onSuccess: async (res) => {
      await invalidate();
      showMsg("success", res.message);
    },
    onError: (err) =>
      showMsg("error", err instanceof ApiError ? err.message : String(err)),
  });

  if (isLoading || !data) return <Spinner size="tiny" />;

  const factorCount = data.totp_authenticators.length + data.passkeys.length;

  return (
    <Section
      title={t("admin.securitySection")}
      action={
        <div className={styles.row}>
          <Button size="small" onClick={() => setSettingPassword(true)}>
            {t("admin.setPassword")}
          </Button>
          <Button
            size="small"
            icon={<KeyResetRegular />}
            disabled={factorCount === 0 && data.recovery_codes.count <= 0}
            onClick={() => setConfirmReset(true)}
          >
            {t("admin.reset2fa")}
          </Button>
        </div>
      }
    >
      <div className={styles.row}>
        <Badge
          appearance="tint"
          color={data.has_password ? "success" : "informative"}
        >
          {data.has_password
            ? t("admin.hasPassword")
            : t("admin.noPasswordSocialOnly")}
        </Badge>
        <Badge appearance="tint" color={factorCount ? "success" : "subtle"}>
          {t("admin.factorCount", { count: factorCount })}
        </Badge>
        <Badge appearance="tint" color="subtle">
          {data.recovery_codes.count < 0
            ? t("admin.recoveryCodesUnreadable")
            : t("admin.recoveryCodeCount", {
                count: data.recovery_codes.count,
              })}
        </Badge>
      </div>

      {factorCount === 0 ? (
        <Text className={styles.empty}>{t("admin.noFactors")}</Text>
      ) : (
        <div className={styles.tableScroll}>
          <Table size="small">
            <TableHeader>
              <TableRow>
                <TableHeaderCell>{t("admin.factorHeader")}</TableHeaderCell>
                <TableHeaderCell>{t("admin.nameHeader")}</TableHeaderCell>
                <TableHeaderCell>{t("admin.addedHeader")}</TableHeaderCell>
                <TableHeaderCell />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.totp_authenticators.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>TOTP</TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{ts(row.created_at)}</TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<DeleteRegular />}
                      aria-label={t("common.remove")}
                      onClick={() =>
                        removeFactor.mutate({ kind: "totp", id: row.id })
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
              {data.passkeys.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>Passkey</TableCell>
                  <TableCell>{row.name ?? row.device_type}</TableCell>
                  <TableCell>{ts(row.created_at)}</TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<DeleteRegular />}
                      aria-label={t("common.remove")}
                      onClick={() =>
                        removeFactor.mutate({ kind: "passkey", id: row.id })
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={settingPassword}
        onOpenChange={(_, d) => !d.open && setSettingPassword(false)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("admin.setPasswordTitle")}</DialogTitle>
            <DialogContent>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  paddingTop: 8,
                }}
              >
                <MessageBar intent="warning">
                  {t("admin.setPasswordWarning")}
                </MessageBar>
                <Field label={t("admin.newPasswordLabel")}>
                  <PasswordInput
                    value={password}
                    onChange={(_, d) => setPassword(d.value)}
                  />
                </Field>
                <Switch
                  checked={revokeSessions}
                  onChange={(_, d) => setRevokeSessions(d.checked)}
                  label={t("admin.revokeSessionsLabel")}
                />
              </div>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button>{t("common.cancel")}</Button>
              </DialogTrigger>
              <Button
                appearance="primary"
                disabled={password.length < 8 || setPw.isPending}
                onClick={() => setPw.mutate()}
              >
                {t("common.save")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog
        open={confirmReset}
        onOpenChange={(_, d) => !d.open && setConfirmReset(false)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("admin.reset2faTitle")}</DialogTitle>
            <DialogContent>
              <Text>{t("admin.reset2faBody")}</Text>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button>{t("common.cancel")}</Button>
              </DialogTrigger>
              <Button
                appearance="primary"
                className={styles.danger}
                disabled={reset2fa.isPending}
                onClick={() => reset2fa.mutate()}
              >
                {t("admin.reset2fa")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </Section>
  );
}

// ─── Email addresses ──────────────────────────────────────────────────────────

function EmailsCard({
  userId,
  showMsg,
}: {
  userId: string;
  showMsg: (type: "success" | "error", text: string) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["admin-user-emails", userId],
    queryFn: () => api.adminUserEmails(userId),
  });

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["admin-user-emails", userId] });
    await qc.invalidateQueries({ queryKey: ["admin-user", userId] });
  };
  const run = (fn: () => Promise<{ message: string }>) => async () => {
    try {
      const res = await fn();
      await refresh();
      showMsg("success", res.message);
    } catch (err) {
      showMsg("error", err instanceof ApiError ? err.message : String(err));
    }
  };

  if (!data) return <Spinner size="tiny" />;

  return (
    <Section title={t("admin.emailsSection")}>
      <div className={styles.tableScroll}>
        <Table size="small">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>{t("admin.emailHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.statusHeader")}</TableHeaderCell>
              <TableHeaderCell />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>
                <div className={styles.row}>
                  <Text>{data.primary.email}</Text>
                  <Badge appearance="tint" color="brand" size="small">
                    {t("admin.primaryBadge")}
                  </Badge>
                </div>
              </TableCell>
              <TableCell>
                {data.primary.verified
                  ? t("admin.verifiedStatus")
                  : t("admin.unverifiedStatus")}
              </TableCell>
              <TableCell>
                {!data.primary.verified && (
                  <Tooltip
                    relationship="label"
                    content={t("admin.markVerified")}
                  >
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<CheckmarkCircleRegular />}
                      onClick={run(() =>
                        api.adminVerifyUserEmail(userId, "primary"),
                      )}
                    />
                  </Tooltip>
                )}
              </TableCell>
            </TableRow>
            {data.emails.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.email}</TableCell>
                <TableCell>
                  {row.verified
                    ? t("admin.verifiedStatus")
                    : t("admin.unverifiedStatus")}
                </TableCell>
                <TableCell>
                  <div className={styles.row}>
                    {!row.verified && (
                      <Tooltip
                        relationship="label"
                        content={t("admin.markVerified")}
                      >
                        <Button
                          size="small"
                          appearance="subtle"
                          icon={<CheckmarkCircleRegular />}
                          onClick={run(() =>
                            api.adminVerifyUserEmail(userId, row.id),
                          )}
                        />
                      </Tooltip>
                    )}
                    <Tooltip
                      relationship="label"
                      content={t("admin.makePrimary")}
                    >
                      <Button
                        size="small"
                        appearance="subtle"
                        icon={<StarRegular />}
                        onClick={run(() =>
                          api.adminSetPrimaryUserEmail(userId, row.id),
                        )}
                      />
                    </Tooltip>
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<DeleteRegular />}
                      aria-label={t("common.remove")}
                      onClick={run(() =>
                        api.adminRemoveUserEmail(userId, row.id),
                      )}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Section>
  );
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

/** Live sessions with the places each has been used from.
 *
 *  "Is this login the attacker's" is a question about where a session has
 *  been, not when it started — so the IP history is on screen rather than a
 *  click away, and each session can be ended on its own without signing the
 *  owner out of everything else. */
function SessionsCard({
  userId,
  showMsg,
}: {
  userId: string;
  showMsg: (type: "success" | "error", text: string) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["admin-user-sessions", userId],
    queryFn: () => api.adminUserSessions(userId),
  });

  const end = useMutation({
    mutationFn: (sessionId: string) =>
      api.adminRevokeSession(userId, sessionId),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["admin-user-sessions", userId] });
      showMsg("success", res.message);
    },
    onError: (err) =>
      showMsg("error", err instanceof ApiError ? err.message : String(err)),
  });

  const endAll = useMutation({
    mutationFn: () => api.adminTerminateSessions(userId),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["admin-user-sessions", userId] });
      showMsg("success", res.message);
    },
    onError: (err) =>
      showMsg("error", err instanceof ApiError ? err.message : String(err)),
  });

  if (!data) return <Spinner size="tiny" />;

  return (
    <Section
      title={t("admin.sessionsSection")}
      action={
        <Button
          size="small"
          disabled={data.sessions.length === 0 || endAll.isPending}
          onClick={() => endAll.mutate()}
        >
          {t("admin.endAllSessions")}
        </Button>
      }
    >
      {data.sessions.length === 0 ? (
        <Text className={styles.empty}>{t("admin.noSessions")}</Text>
      ) : (
        <div className={styles.tableScroll}>
          <Table size="small">
            <TableHeader>
              <TableRow>
                <TableHeaderCell>{t("admin.clientHeader")}</TableHeaderCell>
                <TableHeaderCell>{t("admin.seenFromHeader")}</TableHeaderCell>
                <TableHeaderCell>{t("admin.startedHeader")}</TableHeaderCell>
                <TableHeaderCell />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.sessions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{parseClient(s.user_agent)}</TableCell>
                  <TableCell>
                    <div className={styles.row}>
                      {s.ips.length === 0 ? (
                        <Text size={200} className={styles.muted}>
                          {maskIp(s.ip_address)}
                        </Text>
                      ) : (
                        s.ips.slice(0, 3).map((ip, i) => (
                          <Tooltip
                            key={i}
                            relationship="description"
                            withArrow
                            content={`${ip.ip_address ?? "—"} · ${ts(ip.last_seen)}`}
                          >
                            <Badge appearance="tint" size="small">
                              {maskIp(ip.ip_address)}
                            </Badge>
                          </Tooltip>
                        ))
                      )}
                      {s.ips.length > 3 && (
                        <Text size={200} className={styles.muted}>
                          +{s.ips.length - 3}
                        </Text>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{ts(s.created_at)}</TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<DeleteRegular />}
                      disabled={end.isPending}
                      aria-label={t("admin.endSession")}
                      onClick={() => end.mutate(s.id)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Section>
  );
}

// ─── Generic "list with a remove button" sections ─────────────────────────────

interface ListRow {
  id: string;
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  meta?: React.ReactNode;
}

function RemovableList({
  title,
  rows,
  emptyText,
  columns,
  onRemove,
  removeLabel,
  showMsg,
}: {
  title: string;
  rows: ListRow[] | undefined;
  emptyText: string;
  columns: [string, string, string];
  onRemove: (id: string) => Promise<{ message: string }>;
  removeLabel: string;
  showMsg: (type: "success" | "error", text: string) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  if (!rows) return <Spinner size="tiny" />;

  const remove = async (id: string) => {
    setBusy(id);
    try {
      const res = await onRemove(id);
      // Cheapest correct thing: the caller's queries are all keyed under
      // "admin-user-*", so refetch the lot rather than thread a key through.
      await qc.invalidateQueries({
        predicate: (q) => String(q.queryKey[0]).startsWith("admin-user"),
      });
      showMsg("success", res.message);
    } catch (err) {
      showMsg("error", err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section title={title}>
      {rows.length === 0 ? (
        <Text className={styles.empty}>{emptyText}</Text>
      ) : (
        <div className={styles.tableScroll}>
          <Table size="small">
            <TableHeader>
              <TableRow>
                <TableHeaderCell>{columns[0]}</TableHeaderCell>
                <TableHeaderCell>{columns[1]}</TableHeaderCell>
                <TableHeaderCell>{columns[2]}</TableHeaderCell>
                <TableHeaderCell />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.primary}</TableCell>
                  <TableCell>{row.secondary ?? "—"}</TableCell>
                  <TableCell>{row.meta ?? "—"}</TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<DeleteRegular />}
                      disabled={busy === row.id}
                      aria-label={removeLabel}
                      onClick={() => remove(row.id)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Text size={200} className={styles.muted}>
        {t("admin.actionsAreAudited")}
      </Text>
    </Section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type TabValue = "overview" | "access" | "resources" | "audit";

export function AdminUserDetail() {
  const styles = useStyles();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const { message, showMsg } = useToastMessage();
  const [tab, setTab] = useState<TabValue>("overview");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-user", id],
    queryFn: () => api.adminGetUser(id),
    retry: false,
  });

  const tokens_ = useQuery({
    queryKey: ["admin-user-tokens", id],
    queryFn: () => api.adminUserTokens(id),
    enabled: tab === "access",
  });
  const connections = useQuery({
    queryKey: ["admin-user-connections", id],
    queryFn: () => api.adminUserConnections(id),
    enabled: tab === "access",
  });
  const gpgKeys = useQuery({
    queryKey: ["admin-user-gpg", id],
    queryFn: () => api.adminUserGpgKeys(id),
    enabled: tab === "access",
  });
  const authorizations = useQuery({
    queryKey: ["admin-user-authorizations", id],
    queryFn: () => api.adminUserAuthorizations(id),
    enabled: tab === "access",
  });
  const domains = useQuery({
    queryKey: ["admin-user-domains", id],
    queryFn: () => api.adminUserDomains(id),
    enabled: tab === "resources",
  });
  const teams = useQuery({
    queryKey: ["admin-user-teams", id],
    queryFn: () => api.adminUserTeams(id),
    enabled: tab === "resources",
  });

  const notifications = useQuery({
    queryKey: ["admin-user-notifications", id],
    queryFn: () => api.adminUserNotifications(id),
    enabled: tab === "resources",
  });

  const qc = useQueryClient();

  const resetNotifications = useMutation({
    mutationFn: () => api.adminResetUserNotifications(id),
    onSuccess: async (res) => {
      await qc.invalidateQueries({
        queryKey: ["admin-user-notifications", id],
      });
      showMsg("success", res.message);
    },
    onError: (err) =>
      showMsg("error", err instanceof ApiError ? err.message : String(err)),
  });

  const revokeGrants = useMutation({
    mutationFn: () => api.adminRevokeUserGrants(id),
    onSuccess: async (res) => {
      await qc.invalidateQueries({
        queryKey: ["admin-user-authorizations", id],
      });
      showMsg(
        "success",
        t("admin.revokeGrantsDone", {
          tokens: res.tokens_revoked,
          consents: res.consents_revoked,
        }),
      );
    },
    onError: (err) =>
      showMsg("error", err instanceof ApiError ? err.message : String(err)),
  });

  // Only meaningful for an account minted through a team invite; the button
  // stays hidden otherwise rather than failing when pressed.
  const convert = useMutation({
    mutationFn: (waiveEmail: boolean) => api.adminConvertUser(id, !waiveEmail),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["admin-user", id] });
      setConverting(false);
      showMsg("success", res.message);
    },
    onError: (err) =>
      showMsg("error", err instanceof ApiError ? err.message : String(err)),
  });
  const [converting, setConverting] = useState(false);
  const [waiveEmail, setWaiveEmail] = useState(false);

  if (isLoading) return <Spinner />;
  if (error || !data)
    return (
      <MessageBar intent="error">
        {error instanceof ApiError ? error.message : t("admin.userNotFound")}
      </MessageBar>
    );

  const user = data.user;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Button
          appearance="subtle"
          icon={<ArrowLeftRegular />}
          onClick={() => navigate("/admin/users")}
          aria-label={t("common.back")}
        />
        <Avatar
          name={user.display_name}
          image={user.avatar_url ? { src: user.avatar_url } : undefined}
          size={40}
        />
        <div className={styles.headerText}>
          <Title3>{user.display_name}</Title3>
          <Text size={200} className={styles.muted}>
            @{user.username} · {user.email}
          </Text>
        </div>
        <Badge
          appearance="tint"
          color={user.role === "admin" ? "brand" : "subtle"}
        >
          {user.role}
        </Badge>
        <Badge appearance="tint" color={user.is_active ? "success" : "danger"}>
          {user.is_active ? t("admin.activeStatus") : t("admin.disabledStatus")}
        </Badge>
        <CopyIdButton id={user.id} />
      </div>

      {message && <MessageBar intent={message.type}>{message.text}</MessageBar>}

      <TabList
        selectedValue={tab}
        onTabSelect={(_, d) => setTab(d.value as TabValue)}
      >
        <Tab value="overview">{t("admin.overviewTab")}</Tab>
        <Tab value="access">{t("admin.accessTab")}</Tab>
        <Tab value="resources">{t("admin.resourcesTab")}</Tab>
        <Tab value="audit">{t("admin.auditLogTab")}</Tab>
      </TabList>

      {tab === "overview" && (
        <>
          <IdentityCard userId={id} showMsg={showMsg} />
          {/* Only accounts minted through a team invite carry a restriction,
              so the section is absent rather than empty for everyone else. */}
          {user.origin_team_id && (
            <Section
              title={t("admin.restrictionSection")}
              action={
                !user.converted_at && (
                  <Button size="small" onClick={() => setConverting(true)}>
                    {t("admin.liftRestriction")}
                  </Button>
                )
              }
            >
              <div className={styles.row}>
                <Badge
                  appearance="tint"
                  color={user.converted_at ? "success" : "warning"}
                >
                  {user.converted_at
                    ? t("admin.restrictionLifted")
                    : t("admin.restrictionActive")}
                </Badge>
                <Button
                  size="small"
                  appearance="subtle"
                  onClick={() => navigate(`/teams/${user.origin_team_id}`)}
                >
                  {t("admin.originTeam")}
                </Button>
                {user.converted_at && (
                  <Text size={200} className={styles.muted}>
                    {ts(user.converted_at)}
                  </Text>
                )}
              </div>
            </Section>
          )}
          <SecurityCard userId={id} showMsg={showMsg} />
          <EmailsCard userId={id} showMsg={showMsg} />
        </>
      )}

      <Dialog
        open={converting}
        onOpenChange={(_, d) => !d.open && setConverting(false)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("admin.liftRestrictionTitle")}</DialogTitle>
            <DialogContent>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  paddingTop: 8,
                }}
              >
                <Text block>{t("admin.liftRestrictionBody")}</Text>
                <Switch
                  checked={waiveEmail}
                  onChange={(_, d) => setWaiveEmail(d.checked)}
                  label={t("admin.waiveEmailVerification")}
                />
              </div>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button>{t("common.cancel")}</Button>
              </DialogTrigger>
              <Button
                appearance="primary"
                disabled={convert.isPending}
                onClick={() => convert.mutate(waiveEmail)}
              >
                {t("admin.liftRestriction")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {tab === "access" && (
        <>
          <RemovableList
            title={t("admin.tokensSection")}
            rows={tokens_.data?.tokens.map((row) => ({
              id: row.id,
              primary: row.name,
              secondary: (
                <span className={styles.mono}>{row.scopes.join(" ")}</span>
              ),
              meta: ts(row.last_used_at),
            }))}
            emptyText={t("admin.noTokens")}
            columns={[
              t("admin.nameHeader"),
              t("admin.scopesHeader"),
              t("admin.lastUsedHeader"),
            ]}
            onRemove={(tokenId) => api.adminRevokeUserToken(id, tokenId)}
            removeLabel={t("common.revoke")}
            showMsg={showMsg}
          />
          <SessionsCard userId={id} showMsg={showMsg} />
          <RemovableList
            title={t("admin.connectionsSection")}
            rows={connections.data?.connections.map((row) => ({
              id: row.id,
              primary: row.provider,
              secondary: (
                <span className={styles.mono}>{row.provider_user_id}</span>
              ),
              meta: ts(row.connected_at),
            }))}
            emptyText={t("admin.noConnections")}
            columns={[
              t("admin.providerHeader"),
              t("admin.providerAccountHeader"),
              t("admin.connectedHeader"),
            ]}
            onRemove={(connId) => api.adminRemoveUserConnection(id, connId)}
            removeLabel={t("common.remove")}
            showMsg={showMsg}
          />
          <RemovableList
            title={t("admin.gpgSection")}
            rows={gpgKeys.data?.keys.map((row) => ({
              id: row.id,
              primary: row.name,
              secondary: <span className={styles.mono}>{row.fingerprint}</span>,
              meta: ts(row.created_at),
            }))}
            emptyText={t("admin.noGpgKeys")}
            columns={[
              t("admin.nameHeader"),
              t("admin.fingerprintHeader"),
              t("admin.addedHeader"),
            ]}
            onRemove={(keyId) => api.adminRemoveUserGpgKey(id, keyId)}
            removeLabel={t("common.remove")}
            showMsg={showMsg}
          />
          {/* The per-row revoke below handles one app; this handles a
              compromised account, where the answer is all of them. */}
          <Section
            title={t("admin.revokeGrantsSection")}
            action={
              <Button
                size="small"
                icon={<PlugDisconnectedRegular />}
                disabled={
                  revokeGrants.isPending ||
                  authorizations.data?.authorizations.length === 0
                }
                onClick={() => revokeGrants.mutate()}
              >
                {t("admin.revokeAllGrants")}
              </Button>
            }
          >
            <Text size={200} className={styles.muted}>
              {t("admin.revokeGrantsHint")}
            </Text>
          </Section>

          <RemovableList
            title={t("admin.authorizationsSection")}
            rows={authorizations.data?.authorizations.map((row) => ({
              id: row.id,
              primary: row.app_name ?? row.client_id,
              secondary: (
                <span className={styles.mono}>{row.scopes.join(" ")}</span>
              ),
              meta: ts(row.granted_at),
            }))}
            emptyText={t("admin.noAuthorizations")}
            columns={[
              t("admin.applicationsTab"),
              t("admin.scopesHeader"),
              t("admin.grantedHeader"),
            ]}
            onRemove={(consentId) =>
              api.adminRevokeUserAuthorization(id, consentId)
            }
            removeLabel={t("common.revoke")}
            showMsg={showMsg}
          />
        </>
      )}

      {tab === "resources" && (
        <>
          <RemovableList
            title={t("admin.domainsSection")}
            rows={domains.data?.domains.map((row) => ({
              id: row.id,
              primary: row.domain,
              secondary: row.verified
                ? t("admin.verifiedStatus")
                : t("admin.unverifiedStatus"),
              meta: ts(row.created_at),
            }))}
            emptyText={t("admin.noDomains")}
            columns={[
              t("admin.domainHeader"),
              t("admin.statusHeader"),
              t("admin.addedHeader"),
            ]}
            onRemove={(domainId) => api.adminRemoveUserDomain(id, domainId)}
            removeLabel={t("common.remove")}
            showMsg={showMsg}
          />

          {/* Counts, not contents. An operator handling "I stopped getting
              emails" needs to know whether a ruleset is active; reading which
              addresses someone routes what to is a different thing. */}
          <Section
            title={t("admin.notificationsSection")}
            action={
              <Button
                size="small"
                disabled={
                  resetNotifications.isPending ||
                  (notifications.data?.rulesets.length ?? 0) === 0
                }
                onClick={() => resetNotifications.mutate()}
              >
                {t("admin.resetNotificationRules")}
              </Button>
            }
          >
            {!notifications.data ? (
              <Spinner size="tiny" />
            ) : (
              <div className={styles.row}>
                {notifications.data.rulesets.length === 0 ? (
                  <Text className={styles.muted}>
                    {t("admin.noRulesets", {
                      count: notifications.data.legacy_pref_count,
                    })}
                  </Text>
                ) : (
                  notifications.data.rulesets.map((r) => (
                    <Badge
                      key={r.id}
                      appearance="tint"
                      color={r.is_active ? "success" : "subtle"}
                    >
                      {r.name} ·{" "}
                      {r.rule_count < 0
                        ? t("admin.rulesUnreadable")
                        : t("admin.ruleCount", { count: r.rule_count })}
                    </Badge>
                  ))
                )}
              </div>
            )}
          </Section>

          <Section title={t("admin.teamsSection")}>
            {!teams.data ? (
              <Spinner size="tiny" />
            ) : teams.data.teams.length === 0 ? (
              <Text className={styles.empty}>{t("admin.noTeams")}</Text>
            ) : (
              <div className={styles.tableScroll}>
                <Table size="small">
                  <TableHeader>
                    <TableRow>
                      <TableHeaderCell>{t("admin.teamHeader")}</TableHeaderCell>
                      <TableHeaderCell>{t("admin.roleHeader")}</TableHeaderCell>
                      <TableHeaderCell>
                        {t("admin.joinedHeader")}
                      </TableHeaderCell>
                      <TableHeaderCell />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {teams.data.teams.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <div className={styles.row}>
                            <Avatar
                              name={row.name}
                              image={
                                row.avatar_url
                                  ? { src: row.avatar_url }
                                  : undefined
                              }
                              size={20}
                            />
                            {row.name}
                          </div>
                        </TableCell>
                        <TableCell>{row.role}</TableCell>
                        <TableCell>{ts(row.joined_at)}</TableCell>
                        <TableCell>
                          {/* Memberships are changed on the team itself,
                              which a site admin can open for any team. */}
                          <Button
                            size="small"
                            appearance="subtle"
                            onClick={() => navigate(`/teams/${row.id}`)}
                          >
                            {t("admin.manageTeam")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>
        </>
      )}

      {tab === "audit" && (
        <Section title={t("admin.userAuditSection")}>
          <Text size={200} className={styles.muted}>
            {t("admin.userAuditHint")}
          </Text>
          <AuditLog base={`user/${id}`} />
        </Section>
      )}
    </div>
  );
}
