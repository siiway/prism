// Notification preference management — per-event email address and Telegram account routing

import {
  Button,
  MessageBar,
  MessageBarBody,
  Spinner,
  Text,
  Textarea,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { AlertRegular } from "@fluentui/react-icons";
import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import type {
  NotificationRules,
  NotificationEmailRule,
  NotificationTgRule,
  NotifEmail,
  NotifTgConnection,
} from "../lib/api";
import { SkeletonToggleRows } from "../components/Skeletons";

// ─── Event catalogue ─────────────────────────────────────────────────────────

interface EventEntry {
  value: string;
  labelKey: string;
  descKey: string;
}

interface EventGroup {
  groupKey: string;
  events: EventEntry[];
}

const EVENT_GROUPS: EventGroup[] = [
  {
    groupKey: "notifications.groupApps",
    events: [
      {
        value: "app.created",
        labelKey: "notifications.appCreatedLabel",
        descKey: "notifications.appCreatedDesc",
      },
      {
        value: "app.updated",
        labelKey: "notifications.appUpdatedLabel",
        descKey: "notifications.appUpdatedDesc",
      },
      {
        value: "app.deleted",
        labelKey: "notifications.appDeletedLabel",
        descKey: "notifications.appDeletedDesc",
      },
    ],
  },
  {
    groupKey: "notifications.groupDomains",
    events: [
      {
        value: "domain.added",
        labelKey: "notifications.domainAddedLabel",
        descKey: "notifications.domainAddedDesc",
      },
      {
        value: "domain.verified",
        labelKey: "notifications.domainVerifiedLabel",
        descKey: "notifications.domainVerifiedDesc",
      },
      {
        value: "domain.deleted",
        labelKey: "notifications.domainDeletedLabel",
        descKey: "notifications.domainDeletedDesc",
      },
    ],
  },
  {
    groupKey: "notifications.groupConnections",
    events: [
      {
        value: "connection.added",
        labelKey: "notifications.connectionAddedLabel",
        descKey: "notifications.connectionAddedDesc",
      },
      {
        value: "connection.removed",
        labelKey: "notifications.connectionRemovedLabel",
        descKey: "notifications.connectionRemovedDesc",
      },
      {
        value: "connection.login",
        labelKey: "notifications.connectionLoginLabel",
        descKey: "notifications.connectionLoginDesc",
      },
    ],
  },
  {
    groupKey: "notifications.groupAccount",
    events: [
      {
        value: "profile.updated",
        labelKey: "notifications.profileUpdatedLabel",
        descKey: "notifications.profileUpdatedDesc",
      },
    ],
  },
  {
    groupKey: "notifications.groupSecurity",
    events: [
      {
        value: "security.passkey_added",
        labelKey: "notifications.passkeyAddedLabel",
        descKey: "notifications.passkeyAddedDesc",
      },
      {
        value: "security.passkey_removed",
        labelKey: "notifications.passkeyRemovedLabel",
        descKey: "notifications.passkeyRemovedDesc",
      },
      {
        value: "security.totp_enabled",
        labelKey: "notifications.totpEnabledLabel",
        descKey: "notifications.totpEnabledDesc",
      },
      {
        value: "security.totp_disabled",
        labelKey: "notifications.totpDisabledLabel",
        descKey: "notifications.totpDisabledDesc",
      },
    ],
  },
  {
    groupKey: "notifications.groupTokens",
    events: [
      {
        value: "token.created",
        labelKey: "notifications.tokenCreatedLabel",
        descKey: "notifications.tokenCreatedDesc",
      },
      {
        value: "token.revoked",
        labelKey: "notifications.tokenRevokedLabel",
        descKey: "notifications.tokenRevokedDesc",
      },
    ],
  },
  {
    groupKey: "notifications.groupTeams",
    events: [
      {
        value: "team.member_added",
        labelKey: "notifications.teamMemberAddedLabel",
        descKey: "notifications.teamMemberAddedDesc",
      },
      {
        value: "team.member_removed",
        labelKey: "notifications.teamMemberRemovedLabel",
        descKey: "notifications.teamMemberRemovedDesc",
      },
    ],
  },
  {
    groupKey: "notifications.groupOAuth",
    events: [
      {
        value: "oauth.consent_granted",
        labelKey: "notifications.consentGrantedLabel",
        descKey: "notifications.consentGrantedDesc",
      },
      {
        value: "oauth.consent_revoked",
        labelKey: "notifications.consentRevokedLabel",
        descKey: "notifications.consentRevokedDesc",
      },
    ],
  },
];

const ALL_EVENT_KEYS = EVENT_GROUPS.flatMap((g) =>
  g.events.map((e) => e.value),
);

// ─── Bulk-level helpers ───────────────────────────────────────────────────────

function uniformLevel(
  levels: Array<"brief" | "full" | null>,
): "brief" | "full" | null | "mixed" {
  if (levels.length === 0) return null;
  const first = levels[0];
  return levels.every((l) => l === first) ? first : "mixed";
}

function getUniformEmailLevel(
  eventKeys: string[],
  rules: NotificationRules,
  emails: NotifEmail[],
): "brief" | "full" | null | "mixed" {
  if (!emails.length) return null;
  const levels: Array<"brief" | "full" | null> = [];
  for (const ev of eventKeys)
    for (const email of emails) {
      const entry = (rules[ev]?.email ?? []).find(
        (r) => r.email_id === email.id,
      );
      levels.push(entry?.level ?? null);
    }
  return uniformLevel(levels);
}

function getUniformTgLevel(
  eventKeys: string[],
  rules: NotificationRules,
  connections: NotifTgConnection[],
): "brief" | "full" | null | "mixed" {
  if (!connections.length) return null;
  const levels: Array<"brief" | "full" | null> = [];
  for (const ev of eventKeys)
    for (const conn of connections) {
      const entry = (rules[ev]?.tg ?? []).find(
        (r) => r.connection_id === conn.id,
      );
      levels.push(entry?.level ?? null);
    }
  return uniformLevel(levels);
}

function getUniformEmailAccountLevel(
  eventKeys: string[],
  rules: NotificationRules,
  emailId: string,
): "brief" | "full" | null | "mixed" {
  const levels: Array<"brief" | "full" | null> = [];
  for (const ev of eventKeys) {
    const entry = (rules[ev]?.email ?? []).find((r) => r.email_id === emailId);
    levels.push(entry?.level ?? null);
  }
  return uniformLevel(levels);
}

function getUniformTgAccountLevel(
  eventKeys: string[],
  rules: NotificationRules,
  connectionId: string,
): "brief" | "full" | null | "mixed" {
  const levels: Array<"brief" | "full" | null> = [];
  for (const ev of eventKeys) {
    const entry = (rules[ev]?.tg ?? []).find((r) => r.connection_id === connectionId);
    levels.push(entry?.level ?? null);
  }
  return uniformLevel(levels);
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  root: {
    maxWidth: "700px",
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  icon: {
    fontSize: "24px",
    color: tokens.colorBrandForeground1,
  },
  group: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  groupHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalS,
  },
  groupLabel: {
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  selectAllRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground2,
  },
  selectAllLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  jsonPanel: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground2,
  },
  eventRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    gap: tokens.spacingHorizontalL,
    background: tokens.colorNeutralBackground1,
  },
  eventText: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    flex: 1,
    minWidth: 0,
  },
  channelStack: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    flexShrink: 0,
    alignItems: "flex-end",
  },
  channelRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  channelLabel: {
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground3,
    width: "20px",
    textAlign: "center",
    flexShrink: 0,
  },
  accountLabel: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    maxWidth: "160px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  levelPicker: {
    display: "flex",
    flexShrink: 0,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    overflow: "hidden",
  },
  levelBtn: {
    borderRadius: "0",
    border: "none",
    borderRight: `1px solid ${tokens.colorNeutralStroke1}`,
    minWidth: "46px",
    ":last-child": { borderRight: "none" },
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    paddingTop: tokens.spacingVerticalXS,
  },
});

// ─── Shared per-account level row ────────────────────────────────────────────

function AccountLevelRow({
  icon,
  label,
  level,
  onChange,
}: {
  icon: string;
  label: string;
  level: "brief" | "full" | null | "mixed";
  onChange: (l: "brief" | "full" | null) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <div className={styles.channelRow}>
      <Tooltip content={label} relationship="label">
        <span className={styles.channelLabel}>{icon}</span>
      </Tooltip>
      <span className={styles.accountLabel}>{label}</span>
      <div className={styles.levelPicker}>
        <Button
          className={styles.levelBtn}
          size="small"
          appearance={level === null ? "primary" : "subtle"}
          onClick={() => onChange(null)}
        >
          {t("notifications.levelOff")}
        </Button>
        <Button
          className={styles.levelBtn}
          size="small"
          appearance={level === "brief" ? "primary" : "subtle"}
          onClick={() => onChange("brief")}
        >
          {t("notifications.levelBrief")}
        </Button>
        <Button
          className={styles.levelBtn}
          size="small"
          appearance={level === "full" ? "primary" : "subtle"}
          onClick={() => onChange("full")}
        >
          {t("notifications.levelFull")}
        </Button>
      </div>
    </div>
  );
}

// ─── Email channel picker ─────────────────────────────────────────────────────

function EmailChannelPicker({
  value,
  emails,
  onChange,
}: {
  value: NotificationEmailRule[];
  emails: NotifEmail[];
  onChange: (v: NotificationEmailRule[]) => void;
}) {
  if (emails.length === 0) return null;
  return (
    <>
      {emails.map((email) => {
        const rule = value.find((r) => r.email_id === email.id);
        return (
          <AccountLevelRow
            key={email.id}
            icon="✉"
            label={email.email}
            level={rule?.level ?? null}
            onChange={(l) => {
              const rest = value.filter((r) => r.email_id !== email.id);
              onChange(l ? [...rest, { email_id: email.id, level: l }] : rest);
            }}
          />
        );
      })}
    </>
  );
}

// ─── Telegram channel picker ──────────────────────────────────────────────────

function TgChannelPicker({
  value,
  connections,
  onChange,
}: {
  value: NotificationTgRule[];
  connections: NotifTgConnection[];
  onChange: (v: NotificationTgRule[]) => void;
}) {
  const { t } = useTranslation();
  if (connections.length === 0) return null;
  return (
    <>
      {connections.map((conn) => {
        const handle = conn.username ? `@${conn.username}` : conn.name;
        const label = t("notifications.tgAccountLabel", { account: handle });
        const rule = value.find((r) => r.connection_id === conn.id);
        return (
          <AccountLevelRow
            key={conn.id}
            icon="✈"
            label={label}
            level={rule?.level ?? null}
            onChange={(l) => {
              const rest = value.filter((r) => r.connection_id !== conn.id);
              onChange(
                l ? [...rest, { connection_id: conn.id, level: l }] : rest,
              );
            }}
          />
        );
      })}
    </>
  );
}

// ─── Bulk level controls ─────────────────────────────────────────────────────

const BULK_LEVELS = [
  [null, "notifications.levelOff"],
  ["brief", "notifications.levelBrief"],
  ["full", "notifications.levelFull"],
] as const;

function BulkLevelControls({
  eventKeys,
  rules,
  emailLevel,
  tgLevel,
  emails,
  connections,
  showTg,
  onEmail,
  onTg,
  onEmailAccount,
  onTgAccount,
}: {
  eventKeys: string[];
  rules: NotificationRules;
  emailLevel: "brief" | "full" | null | "mixed";
  tgLevel: "brief" | "full" | null | "mixed";
  emails: NotifEmail[];
  connections: NotifTgConnection[];
  showTg: boolean;
  onEmail: (level: "brief" | "full" | null) => void;
  onTg: (level: "brief" | "full" | null) => void;
  onEmailAccount: (emailId: string, level: "brief" | "full" | null) => void;
  onTgAccount: (
    connectionId: string,
    level: "brief" | "full" | null,
  ) => void;
}) {
  const { t } = useTranslation();
  const styles = useStyles();
  return (
    <div className={styles.channelStack}>
      {emails.length > 0 && (
        <div className={styles.channelRow}>
          <Tooltip
            content={t("notifications.emailChannel")}
            relationship="label"
          >
            <span className={styles.channelLabel}>✉</span>
          </Tooltip>
          <div className={styles.levelPicker}>
            {BULK_LEVELS.map(([level, key]) => (
              <Button
                key={String(level)}
                className={styles.levelBtn}
                size="small"
                appearance={
                  emailLevel !== "mixed" && emailLevel === level
                    ? "primary"
                    : "subtle"
                }
                onClick={() => onEmail(level)}
              >
                {t(key)}
              </Button>
            ))}
          </div>
        </div>
      )}
      {showTg && connections.length > 0 && (
        <div className={styles.channelRow}>
          <Tooltip content={t("notifications.tgChannel")} relationship="label">
            <span className={styles.channelLabel}>✈</span>
          </Tooltip>
          <div className={styles.levelPicker}>
            {BULK_LEVELS.map(([level, key]) => (
              <Button
                key={String(level)}
                className={styles.levelBtn}
                size="small"
                appearance={
                  tgLevel !== "mixed" && tgLevel === level
                    ? "primary"
                    : "subtle"
                }
                onClick={() => onTg(level)}
              >
                {t(key)}
              </Button>
            ))}
          </div>
        </div>
      )}
      {emails.map((email) => {
        const level = getUniformEmailAccountLevel(eventKeys, rules, email.id);
        return (
          <AccountLevelRow
            key={`bulk-email-${email.id}`}
            icon="✉"
            label={email.email}
            level={level}
            onChange={(nextLevel) => onEmailAccount(email.id, nextLevel)}
          />
        );
      })}
      {showTg &&
        connections.map((conn) => {
          const handle = conn.username ? `@${conn.username}` : conn.name;
          const label = t("notifications.tgAccountLabel", { account: handle });
          const level = getUniformTgAccountLevel(eventKeys, rules, conn.id);
          return (
            <AccountLevelRow
              key={`bulk-tg-${conn.id}`}
              icon="✈"
              label={label}
              level={level}
              onChange={(nextLevel) => onTgAccount(conn.id, nextLevel)}
            />
          );
        })}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Notifications() {
  const { t } = useTranslation();
  const styles = useStyles();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["notification-prefs"],
    queryFn: () => api.getNotificationPrefs(),
  });

  const { data: site } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });

  const hasTgBot = !!site?.tg_notify_source_slug;
  const emails: NotifEmail[] = data?.emails ?? [];
  const tgConnections: NotifTgConnection[] = data?.tg_connections ?? [];
  const showTg = tgConnections.length > 0;

  const [rules, setRules] = useState<NotificationRules>({});
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setRules(data.rules ?? {});
      setDirty(false);
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: (r: NotificationRules) => api.updateNotificationPrefs(r),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-prefs"] });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  function applyBulkEmail(eventKeys: string[], level: "brief" | "full" | null) {
    setRules((prev) => {
      const next = { ...prev };
      for (const ev of eventKeys)
        next[ev] = {
          ...(next[ev] ?? {}),
          email: level ? emails.map((e) => ({ email_id: e.id, level })) : [],
        };
      return next;
    });
    setDirty(true);
    setSaved(false);
  }

  function applyBulkTg(eventKeys: string[], level: "brief" | "full" | null) {
    setRules((prev) => {
      const next = { ...prev };
      for (const ev of eventKeys)
        next[ev] = {
          ...(next[ev] ?? {}),
          tg: level
            ? tgConnections.map((c) => ({ connection_id: c.id, level }))
            : [],
        };
      return next;
    });
    setDirty(true);
    setSaved(false);
  }

  function applyBulkEmailAccount(
    eventKeys: string[],
    emailId: string,
    level: "brief" | "full" | null,
  ) {
    setRules((prev) => {
      const next = { ...prev };
      for (const ev of eventKeys) {
        const curr = next[ev] ?? {};
        const rest = (curr.email ?? []).filter((r) => r.email_id !== emailId);
        next[ev] = {
          ...curr,
          email: level ? [...rest, { email_id: emailId, level }] : rest,
        };
      }
      return next;
    });
    setDirty(true);
    setSaved(false);
  }

  function applyBulkTgAccount(
    eventKeys: string[],
    connectionId: string,
    level: "brief" | "full" | null,
  ) {
    setRules((prev) => {
      const next = { ...prev };
      for (const ev of eventKeys) {
        const curr = next[ev] ?? {};
        const rest = (curr.tg ?? []).filter((r) => r.connection_id !== connectionId);
        next[ev] = {
          ...curr,
          tg: level ? [...rest, { connection_id: connectionId, level }] : rest,
        };
      }
      return next;
    });
    setDirty(true);
    setSaved(false);
  }

  function openJson() {
    setJsonText(JSON.stringify(rules, null, 2));
    setJsonError(null);
    setJsonOpen(true);
  }

  function applyJson() {
    try {
      const parsed = JSON.parse(jsonText) as NotificationRules;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      )
        throw new Error("root must be an object");
      setRules(parsed);
      setDirty(true);
      setSaved(false);
      setJsonOpen(false);
      setJsonError(null);
    } catch (e) {
      setJsonError((e as Error).message);
    }
  }

  function setEmailChannel(event: string, value: NotificationEmailRule[]) {
    setRules((prev) => ({
      ...prev,
      [event]: { ...(prev[event] ?? {}), email: value },
    }));
    setDirty(true);
    setSaved(false);
  }

  function setTgChannel(event: string, value: NotificationTgRule[]) {
    setRules((prev) => ({
      ...prev,
      [event]: { ...(prev[event] ?? {}), tg: value },
    }));
    setDirty(true);
    setSaved(false);
  }

  if (isLoading) return <SkeletonToggleRows rows={8} />;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <AlertRegular className={styles.icon} />
        <div>
          <Text as="h1" size={500} weight="semibold" block>
            {t("notifications.title")}
          </Text>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            {t("notifications.subtitle")}
          </Text>
        </div>
      </div>

      {emails.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {t("notifications.levelLegend")}
          </Text>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {(["off", "brief", "full"] as const).map((l) => (
              <div
                key={l}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 8px",
                  borderRadius: 4,
                  border: `1px solid ${tokens.colorNeutralStroke2}`,
                  background: tokens.colorNeutralBackground2,
                }}
              >
                <Text size={200} weight="semibold">
                  {t(
                    `notifications.level${l.charAt(0).toUpperCase() + l.slice(1)}`,
                  )}
                </Text>
                <Text
                  size={100}
                  style={{ color: tokens.colorNeutralForeground3 }}
                >
                  —{" "}
                  {t(
                    `notifications.level${l.charAt(0).toUpperCase() + l.slice(1)}Hint`,
                  )}
                </Text>
              </div>
            ))}
          </div>
        </div>
      )}

      {emails.length === 0 && (
        <MessageBar intent="warning">
          <MessageBarBody>{t("notifications.noEmail")}</MessageBarBody>
        </MessageBar>
      )}

      {hasTgBot && !showTg && (
        <MessageBar intent="info">
          <MessageBarBody>{t("notifications.tgNoAccount")}</MessageBarBody>
        </MessageBar>
      )}

      {saved && (
        <MessageBar intent="success">
          <MessageBarBody>{t("notifications.saved")}</MessageBarBody>
        </MessageBar>
      )}

      {mutation.isError && (
        <MessageBar intent="error">
          <MessageBarBody>{t("common.saveFailed")}</MessageBarBody>
        </MessageBar>
      )}

      {(emails.length > 0 || showTg) && (
        <div className={styles.selectAllRow}>
          <span className={styles.selectAllLabel}>
            {t("notifications.selectAll")}
          </span>
          <BulkLevelControls
            eventKeys={ALL_EVENT_KEYS}
            rules={rules}
            emailLevel={getUniformEmailLevel(ALL_EVENT_KEYS, rules, emails)}
            tgLevel={getUniformTgLevel(ALL_EVENT_KEYS, rules, tgConnections)}
            emails={emails}
            connections={tgConnections}
            showTg={showTg}
            onEmail={(l) => applyBulkEmail(ALL_EVENT_KEYS, l)}
            onTg={(l) => applyBulkTg(ALL_EVENT_KEYS, l)}
            onEmailAccount={(emailId, l) =>
              applyBulkEmailAccount(ALL_EVENT_KEYS, emailId, l)
            }
            onTgAccount={(connectionId, l) =>
              applyBulkTgAccount(ALL_EVENT_KEYS, connectionId, l)
            }
          />
        </div>
      )}

      {EVENT_GROUPS.map((group) => {
        const groupKeys = group.events.map((e) => e.value);
        return (
          <div key={group.groupKey} className={styles.group}>
            <div className={styles.groupHeader}>
              <Text className={styles.groupLabel}>{t(group.groupKey)}</Text>
              <BulkLevelControls
                eventKeys={groupKeys}
                rules={rules}
                emailLevel={getUniformEmailLevel(groupKeys, rules, emails)}
                tgLevel={getUniformTgLevel(groupKeys, rules, tgConnections)}
                emails={emails}
                connections={tgConnections}
                showTg={showTg}
                onEmail={(l) => applyBulkEmail(groupKeys, l)}
                onTg={(l) => applyBulkTg(groupKeys, l)}
                onEmailAccount={(emailId, l) =>
                  applyBulkEmailAccount(groupKeys, emailId, l)
                }
                onTgAccount={(connectionId, l) =>
                  applyBulkTgAccount(groupKeys, connectionId, l)
                }
              />
            </div>
            {group.events.map((entry) => {
              const rule = rules[entry.value] ?? {};
              return (
                <div key={entry.value} className={styles.eventRow}>
                  <div className={styles.eventText}>
                    <Text weight="semibold" size={300}>
                      {t(entry.labelKey)}
                    </Text>
                    <Text
                      size={200}
                      style={{ color: tokens.colorNeutralForeground3 }}
                    >
                      {t(entry.descKey)}
                    </Text>
                  </div>
                  <div className={styles.channelStack}>
                    <EmailChannelPicker
                      value={rule.email ?? []}
                      emails={emails}
                      onChange={(v) => setEmailChannel(entry.value, v)}
                    />
                    {showTg && (
                      <TgChannelPicker
                        value={rule.tg ?? []}
                        connections={tgConnections}
                        onChange={(v) => setTgChannel(entry.value, v)}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {jsonOpen && (
        <div className={styles.jsonPanel}>
          <Textarea
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
              setJsonError(null);
            }}
            rows={20}
            resize="vertical"
            style={{ fontFamily: "monospace", fontSize: "12px" }}
          />
          {jsonError && (
            <Text
              size={200}
              style={{ color: tokens.colorStatusDangerForeground1 }}
            >
              {t("notifications.jsonError", { error: jsonError })}
            </Text>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <Button appearance="primary" size="small" onClick={applyJson}>
              {t("notifications.jsonApply")}
            </Button>
            <Button
              size="small"
              onClick={() => {
                setJsonOpen(false);
                setJsonError(null);
              }}
            >
              {t("common.close")}
            </Button>
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <Button
          appearance="primary"
          disabled={!dirty || mutation.isPending}
          onClick={() => mutation.mutate(rules)}
        >
          {mutation.isPending ? (
            <Spinner size="tiny" />
          ) : (
            t("common.saveChanges")
          )}
        </Button>
        <Button
          appearance="subtle"
          onClick={
            jsonOpen
              ? () => {
                  setJsonOpen(false);
                  setJsonError(null);
                }
              : openJson
          }
        >
          {t("notifications.jsonEdit")}
        </Button>
      </div>
    </div>
  );
}
