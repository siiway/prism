// Notification preference management — per-event email address and Telegram account routing

import {
  Button,
  Checkbox,
  Combobox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Dropdown,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Option,
  Radio,
  RadioGroup,
  Spinner,
  Text,
  Textarea,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../lib/api";
import { useApi } from "../lib/api-context";
import { PageHeader } from "../components/PageHeader";
import type {
  NotificationRules,
  NotificationEmailRule,
  NotificationTgRule,
  NotificationDiscordRule,
  NotificationRuleset,
  NotificationRulesetRule,
  NotificationRuleSendChannel,
  NotificationLevel,
  NotifEmail,
  NotifTgConnection,
  NotifDiscordConnection,
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

function getUniformDiscordLevel(
  eventKeys: string[],
  rules: NotificationRules,
  connections: NotifDiscordConnection[],
): "brief" | "full" | null | "mixed" {
  if (!connections.length) return null;
  const levels: Array<"brief" | "full" | null> = [];
  for (const ev of eventKeys)
    for (const conn of connections) {
      const entry = (rules[ev]?.discord ?? []).find(
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
    const entry = (rules[ev]?.tg ?? []).find(
      (r) => r.connection_id === connectionId,
    );
    levels.push(entry?.level ?? null);
  }
  return uniformLevel(levels);
}

function getUniformDiscordAccountLevel(
  eventKeys: string[],
  rules: NotificationRules,
  connectionId: string,
): "brief" | "full" | null | "mixed" {
  const levels: Array<"brief" | "full" | null> = [];
  for (const ev of eventKeys) {
    const entry = (rules[ev]?.discord ?? []).find(
      (r) => r.connection_id === connectionId,
    );
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
  rulesetBar: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground2,
  },
  rulesetRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalS,
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
        <Text className={styles.channelLabel}>{icon}</Text>
      </Tooltip>
      <Text className={styles.accountLabel}>{label}</Text>
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

// ─── Discord channel picker ───────────────────────────────────────────────────

function DiscordChannelPicker({
  value,
  connections,
  onChange,
}: {
  value: NotificationDiscordRule[];
  connections: NotifDiscordConnection[];
  onChange: (v: NotificationDiscordRule[]) => void;
}) {
  const { t } = useTranslation();
  if (connections.length === 0) return null;
  return (
    <>
      {connections.map((conn) => {
        const handle = conn.username ? `@${conn.username}` : conn.name;
        const label = t("notifications.discordAccountLabel", {
          account: handle,
        });
        const rule = value.find((r) => r.connection_id === conn.id);
        return (
          <AccountLevelRow
            key={conn.id}
            icon="🎮"
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
  discordLevel,
  emails,
  connections,
  discordConnections,
  showTg,
  showDiscord,
  onEmail,
  onTg,
  onDiscord,
  onEmailAccount,
  onTgAccount,
  onDiscordAccount,
}: {
  eventKeys: string[];
  rules: NotificationRules;
  emailLevel: "brief" | "full" | null | "mixed";
  tgLevel: "brief" | "full" | null | "mixed";
  discordLevel: "brief" | "full" | null | "mixed";
  emails: NotifEmail[];
  connections: NotifTgConnection[];
  discordConnections: NotifDiscordConnection[];
  showTg: boolean;
  showDiscord: boolean;
  onEmail: (level: "brief" | "full" | null) => void;
  onTg: (level: "brief" | "full" | null) => void;
  onDiscord: (level: "brief" | "full" | null) => void;
  onEmailAccount: (emailId: string, level: "brief" | "full" | null) => void;
  onTgAccount: (connectionId: string, level: "brief" | "full" | null) => void;
  onDiscordAccount: (
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
            <Text className={styles.channelLabel}>✉</Text>
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
            <Text className={styles.channelLabel}>✈</Text>
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
      {showDiscord && discordConnections.length > 0 && (
        <div className={styles.channelRow}>
          <Tooltip
            content={t("notifications.discordChannel")}
            relationship="label"
          >
            <Text className={styles.channelLabel}>🎮</Text>
          </Tooltip>
          <div className={styles.levelPicker}>
            {BULK_LEVELS.map(([level, key]) => (
              <Button
                key={String(level)}
                className={styles.levelBtn}
                size="small"
                appearance={
                  discordLevel !== "mixed" && discordLevel === level
                    ? "primary"
                    : "subtle"
                }
                onClick={() => onDiscord(level)}
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
      {showDiscord &&
        discordConnections.map((conn) => {
          const handle = conn.username ? `@${conn.username}` : conn.name;
          const label = t("notifications.discordAccountLabel", {
            account: handle,
          });
          const level = getUniformDiscordAccountLevel(
            eventKeys,
            rules,
            conn.id,
          );
          return (
            <AccountLevelRow
              key={`bulk-discord-${conn.id}`}
              icon="🎮"
              label={label}
              level={level}
              onChange={(nextLevel) => onDiscordAccount(conn.id, nextLevel)}
            />
          );
        })}
    </div>
  );
}

// ─── Ruleset section (rule engine) ───────────────────────────────────────────
//
// A "ruleset" is an ordered list of conditional rules — each rule has a
// match (currently an event glob: "*", "security.*", etc.) and an action
// (drop, or send to one or more channels at brief/full level). Activating
// a ruleset replaces the per-event prefs at dispatch time. Disabled rules
// are skipped; "stop" halts further evaluation.

function RulesetSection(props: {
  rulesets: NotificationRuleset[];
  editingRuleset: NotificationRuleset | null;
  editingRulesetId: string | null;
  setEditingRulesetId: (id: string | null) => void;
  activeRuleset: NotificationRuleset | null;
  draftRules: NotificationRulesetRule[];
  draftDirty: boolean;
  emails: NotifEmail[];
  tgConnections: NotifTgConnection[];
  discordConnections: NotifDiscordConnection[];
  rulesetMessage: { intent: "success" | "error"; text: string } | null;
  creating: boolean;
  updating: boolean;
  deleting: boolean;
  knownEvents: string[];
  onNew: () => void;
  onRename: (rs: NotificationRuleset) => void;
  onDelete: (rs: NotificationRuleset) => void;
  onToggleActive: (rs: NotificationRuleset) => void;
  onSaveDraft: () => void;
  onDiscardDraft: () => void;
  onPatchRule: (idx: number, patch: Partial<NotificationRulesetRule>) => void;
  onMoveRule: (idx: number, delta: number) => void;
  onDeleteRule: (idx: number) => void;
  onAddRule: () => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const {
    rulesets,
    editingRuleset,
    editingRulesetId,
    setEditingRulesetId,
    draftRules,
    draftDirty,
    rulesetMessage,
  } = props;

  return (
    <div className={styles.rulesetBar}>
      <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
        <Text weight="semibold" size={200}>
          {t("notifications.rulesetsLabel")}
        </Text>
        {" — "}
        {t("notifications.rulesetsHint")}
      </Text>

      <div className={styles.rulesetRow}>
        <Dropdown
          placeholder={
            rulesets.length === 0
              ? t("notifications.rulesetsEmpty")
              : t("notifications.rulesetsSelectPlaceholder")
          }
          disabled={rulesets.length === 0}
          value={editingRuleset?.name ?? ""}
          selectedOptions={editingRulesetId ? [editingRulesetId] : []}
          onOptionSelect={(_, d) => setEditingRulesetId(d.optionValue ?? null)}
          style={{ minWidth: 220 }}
        >
          {rulesets.map((r) => (
            <Option key={r.id} value={r.id} text={r.name}>
              {r.name}
              {r.is_active ? " ⭐" : ""}
            </Option>
          ))}
        </Dropdown>
        <Button size="small" onClick={props.onNew} disabled={props.creating}>
          {t("notifications.rulesetsNew")}
        </Button>
        {editingRuleset && (
          <>
            <Button
              size="small"
              appearance={editingRuleset.is_active ? "primary" : "outline"}
              disabled={props.updating}
              onClick={() => props.onToggleActive(editingRuleset)}
            >
              {editingRuleset.is_active
                ? t("notifications.rulesetsDeactivate")
                : t("notifications.rulesetsActivate")}
            </Button>
            <Button
              size="small"
              appearance="subtle"
              disabled={props.updating}
              onClick={() => props.onRename(editingRuleset)}
            >
              {t("notifications.rulesetsRename")}
            </Button>
            <Button
              size="small"
              appearance="subtle"
              disabled={props.deleting}
              onClick={() => props.onDelete(editingRuleset)}
              style={{ color: tokens.colorPaletteRedForeground1 }}
            >
              {t("notifications.rulesetsDelete")}
            </Button>
          </>
        )}
      </div>

      {rulesetMessage && (
        <MessageBar intent={rulesetMessage.intent}>
          <MessageBarBody>{rulesetMessage.text}</MessageBarBody>
        </MessageBar>
      )}

      {editingRuleset && (
        <>
          {draftRules.length === 0 && (
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {t("notifications.rulesetsRulesEmpty")}
            </Text>
          )}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: tokens.spacingVerticalS,
            }}
          >
            {draftRules.map((rule, idx) => (
              <RuleEditorCard
                key={rule.id}
                index={idx}
                rule={rule}
                emails={props.emails}
                tgConnections={props.tgConnections}
                discordConnections={props.discordConnections}
                knownEvents={props.knownEvents}
                isFirst={idx === 0}
                isLast={idx === draftRules.length - 1}
                onPatch={(p) => props.onPatchRule(idx, p)}
                onMove={(d) => props.onMoveRule(idx, d)}
                onDelete={() => props.onDeleteRule(idx)}
              />
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button size="small" onClick={props.onAddRule}>
              {t("notifications.rulesetsAddRule")}
            </Button>
            <Text style={{ flex: 1 }} />
            {draftDirty && (
              <Text
                size={200}
                style={{ color: tokens.colorPaletteMarigoldForeground1 }}
              >
                {t("notifications.rulesetsUnsaved")}
              </Text>
            )}
            <Button
              size="small"
              disabled={!draftDirty || props.updating}
              onClick={props.onDiscardDraft}
            >
              {t("common.discard")}
            </Button>
            <Button
              size="small"
              appearance="primary"
              disabled={!draftDirty || props.updating}
              onClick={props.onSaveDraft}
            >
              {props.updating ? (
                <Spinner size="tiny" />
              ) : (
                t("common.saveChanges")
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function RuleAccountFilter(props: {
  emails: NotifEmail[];
  tgConnections: NotifTgConnection[];
  discordConnections: NotifDiscordConnection[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const all: { key: string; label: string; icon: string }[] = [
    ...props.emails.map((e) => ({
      key: `email:${e.id}`,
      label: e.email,
      icon: "✉",
    })),
    ...props.tgConnections.map((c) => ({
      key: `tg:${c.id}`,
      label: c.username ? `@${c.username}` : c.name,
      icon: "✈",
    })),
    ...props.discordConnections.map((c) => ({
      key: `discord:${c.id}`,
      label: c.username ? `@${c.username}` : c.name,
      icon: "🎮",
    })),
  ];
  const selected = new Set(props.value);
  const empty = props.value.length === 0;

  function toggle(key: string) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    props.onChange([...next]);
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      <Text size={200} style={{ paddingTop: 4 }}>
        {t("notifications.rulesetsMatchAccounts")}
      </Text>
      <div
        style={{
          display: "flex",
          gap: 4,
          flexWrap: "wrap",
          flex: 1,
          minWidth: 0,
        }}
      >
        <Tooltip
          content={t("notifications.rulesetsMatchAccountsAllHint")}
          relationship="description"
        >
          <Button
            size="small"
            shape="circular"
            appearance={empty ? "primary" : "outline"}
            onClick={() => props.onChange([])}
            style={{ fontSize: 11, minWidth: "auto" }}
          >
            {t("notifications.rulesetsMatchAccountsAll")}
          </Button>
        </Tooltip>
        {all.map((acc) => {
          const on = selected.has(acc.key);
          return (
            <Tooltip
              key={acc.key}
              content={acc.label}
              relationship="description"
            >
              <Button
                size="small"
                shape="circular"
                icon={acc.icon}
                appearance={on ? "primary" : "outline"}
                onClick={() => toggle(acc.key)}
                style={{
                  fontSize: 11,
                  minWidth: "auto",
                  maxWidth: 200,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {acc.label}
              </Button>
            </Tooltip>
          );
        })}
        {all.length === 0 && (
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {t("notifications.rulesetsMatchAccountsNone")}
          </Text>
        )}
      </div>
    </div>
  );
}

function RuleEditorCard(props: {
  index: number;
  rule: NotificationRulesetRule;
  emails: NotifEmail[];
  tgConnections: NotifTgConnection[];
  discordConnections: NotifDiscordConnection[];
  knownEvents: string[];
  isFirst: boolean;
  isLast: boolean;
  onPatch: (p: Partial<NotificationRulesetRule>) => void;
  onMove: (delta: number) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { rule } = props;
  const enabled = rule.enabled !== false;
  const sendChannels = rule.action.type === "send" ? rule.action.channels : [];

  function setMatchEvent(ev: string) {
    props.onPatch({ match: { ...rule.match, event: ev } });
  }
  function setActionType(type: "send" | "drop") {
    if (type === "drop") {
      props.onPatch({ action: { type: "drop" } });
    } else {
      props.onPatch({
        action: { type: "send", channels: sendChannels },
      });
    }
  }
  function setChannels(channels: NotificationRuleSendChannel[]) {
    props.onPatch({ action: { type: "send", channels } });
  }
  function addEmailChannel() {
    const first = props.emails[0];
    if (!first) return;
    setChannels([
      ...sendChannels,
      { kind: "email", email_id: first.id, level: "full" },
    ]);
  }
  function addTgChannel() {
    const first = props.tgConnections[0];
    if (!first) return;
    setChannels([
      ...sendChannels,
      { kind: "tg", connection_id: first.id, level: "full" },
    ]);
  }
  function addDiscordChannel() {
    const first = props.discordConnections[0];
    if (!first) return;
    setChannels([
      ...sendChannels,
      { kind: "discord", connection_id: first.id, level: "full" },
    ]);
  }

  return (
    <div
      style={{
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
        padding: tokens.spacingHorizontalM,
        background: enabled
          ? tokens.colorNeutralBackground1
          : tokens.colorNeutralBackground3,
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXS,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          #{props.index + 1}
        </Text>
        <Checkbox
          checked={enabled}
          onChange={(_, d) => props.onPatch({ enabled: !!d.checked })}
          aria-label={t("notifications.rulesetsRuleEnabled")}
        />
        <Input
          size="small"
          value={rule.name ?? ""}
          onChange={(_, d) => props.onPatch({ name: d.value })}
          placeholder={t("notifications.rulesetsRuleNamePlaceholder")}
          style={{ flex: 1 }}
        />
        <Button
          size="small"
          appearance="subtle"
          disabled={props.isFirst}
          onClick={() => props.onMove(-1)}
        >
          ↑
        </Button>
        <Button
          size="small"
          appearance="subtle"
          disabled={props.isLast}
          onClick={() => props.onMove(1)}
        >
          ↓
        </Button>
        <Button
          size="small"
          appearance="subtle"
          onClick={props.onDelete}
          style={{ color: tokens.colorPaletteRedForeground1 }}
        >
          ×
        </Button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Text size={200}>{t("notifications.rulesetsMatchEvent")}</Text>
        <Combobox
          freeform
          size="small"
          value={rule.match.event ?? ""}
          selectedOptions={rule.match.event ? [rule.match.event] : []}
          onInput={(e) => setMatchEvent((e.target as HTMLInputElement).value)}
          onOptionSelect={(_, d) => setMatchEvent(d.optionValue ?? "")}
          placeholder="*  or  security.*  or  app.created"
          input={{ style: { fontFamily: "monospace", fontSize: 12 } }}
          style={{ flex: 1 }}
        >
          {props.knownEvents.map((ev) => (
            <Option key={ev} value={ev}>
              {ev}
            </Option>
          ))}
        </Combobox>
      </div>

      <RuleAccountFilter
        emails={props.emails}
        tgConnections={props.tgConnections}
        discordConnections={props.discordConnections}
        value={rule.match.accounts ?? []}
        onChange={(accounts) =>
          props.onPatch({
            match: {
              ...rule.match,
              accounts: accounts.length > 0 ? accounts : undefined,
            },
          })
        }
      />

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Text size={200}>{t("notifications.rulesetsAction")}</Text>
        <RadioGroup
          layout="horizontal"
          value={rule.action.type}
          onChange={(_, d) => setActionType(d.value as "send" | "drop")}
        >
          <Radio value="send" label={t("notifications.rulesetsActionSend")} />
          <Radio value="drop" label={t("notifications.rulesetsActionDrop")} />
        </RadioGroup>
      </div>

      {rule.action.type === "send" && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            paddingLeft: tokens.spacingHorizontalM,
          }}
        >
          {sendChannels.map((ch, ci) => (
            <RuleChannelRow
              key={ci}
              channel={ch}
              emails={props.emails}
              tgConnections={props.tgConnections}
              discordConnections={props.discordConnections}
              onChange={(next) => {
                const copy = sendChannels.slice();
                copy[ci] = next;
                setChannels(copy);
              }}
              onDelete={() =>
                setChannels(sendChannels.filter((_, i) => i !== ci))
              }
            />
          ))}
          <div style={{ display: "flex", gap: 6 }}>
            <Button
              size="small"
              appearance="subtle"
              onClick={addEmailChannel}
              disabled={props.emails.length === 0}
            >
              + {t("notifications.emailChannel")}
            </Button>
            <Button
              size="small"
              appearance="subtle"
              onClick={addTgChannel}
              disabled={props.tgConnections.length === 0}
            >
              + {t("notifications.tgChannel")}
            </Button>
            <Button
              size="small"
              appearance="subtle"
              onClick={addDiscordChannel}
              disabled={props.discordConnections.length === 0}
            >
              + {t("notifications.discordChannel")}
            </Button>
          </div>
        </div>
      )}

      <Checkbox
        checked={rule.stop === true}
        onChange={(_, d) => props.onPatch({ stop: !!d.checked })}
        label={
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {t("notifications.rulesetsStop")}
          </Text>
        }
      />
    </div>
  );
}

function RuleChannelRow(props: {
  channel: NotificationRuleSendChannel;
  emails: NotifEmail[];
  tgConnections: NotifTgConnection[];
  discordConnections: NotifDiscordConnection[];
  onChange: (next: NotificationRuleSendChannel) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { channel } = props;
  const setLevel = (level: NotificationLevel) =>
    props.onChange({ ...channel, level });
  const channelIcon =
    channel.kind === "email" ? "✉" : channel.kind === "discord" ? "🎮" : "✈";
  const accountConnections =
    channel.kind === "discord" ? props.discordConnections : props.tgConnections;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <Text size={200}>{channelIcon}</Text>
      <Dropdown
        size="small"
        value={
          channel.kind === "email"
            ? (props.emails.find((e) => e.id === channel.email_id)?.email ?? "")
            : (() => {
                const c = accountConnections.find(
                  (c) => c.id === channel.connection_id,
                );
                return c ? (c.username ? `@${c.username}` : c.name) : "";
              })()
        }
        selectedOptions={[
          channel.kind === "email" ? channel.email_id : channel.connection_id,
        ]}
        onOptionSelect={(_, d) => {
          const value = d.optionValue ?? "";
          if (channel.kind === "email") {
            props.onChange({ ...channel, email_id: value });
          } else {
            props.onChange({ ...channel, connection_id: value });
          }
        }}
        style={{ flex: 1, minWidth: 0 }}
      >
        {channel.kind === "email"
          ? props.emails.map((e) => (
              <Option key={e.id} value={e.id} text={e.email}>
                {e.email}
              </Option>
            ))
          : accountConnections.map((c) => {
              const label = c.username ? `@${c.username}` : c.name;
              return (
                <Option key={c.id} value={c.id} text={label}>
                  {label}
                </Option>
              );
            })}
      </Dropdown>
      <Dropdown
        size="small"
        value={
          channel.level === "brief"
            ? t("notifications.levelBrief")
            : t("notifications.levelFull")
        }
        selectedOptions={[channel.level]}
        onOptionSelect={(_, d) =>
          setLevel((d.optionValue ?? "brief") as NotificationLevel)
        }
      >
        <Option value="brief" text={t("notifications.levelBrief")}>
          {t("notifications.levelBrief")}
        </Option>
        <Option value="full" text={t("notifications.levelFull")}>
          {t("notifications.levelFull")}
        </Option>
      </Dropdown>
      <Button
        size="small"
        appearance="subtle"
        onClick={props.onDelete}
        style={{ color: tokens.colorPaletteRedForeground1 }}
      >
        ×
      </Button>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Notifications() {
  const api = useApi();
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
  const hasDiscordBot = !!site?.discord_notify_source_slug;
  const emails: NotifEmail[] = data?.emails ?? [];
  const tgConnections: NotifTgConnection[] = data?.tg_connections ?? [];
  const discordConnections: NotifDiscordConnection[] =
    data?.discord_connections ?? [];
  const showTg = tgConnections.length > 0;
  // Discord DM routing is only offered when the admin enabled a Discord bot
  // AND the user has linked at least one Discord account.
  const showDiscord = hasDiscordBot && discordConnections.length > 0;

  const [rules, setRules] = useState<NotificationRules>({});
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  // ─── Rulesets (rule engine) ─────────────────────────────────────────────
  // The server-side dispatch evaluates the active ruleset INSTEAD of the
  // legacy per-event prefs. The editor below mutates a local draft per
  // ruleset; saving PUTs the rule array. Activating one ruleset
  // automatically deactivates any other.
  const [editingRulesetId, setEditingRulesetId] = useState<string | null>(null);
  const [draftRules, setDraftRules] = useState<NotificationRulesetRule[]>([]);
  // Dialog state for ruleset name input (replaces window.prompt) and
  // delete confirmation (replaces window.confirm).
  const [nameDialog, setNameDialog] = useState<
    | { mode: "new"; value: string }
    | { mode: "rename"; ruleset: NotificationRuleset; value: string }
    | null
  >(null);
  const [deleteDialog, setDeleteDialog] = useState<NotificationRuleset | null>(
    null,
  );
  // Compound key: the editor re-syncs whenever the open ruleset changes
  // OR when the server's authoritative copy of the open one is newer
  // (e.g. immediately after Save).
  const [draftSourceKey, setDraftSourceKey] = useState<string | null>(null);
  const [rulesetMessage, setRulesetMessage] = useState<{
    intent: "success" | "error";
    text: string;
  } | null>(null);
  const showRulesetMsg = (intent: "success" | "error", text: string) => {
    setRulesetMessage({ intent, text });
    setTimeout(() => setRulesetMessage(null), 3500);
  };

  const { data: rulesetsData } = useQuery({
    queryKey: ["notification-rulesets"],
    queryFn: () => api.listNotificationRulesets(),
  });
  const rulesets: NotificationRuleset[] = rulesetsData?.rulesets ?? [];
  const editingRuleset =
    rulesets.find((r) => r.id === editingRulesetId) ?? null;
  const activeRuleset = rulesets.find((r) => r.is_active) ?? null;

  // Render-time sync of the editor's draft to the server's authoritative
  // rules whenever the user opens a different ruleset OR the server's
  // copy of the open one changed (e.g. after save).
  const targetKey = editingRuleset
    ? `${editingRuleset.id}@${editingRuleset.updated_at}`
    : null;
  if (editingRuleset && draftSourceKey !== targetKey) {
    setDraftSourceKey(targetKey);
    setDraftRules(editingRuleset.rules);
  }
  const draftDirty =
    !!editingRuleset &&
    JSON.stringify(draftRules) !== JSON.stringify(editingRuleset.rules);

  const createRulesetMut = useMutation({
    mutationFn: (body: {
      name: string;
      rules: NotificationRulesetRule[];
      is_active?: boolean;
    }) => api.createNotificationRuleset(body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["notification-rulesets"] });
      setEditingRulesetId(res.ruleset.id);
      setDraftSourceKey(null);
      showRulesetMsg("success", t("notifications.rulesetsCreated"));
    },
    onError: (err) => {
      showRulesetMsg(
        "error",
        err instanceof ApiError
          ? err.message
          : t("notifications.rulesetsSaveFailed"),
      );
    },
  });
  const updateRulesetMut = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: {
        name?: string;
        rules?: NotificationRulesetRule[];
        is_active?: boolean;
      };
    }) => api.updateNotificationRuleset(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-rulesets"] });
      setDraftSourceKey(null);
      showRulesetMsg("success", t("notifications.rulesetsUpdated"));
    },
    onError: (err) => {
      showRulesetMsg(
        "error",
        err instanceof ApiError
          ? err.message
          : t("notifications.rulesetsSaveFailed"),
      );
    },
  });
  const deleteRulesetMut = useMutation({
    mutationFn: (id: string) => api.deleteNotificationRuleset(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-rulesets"] });
      setEditingRulesetId(null);
      setDraftSourceKey(null);
      showRulesetMsg("success", t("notifications.rulesetsDeleted"));
    },
    onError: (err) => {
      showRulesetMsg(
        "error",
        err instanceof ApiError
          ? err.message
          : t("notifications.rulesetsSaveFailed"),
      );
    },
  });

  function handleNewRuleset() {
    setNameDialog({ mode: "new", value: "" });
  }

  function handleRenameRuleset(rs: NotificationRuleset) {
    setNameDialog({ mode: "rename", ruleset: rs, value: rs.name });
  }

  function handleDeleteRuleset(rs: NotificationRuleset) {
    setDeleteDialog(rs);
  }

  function submitNameDialog() {
    if (!nameDialog) return;
    const name = nameDialog.value.trim();
    if (!name) return;
    if (nameDialog.mode === "new") {
      createRulesetMut.mutate({ name, rules: [], is_active: false });
    } else if (name !== nameDialog.ruleset.name) {
      updateRulesetMut.mutate({
        id: nameDialog.ruleset.id,
        body: { name },
      });
    }
    setNameDialog(null);
  }

  function handleToggleActive(rs: NotificationRuleset) {
    updateRulesetMut.mutate({
      id: rs.id,
      body: { is_active: !rs.is_active },
    });
  }

  function handleSaveDraft() {
    if (!editingRuleset) return;
    updateRulesetMut.mutate({
      id: editingRuleset.id,
      body: { rules: draftRules },
    });
  }

  function handleDiscardDraft() {
    if (!editingRuleset) return;
    setDraftRules(editingRuleset.rules);
  }

  // Rule-array editing helpers operate on draftRules.
  function newRule(): NotificationRulesetRule {
    return {
      id: `r_${Math.random().toString(36).slice(2, 10)}`,
      enabled: true,
      match: { event: "*" },
      action: { type: "send", channels: [] },
    };
  }

  function patchDraftRule(
    idx: number,
    patch: Partial<NotificationRulesetRule>,
  ) {
    setDraftRules((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    );
  }

  function moveDraftRule(idx: number, delta: number) {
    setDraftRules((prev) => {
      const next = prev.slice();
      const target = idx + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  function deleteDraftRule(idx: number) {
    setDraftRules((prev) => prev.filter((_, i) => i !== idx));
  }

  function addDraftRule() {
    setDraftRules((prev) => [...prev, newRule()]);
  }

  // Sync server data into the local draft when it changes. React 19's
  // strict rules want this expressed as a render-time set rather than an
  // effect — guarded by an identity ref to avoid the infinite loop.
  const [syncedData, setSyncedData] = useState<typeof data>(undefined);
  if (data && data !== syncedData) {
    setSyncedData(data);
    setRules(data.rules ?? {});
    setDirty(false);
  }

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
        const rest = (curr.tg ?? []).filter(
          (r) => r.connection_id !== connectionId,
        );
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

  function applyBulkDiscord(
    eventKeys: string[],
    level: "brief" | "full" | null,
  ) {
    setRules((prev) => {
      const next = { ...prev };
      for (const ev of eventKeys)
        next[ev] = {
          ...(next[ev] ?? {}),
          discord: level
            ? discordConnections.map((c) => ({ connection_id: c.id, level }))
            : [],
        };
      return next;
    });
    setDirty(true);
    setSaved(false);
  }

  function applyBulkDiscordAccount(
    eventKeys: string[],
    connectionId: string,
    level: "brief" | "full" | null,
  ) {
    setRules((prev) => {
      const next = { ...prev };
      for (const ev of eventKeys) {
        const curr = next[ev] ?? {};
        const rest = (curr.discord ?? []).filter(
          (r) => r.connection_id !== connectionId,
        );
        next[ev] = {
          ...curr,
          discord: level
            ? [...rest, { connection_id: connectionId, level }]
            : rest,
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

  function setDiscordChannel(event: string, value: NotificationDiscordRule[]) {
    setRules((prev) => ({
      ...prev,
      [event]: { ...(prev[event] ?? {}), discord: value },
    }));
    setDirty(true);
    setSaved(false);
  }

  if (isLoading) return <SkeletonToggleRows rows={8} />;

  return (
    <div className={styles.root}>
      <PageHeader
        title={t("notifications.title")}
        subtitle={t("notifications.subtitle")}
        style={{ marginBottom: 0 }}
      />

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

      {hasDiscordBot && discordConnections.length === 0 && (
        <MessageBar intent="info">
          <MessageBarBody>{t("notifications.discordNoAccount")}</MessageBarBody>
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

      <RulesetSection
        rulesets={rulesets}
        editingRuleset={editingRuleset}
        editingRulesetId={editingRulesetId}
        setEditingRulesetId={setEditingRulesetId}
        activeRuleset={activeRuleset}
        draftRules={draftRules}
        draftDirty={draftDirty}
        emails={emails}
        tgConnections={tgConnections}
        discordConnections={showDiscord ? discordConnections : []}
        rulesetMessage={rulesetMessage}
        creating={createRulesetMut.isPending}
        updating={updateRulesetMut.isPending}
        deleting={deleteRulesetMut.isPending}
        knownEvents={ALL_EVENT_KEYS}
        onNew={handleNewRuleset}
        onRename={handleRenameRuleset}
        onDelete={handleDeleteRuleset}
        onToggleActive={handleToggleActive}
        onSaveDraft={handleSaveDraft}
        onDiscardDraft={handleDiscardDraft}
        onPatchRule={patchDraftRule}
        onMoveRule={moveDraftRule}
        onDeleteRule={deleteDraftRule}
        onAddRule={addDraftRule}
      />

      {activeRuleset && (
        <MessageBar intent="info">
          <MessageBarBody>
            {t("notifications.rulesetActiveOverride", {
              name: activeRuleset.name,
            })}
          </MessageBarBody>
        </MessageBar>
      )}

      {(emails.length > 0 || showTg || showDiscord) && (
        <div className={styles.selectAllRow}>
          <Text className={styles.selectAllLabel}>
            {t("notifications.selectAll")}
          </Text>
          <BulkLevelControls
            eventKeys={ALL_EVENT_KEYS}
            rules={rules}
            emailLevel={getUniformEmailLevel(ALL_EVENT_KEYS, rules, emails)}
            tgLevel={getUniformTgLevel(ALL_EVENT_KEYS, rules, tgConnections)}
            discordLevel={getUniformDiscordLevel(
              ALL_EVENT_KEYS,
              rules,
              discordConnections,
            )}
            emails={emails}
            connections={tgConnections}
            discordConnections={discordConnections}
            showTg={showTg}
            showDiscord={showDiscord}
            onEmail={(l) => applyBulkEmail(ALL_EVENT_KEYS, l)}
            onTg={(l) => applyBulkTg(ALL_EVENT_KEYS, l)}
            onDiscord={(l) => applyBulkDiscord(ALL_EVENT_KEYS, l)}
            onEmailAccount={(emailId, l) =>
              applyBulkEmailAccount(ALL_EVENT_KEYS, emailId, l)
            }
            onTgAccount={(connectionId, l) =>
              applyBulkTgAccount(ALL_EVENT_KEYS, connectionId, l)
            }
            onDiscordAccount={(connectionId, l) =>
              applyBulkDiscordAccount(ALL_EVENT_KEYS, connectionId, l)
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
                discordLevel={getUniformDiscordLevel(
                  groupKeys,
                  rules,
                  discordConnections,
                )}
                emails={emails}
                connections={tgConnections}
                discordConnections={discordConnections}
                showTg={showTg}
                showDiscord={showDiscord}
                onEmail={(l) => applyBulkEmail(groupKeys, l)}
                onTg={(l) => applyBulkTg(groupKeys, l)}
                onDiscord={(l) => applyBulkDiscord(groupKeys, l)}
                onEmailAccount={(emailId, l) =>
                  applyBulkEmailAccount(groupKeys, emailId, l)
                }
                onTgAccount={(connectionId, l) =>
                  applyBulkTgAccount(groupKeys, connectionId, l)
                }
                onDiscordAccount={(connectionId, l) =>
                  applyBulkDiscordAccount(groupKeys, connectionId, l)
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
                    {showDiscord && (
                      <DiscordChannelPicker
                        value={rule.discord ?? []}
                        connections={discordConnections}
                        onChange={(v) => setDiscordChannel(entry.value, v)}
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

      <Dialog
        open={nameDialog !== null}
        onOpenChange={(_, d) => {
          if (!d.open) setNameDialog(null);
        }}
      >
        <DialogSurface>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitNameDialog();
            }}
          >
            <DialogBody>
              <DialogTitle>
                {nameDialog?.mode === "rename"
                  ? t("notifications.rulesetsRename")
                  : t("notifications.rulesetsNew")}
              </DialogTitle>
              <DialogContent>
                <Field
                  label={
                    nameDialog?.mode === "rename"
                      ? t("notifications.rulesetsRenamePrompt", {
                          name: nameDialog.ruleset.name,
                        })
                      : t("notifications.rulesetsNamePrompt")
                  }
                >
                  <Input
                    autoFocus
                    value={nameDialog?.value ?? ""}
                    onChange={(_, d) =>
                      setNameDialog((prev) =>
                        prev ? { ...prev, value: d.value } : prev,
                      )
                    }
                  />
                </Field>
              </DialogContent>
              <DialogActions>
                <DialogTrigger disableButtonEnhancement>
                  <Button type="button">{t("common.cancel")}</Button>
                </DialogTrigger>
                <Button
                  type="submit"
                  appearance="primary"
                  disabled={!nameDialog?.value.trim()}
                >
                  {nameDialog?.mode === "rename"
                    ? t("common.save")
                    : t("common.create")}
                </Button>
              </DialogActions>
            </DialogBody>
          </form>
        </DialogSurface>
      </Dialog>

      <Dialog
        open={deleteDialog !== null}
        onOpenChange={(_, d) => {
          if (!d.open) setDeleteDialog(null);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("notifications.rulesetsDelete")}</DialogTitle>
            <DialogContent>
              {deleteDialog &&
                t("notifications.rulesetsDeleteConfirm", {
                  name: deleteDialog.name,
                })}
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button>{t("common.cancel")}</Button>
              </DialogTrigger>
              <Button
                appearance="primary"
                style={{ background: tokens.colorPaletteRedBackground3 }}
                onClick={() => {
                  if (deleteDialog) deleteRulesetMut.mutate(deleteDialog.id);
                  setDeleteDialog(null);
                }}
              >
                {t("common.delete")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
