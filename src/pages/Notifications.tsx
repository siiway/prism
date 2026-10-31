// Notification preferences. Two parts:
//
// - Events: one table with a row per event and a column per destination
//   (each verified email, linked Telegram and Discord account), each cell a
//   compact Off / Brief / Full picker. Group rows and an "All events" row set
//   a whole column at once.
// - Rulesets: conditional rules ("if the event matches X, send to Y at level
//   Z"). While one is active it replaces the per-event table at dispatch time.

import {
  Badge,
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
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  Option,
  Radio,
  RadioGroup,
  Spinner,
  Subtitle2,
  Text,
  Textarea,
  ToggleButton,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  ArrowDownRegular,
  ArrowUpRegular,
  ChatRegular,
  CheckmarkRegular,
  CodeRegular,
  DeleteRegular,
  DismissRegular,
  MailRegular,
  MoreHorizontalRegular,
  SendRegular,
  type FluentIcon,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import { useApi } from "../lib/api-context";
import { PageHeader } from "../components/PageHeader";
import { Segmented, type SegmentedOption } from "../components/Segmented";
import type {
  NotificationRules,
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

// ─── Destinations ────────────────────────────────────────────────────────────

type DestKind = "email" | "tg" | "discord";

/** Somewhere a notification can be delivered: one table column. */
interface Destination {
  kind: DestKind;
  id: string;
  label: string;
}

const DEST_ICONS: Record<DestKind, FluentIcon> = {
  email: MailRegular,
  tg: SendRegular,
  discord: ChatRegular,
};

const DEST_KIND_KEYS: Record<DestKind, string> = {
  email: "notifications.emailChannel",
  tg: "notifications.tgChannel",
  discord: "notifications.discordChannel",
};

function connectionLabel(c: { username: string | null; name: string }) {
  return c.username ? `@${c.username}` : c.name;
}

type LevelChoice = "off" | NotificationLevel;

function getLevel(
  rules: NotificationRules,
  event: string,
  dest: Destination,
): LevelChoice {
  const rule = rules[event];
  if (!rule) return "off";
  if (dest.kind === "email") {
    return rule.email?.find((r) => r.email_id === dest.id)?.level ?? "off";
  }
  const list = dest.kind === "tg" ? rule.tg : rule.discord;
  return list?.find((r) => r.connection_id === dest.id)?.level ?? "off";
}

/** The level shared by every event in `events`, or null when they differ. */
function uniformLevel(
  rules: NotificationRules,
  events: string[],
  dest: Destination,
): LevelChoice | null {
  const first = getLevel(rules, events[0], dest);
  return events.every((ev) => getLevel(rules, ev, dest) === first)
    ? first
    : null;
}

function withLevel(
  rules: NotificationRules,
  events: string[],
  dest: Destination,
  choice: LevelChoice,
): NotificationRules {
  const level = choice === "off" ? null : choice;
  const next = { ...rules };
  for (const ev of events) {
    const cur = next[ev] ?? {};
    if (dest.kind === "email") {
      const rest = (cur.email ?? []).filter((r) => r.email_id !== dest.id);
      next[ev] = {
        ...cur,
        email: level ? [...rest, { email_id: dest.id, level }] : rest,
      };
    } else {
      const key = dest.kind;
      const rest = (cur[key] ?? []).filter((r) => r.connection_id !== dest.id);
      next[ev] = {
        ...cur,
        [key]: level ? [...rest, { connection_id: dest.id, level }] : rest,
      };
    }
  }
  return next;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const DEST_WIDTH = "172px";
const NARROW = "@media (max-width: 640px)";

const useStyles = makeStyles({
  root: {
    maxWidth: "960px",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  card: {
    "--card-pad": "24px",
    [NARROW]: { "--card-pad": "16px" },
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusXLarge,
    background: tokens.colorNeutralBackground1,
  },
  cardHead: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "12px 16px",
    padding: "20px var(--card-pad) 16px",
  },
  cardTitles: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    flex: "1 1 320px",
    minWidth: 0,
  },
  muted: {
    color: tokens.colorNeutralForeground3,
  },
  cardNotice: {
    padding: "0 var(--card-pad) 16px",
  },
  cardEmpty: {
    padding: "16px var(--card-pad) 20px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground3,
  },

  // Event table. Every destination cell has the same fixed width, so the
  // columns line up without a real <table> and rows can still wrap on phones.
  row: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    minHeight: "56px",
    padding: "10px var(--card-pad)",
    boxSizing: "border-box",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    [NARROW]: {
      flexWrap: "wrap",
      gap: "8px 12px",
    },
  },
  headRow: {
    minHeight: "36px",
    padding: "6px var(--card-pad)",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    [NARROW]: { display: "none" },
  },
  groupRow: {
    minHeight: "48px",
    background: tokens.colorNeutralBackground2,
  },
  eventCell: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    [NARROW]: { flexBasis: "100%" },
  },
  destCell: {
    width: DEST_WIDTH,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    [NARROW]: {
      width: "auto",
      flex: `1 1 ${DEST_WIDTH}`,
    },
  },
  destHead: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
    "& svg": { fontSize: "14px", flexShrink: 0 },
  },
  // Repeats the column header inside each cell on phones, where the header
  // row is hidden.
  destCellLabel: {
    display: "none",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    [NARROW]: { display: "flex" },
  },
  truncate: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  footer: {
    position: "sticky",
    bottom: 0,
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "8px",
    padding: "12px var(--card-pad)",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    borderBottomLeftRadius: tokens.borderRadiusXLarge,
    borderBottomRightRadius: tokens.borderRadiusXLarge,
    background: tokens.colorNeutralBackground1,
  },
  footerStatus: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginRight: "auto",
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground3,
  },
  footerStatusOk: {
    color: tokens.colorStatusSuccessForeground1,
  },

  // Rulesets
  rsRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "8px",
    minHeight: "52px",
    padding: "8px var(--card-pad)",
    boxSizing: "border-box",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  rsName: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flex: 1,
    minWidth: 0,
  },
  editor: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    padding: "16px var(--card-pad) 20px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground2,
  },
  editorLast: {
    borderBottomLeftRadius: tokens.borderRadiusXLarge,
    borderBottomRightRadius: tokens.borderRadiusXLarge,
  },
  editorFooter: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "8px",
  },
  unsaved: {
    marginLeft: "auto",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  rule: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    padding: "12px 16px 14px",
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground1,
  },
  ruleOff: {
    "& > :not(:first-child)": { opacity: 0.55 },
  },
  ruleTop: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
  },
  ruleIndex: {
    minWidth: "24px",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    fontVariantNumeric: "tabular-nums",
  },
  ruleName: {
    flex: 1,
    minWidth: 0,
    marginRight: "4px",
  },
  ruleGrid: {
    display: "grid",
    gridTemplateColumns: "88px minmax(0, 1fr)",
    alignItems: "center",
    gap: "10px 12px",
    [NARROW]: {
      gridTemplateColumns: "minmax(0, 1fr)",
      gap: "6px",
    },
  },
  fieldLabel: {
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground3,
  },
  fieldLabelTop: {
    alignSelf: "start",
    paddingTop: "6px",
  },
  fill: {
    width: "100%",
    minWidth: 0,
  },
  chips: {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px",
  },
  chip: {
    maxWidth: "220px",
    minWidth: "auto",
    fontWeight: tokens.fontWeightRegular,
  },
  actionBox: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  channelRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    "& > svg": {
      fontSize: "16px",
      flexShrink: 0,
      color: tokens.colorNeutralForeground3,
    },
  },
  channelAccount: {
    flex: 1,
    minWidth: 0,
  },
  addChannels: {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px",
  },
  jsonSurface: {
    maxWidth: "720px",
  },
  jsonInput: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
});

// ─── Events table ────────────────────────────────────────────────────────────

function DestHead({ dest }: { dest: Destination }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const Icon = DEST_ICONS[dest.kind];
  return (
    <span
      className={styles.destHead}
      title={`${t(DEST_KIND_KEYS[dest.kind])} · ${dest.label}`}
    >
      <Icon aria-hidden />
      <span className={styles.truncate}>{dest.label}</span>
    </span>
  );
}

function LevelCell({
  dest,
  label,
  showLabel,
  value,
  onChange,
}: {
  dest: Destination;
  label: string;
  /** Repeat the destination above the picker on phones (several columns). */
  showLabel: boolean;
  value: LevelChoice | null;
  onChange: (value: LevelChoice) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const options: SegmentedOption<LevelChoice>[] = [
    { value: "off", label: t("notifications.levelOff") },
    { value: "brief", label: t("notifications.levelBrief"), brand: true },
    { value: "full", label: t("notifications.levelFull"), brand: true },
  ];
  return (
    <div className={styles.destCell}>
      {showLabel && (
        <span className={styles.destCellLabel}>
          <DestHead dest={dest} />
        </span>
      )}
      <Segmented<LevelChoice>
        fill
        label={`${label}: ${dest.label}`}
        value={value}
        options={options}
        onChange={onChange}
      />
    </div>
  );
}

// ─── Ruleset editor ──────────────────────────────────────────────────────────
//
// A ruleset is an ordered list of rules, each with a match (an event glob:
// "*", "security.*", … and optionally a set of accounts) and an action (mute,
// or send to one or more destinations at a level). Disabled rules are
// skipped; "stop" halts evaluation after a match.

function RuleAccountFilter(props: {
  destinations: Destination[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const selected = new Set(props.value);

  function toggle(key: string) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    props.onChange([...next]);
  }

  if (props.destinations.length === 0) {
    return (
      <Text size={200} className={styles.muted}>
        {t("notifications.rulesetsMatchAccountsNone")}
      </Text>
    );
  }

  return (
    <div className={styles.chips}>
      <Tooltip
        content={t("notifications.rulesetsMatchAccountsAllHint")}
        relationship="description"
      >
        <ToggleButton
          size="small"
          shape="circular"
          className={styles.chip}
          checked={props.value.length === 0}
          onClick={() => props.onChange([])}
        >
          {t("notifications.rulesetsMatchAccountsAll")}
        </ToggleButton>
      </Tooltip>
      {props.destinations.map((d) => {
        const key = `${d.kind}:${d.id}`;
        const Icon = DEST_ICONS[d.kind];
        return (
          <ToggleButton
            key={key}
            size="small"
            shape="circular"
            className={styles.chip}
            icon={<Icon />}
            checked={selected.has(key)}
            onClick={() => toggle(key)}
            title={d.label}
          >
            <span className={styles.truncate}>{d.label}</span>
          </ToggleButton>
        );
      })}
    </div>
  );
}

function RuleChannelRow(props: {
  channel: NotificationRuleSendChannel;
  destinations: Destination[];
  onChange: (next: NotificationRuleSendChannel) => void;
  onDelete: () => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const { channel } = props;
  const accountId =
    channel.kind === "email" ? channel.email_id : channel.connection_id;
  const choices = props.destinations.filter((d) => d.kind === channel.kind);
  const current = choices.find((d) => d.id === accountId);
  const Icon = DEST_ICONS[channel.kind];
  return (
    <div className={styles.channelRow}>
      <Icon aria-label={t(DEST_KIND_KEYS[channel.kind])} />
      <Dropdown
        size="small"
        className={styles.channelAccount}
        value={current?.label ?? ""}
        selectedOptions={[accountId]}
        onOptionSelect={(_, d) => {
          const value = d.optionValue ?? "";
          props.onChange(
            channel.kind === "email"
              ? { ...channel, email_id: value }
              : { ...channel, connection_id: value },
          );
        }}
      >
        {choices.map((d) => (
          <Option key={d.id} value={d.id} text={d.label}>
            {d.label}
          </Option>
        ))}
      </Dropdown>
      <Segmented<NotificationLevel>
        label={t("notifications.levelLabel")}
        value={channel.level}
        options={[
          { value: "brief", label: t("notifications.levelBrief") },
          { value: "full", label: t("notifications.levelFull") },
        ]}
        onChange={(level) => props.onChange({ ...channel, level })}
      />
      <Tooltip
        content={t("notifications.rulesetsRemoveDestination")}
        relationship="label"
      >
        <Button
          size="small"
          appearance="subtle"
          icon={<DismissRegular />}
          onClick={props.onDelete}
        />
      </Tooltip>
    </div>
  );
}

function RuleEditor(props: {
  index: number;
  rule: NotificationRulesetRule;
  destinations: Destination[];
  knownEvents: string[];
  isFirst: boolean;
  isLast: boolean;
  onPatch: (p: Partial<NotificationRulesetRule>) => void;
  onMove: (delta: number) => void;
  onDelete: () => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const { rule } = props;
  const enabled = rule.enabled !== false;
  const sendChannels = rule.action.type === "send" ? rule.action.channels : [];

  function setMatchEvent(ev: string) {
    props.onPatch({ match: { ...rule.match, event: ev } });
  }
  function setActionType(type: "send" | "drop") {
    props.onPatch({
      action:
        type === "drop"
          ? { type: "drop" }
          : { type: "send", channels: sendChannels },
    });
  }
  function setChannels(channels: NotificationRuleSendChannel[]) {
    props.onPatch({ action: { type: "send", channels } });
  }
  function addChannel(kind: DestKind) {
    const first = props.destinations.find((d) => d.kind === kind);
    if (!first) return;
    setChannels([
      ...sendChannels,
      kind === "email"
        ? { kind, email_id: first.id, level: "full" }
        : { kind, connection_id: first.id, level: "full" },
    ]);
  }
  const kinds = (["email", "tg", "discord"] as const).filter((k) =>
    props.destinations.some((d) => d.kind === k),
  );

  return (
    <div className={mergeClasses(styles.rule, !enabled && styles.ruleOff)}>
      <div className={styles.ruleTop}>
        <span className={styles.ruleIndex}>{props.index + 1}</span>
        <Checkbox
          checked={enabled}
          onChange={(_, d) => props.onPatch({ enabled: !!d.checked })}
          aria-label={t("notifications.rulesetsRuleEnabled")}
        />
        <Input
          size="small"
          className={styles.ruleName}
          value={rule.name ?? ""}
          onChange={(_, d) => props.onPatch({ name: d.value })}
          placeholder={t("notifications.rulesetsRuleNamePlaceholder")}
        />
        <Tooltip
          content={t("notifications.rulesetsMoveUp")}
          relationship="label"
        >
          <Button
            size="small"
            appearance="subtle"
            icon={<ArrowUpRegular />}
            disabled={props.isFirst}
            onClick={() => props.onMove(-1)}
          />
        </Tooltip>
        <Tooltip
          content={t("notifications.rulesetsMoveDown")}
          relationship="label"
        >
          <Button
            size="small"
            appearance="subtle"
            icon={<ArrowDownRegular />}
            disabled={props.isLast}
            onClick={() => props.onMove(1)}
          />
        </Tooltip>
        <Tooltip
          content={t("notifications.rulesetsRemoveRule")}
          relationship="label"
        >
          <Button
            size="small"
            appearance="subtle"
            icon={<DeleteRegular />}
            onClick={props.onDelete}
          />
        </Tooltip>
      </div>

      <div className={styles.ruleGrid}>
        <Text className={styles.fieldLabel}>
          {t("notifications.rulesetsFieldEvent")}
        </Text>
        <Combobox
          freeform
          size="small"
          className={styles.fill}
          value={rule.match.event ?? ""}
          selectedOptions={rule.match.event ? [rule.match.event] : []}
          onInput={(e) => setMatchEvent((e.target as HTMLInputElement).value)}
          onOptionSelect={(_, d) => setMatchEvent(d.optionValue ?? "")}
          placeholder="*  ·  security.*  ·  app.created"
          input={{ className: styles.jsonInput }}
        >
          {props.knownEvents.map((ev) => (
            <Option key={ev} value={ev}>
              {ev}
            </Option>
          ))}
        </Combobox>

        <Text className={mergeClasses(styles.fieldLabel, styles.fieldLabelTop)}>
          {t("notifications.rulesetsFieldAccounts")}
        </Text>
        <RuleAccountFilter
          destinations={props.destinations}
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

        <Text className={mergeClasses(styles.fieldLabel, styles.fieldLabelTop)}>
          {t("notifications.rulesetsFieldAction")}
        </Text>
        <div className={styles.actionBox}>
          <RadioGroup
            layout="horizontal"
            value={rule.action.type}
            onChange={(_, d) => setActionType(d.value as "send" | "drop")}
          >
            <Radio value="send" label={t("notifications.rulesetsActionSend")} />
            <Radio value="drop" label={t("notifications.rulesetsActionDrop")} />
          </RadioGroup>
          {rule.action.type === "send" && (
            <>
              {sendChannels.map((ch, ci) => (
                <RuleChannelRow
                  key={ci}
                  channel={ch}
                  destinations={props.destinations}
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
              {kinds.length > 0 && (
                <div className={styles.addChannels}>
                  {kinds.map((kind) => (
                    <Button
                      key={kind}
                      size="small"
                      appearance="subtle"
                      icon={<AddRegular />}
                      onClick={() => addChannel(kind)}
                    >
                      {t(DEST_KIND_KEYS[kind])}
                    </Button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <Checkbox
        checked={rule.stop === true}
        onChange={(_, d) => props.onPatch({ stop: !!d.checked })}
        label={t("notifications.rulesetsStop")}
      />
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function Notifications() {
  const api = useApi();
  const { t } = useTranslation();
  const styles = useStyles();
  const qc = useQueryClient();
  const navigate = useNavigate();

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

  const destinations: Destination[] = [
    ...emails.map((e) => ({
      kind: "email" as const,
      id: e.id,
      label: e.email,
    })),
    ...(showTg ? tgConnections : []).map((c) => ({
      kind: "tg" as const,
      id: c.id,
      label: connectionLabel(c),
    })),
    ...(showDiscord ? discordConnections : []).map((c) => ({
      kind: "discord" as const,
      id: c.id,
      label: connectionLabel(c),
    })),
  ];

  const [rules, setRules] = useState<NotificationRules>({});
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  // ─── Rulesets (rule engine) ─────────────────────────────────────────────
  // The server-side dispatch evaluates the active ruleset INSTEAD of the
  // per-event prefs. The editor mutates a local draft of the open ruleset;
  // saving PUTs the rule array. Activating one ruleset deactivates any
  // other.
  const [editingRulesetId, setEditingRulesetId] = useState<string | null>(null);
  const [draftRules, setDraftRules] = useState<NotificationRulesetRule[]>([]);
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

  const rulesetError = (err: unknown) =>
    showRulesetMsg(
      "error",
      err instanceof ApiError
        ? err.message
        : t("notifications.rulesetsSaveFailed"),
    );

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
    onError: rulesetError,
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
    onError: rulesetError,
  });
  const deleteRulesetMut = useMutation({
    mutationFn: (id: string) => api.deleteNotificationRuleset(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-rulesets"] });
      setEditingRulesetId(null);
      setDraftSourceKey(null);
      showRulesetMsg("success", t("notifications.rulesetsDeleted"));
    },
    onError: rulesetError,
  });

  function submitNameDialog() {
    if (!nameDialog) return;
    const name = nameDialog.value.trim();
    if (!name) return;
    if (nameDialog.mode === "new") {
      createRulesetMut.mutate({ name, rules: [], is_active: false });
    } else if (name !== nameDialog.ruleset.name) {
      updateRulesetMut.mutate({ id: nameDialog.ruleset.id, body: { name } });
    }
    setNameDialog(null);
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

  function addDraftRule() {
    setDraftRules((prev) => [
      ...prev,
      {
        id: `r_${Math.random().toString(36).slice(2, 10)}`,
        enabled: true,
        match: { event: "*" },
        action: { type: "send", channels: [] },
      },
    ]);
  }

  // Sync server data into the local draft when it changes. React 19's
  // strict rules want this expressed as a render-time set rather than an
  // effect — guarded by an identity check to avoid the infinite loop.
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

  function updateRules(next: NotificationRules) {
    setRules(next);
    setDirty(true);
    setSaved(false);
  }

  function discardRules() {
    setRules(data?.rules ?? {});
    setDirty(false);
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
      updateRules(parsed);
      setJsonOpen(false);
      setJsonError(null);
    } catch (e) {
      setJsonError((e as Error).message);
    }
  }

  if (isLoading) return <SkeletonToggleRows rows={8} />;

  const levelRow = (
    key: string,
    title: string,
    description: string | null,
    events: string[],
    className?: string,
  ) => (
    <div key={key} className={mergeClasses(styles.row, className)}>
      <div className={styles.eventCell}>
        <Text weight={description === null ? "semibold" : "regular"}>
          {title}
        </Text>
        {description && (
          <Text size={200} className={styles.muted}>
            {description}
          </Text>
        )}
      </div>
      {destinations.map((dest) => (
        <LevelCell
          key={`${dest.kind}:${dest.id}`}
          dest={dest}
          label={title}
          showLabel={destinations.length > 1}
          value={
            events.length === 1
              ? getLevel(rules, events[0], dest)
              : uniformLevel(rules, events, dest)
          }
          onChange={(choice) =>
            updateRules(withLevel(rules, events, dest, choice))
          }
        />
      ))}
    </div>
  );

  return (
    <div className={styles.root}>
      <PageHeader
        title={t("notifications.title")}
        subtitle={t("notifications.subtitle")}
        style={{ marginBottom: 4 }}
      />

      {emails.length === 0 && (
        <MessageBar intent="warning">
          <MessageBarBody>{t("notifications.noEmail")}</MessageBarBody>
        </MessageBar>
      )}
      {hasTgBot && !showTg && (
        <MessageBar intent="info">
          <MessageBarBody>{t("notifications.tgNoAccount")}</MessageBarBody>
          <MessageBarActions>
            <Button size="small" onClick={() => navigate("/connections")}>
              {t("notifications.linkAccount")}
            </Button>
          </MessageBarActions>
        </MessageBar>
      )}
      {hasDiscordBot && discordConnections.length === 0 && (
        <MessageBar intent="info">
          <MessageBarBody>{t("notifications.discordNoAccount")}</MessageBarBody>
          <MessageBarActions>
            <Button size="small" onClick={() => navigate("/connections")}>
              {t("notifications.linkAccount")}
            </Button>
          </MessageBarActions>
        </MessageBar>
      )}

      {/* ── Events ── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <div className={styles.cardTitles}>
            <Subtitle2 as="h2">{t("notifications.eventsTitle")}</Subtitle2>
            <Text size={200} className={styles.muted}>
              {t("notifications.eventsDesc")}
            </Text>
          </div>
          <Button
            size="small"
            appearance="subtle"
            icon={<CodeRegular />}
            onClick={openJson}
          >
            {t("notifications.jsonEdit")}
          </Button>
        </div>

        {activeRuleset && (
          <div className={styles.cardNotice}>
            <MessageBar intent="info">
              <MessageBarBody>
                {t("notifications.rulesetActiveOverride", {
                  name: activeRuleset.name,
                })}
              </MessageBarBody>
            </MessageBar>
          </div>
        )}
        {mutation.isError && (
          <div className={styles.cardNotice}>
            <MessageBar intent="error">
              <MessageBarBody>{t("common.saveFailed")}</MessageBarBody>
            </MessageBar>
          </div>
        )}

        {destinations.length === 0 ? (
          <div className={styles.cardEmpty}>
            {t("notifications.noDestinations")}
          </div>
        ) : (
          <>
            <div className={mergeClasses(styles.row, styles.headRow)}>
              <span className={styles.eventCell}>
                {t("notifications.colEvent")}
              </span>
              {destinations.map((dest) => (
                <span
                  key={`${dest.kind}:${dest.id}`}
                  className={styles.destCell}
                >
                  <DestHead dest={dest} />
                </span>
              ))}
            </div>
            {levelRow(
              "all",
              t("notifications.allEvents"),
              null,
              ALL_EVENT_KEYS,
              styles.groupRow,
            )}
            {EVENT_GROUPS.map((group) => [
              levelRow(
                group.groupKey,
                t(group.groupKey),
                null,
                group.events.map((e) => e.value),
                styles.groupRow,
              ),
              ...group.events.map((entry) =>
                levelRow(entry.value, t(entry.labelKey), t(entry.descKey), [
                  entry.value,
                ]),
              ),
            ])}
          </>
        )}

        {/* Only while there is something to save or just saved; idle,
            the table ends at its last row. */}
        {(dirty || saved || mutation.isPending) && (
          <div className={styles.footer}>
            <span
              className={mergeClasses(
                styles.footerStatus,
                saved && styles.footerStatusOk,
              )}
              role="status"
            >
              {saved ? (
                <>
                  <CheckmarkRegular />
                  {t("notifications.saved")}
                </>
              ) : dirty ? (
                t("notifications.unsaved")
              ) : null}
            </span>
            <Button
              disabled={!dirty || mutation.isPending}
              onClick={discardRules}
            >
              {t("common.discard")}
            </Button>
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
          </div>
        )}
      </section>

      {/* ── Rulesets ── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <div className={styles.cardTitles}>
            <Subtitle2 as="h2">{t("notifications.rulesetsTitle")}</Subtitle2>
            <Text size={200} className={styles.muted}>
              {t("notifications.rulesetsDesc")}
            </Text>
          </div>
          <Button
            size="small"
            icon={<AddRegular />}
            disabled={createRulesetMut.isPending}
            onClick={() => setNameDialog({ mode: "new", value: "" })}
          >
            {t("notifications.rulesetsNew")}
          </Button>
        </div>

        {rulesetMessage && (
          <div className={styles.cardNotice}>
            <MessageBar intent={rulesetMessage.intent}>
              <MessageBarBody>{rulesetMessage.text}</MessageBarBody>
            </MessageBar>
          </div>
        )}

        {rulesets.length === 0 && (
          <div className={styles.cardEmpty}>
            {t("notifications.rulesetsEmpty")}
          </div>
        )}

        {rulesets.map((rs, i) => {
          const open = rs.id === editingRulesetId;
          return (
            <div key={rs.id}>
              <div className={styles.rsRow}>
                <div className={styles.rsName}>
                  <Text weight="semibold" truncate wrap={false}>
                    {rs.name}
                  </Text>
                  {rs.is_active && (
                    <Badge appearance="tint" color="success" size="small">
                      {t("notifications.rulesetsActiveBadge")}
                    </Badge>
                  )}
                  <Text size={200} className={styles.muted}>
                    {t("notifications.rulesetsRuleCount", {
                      count: rs.rules.length,
                    })}
                  </Text>
                </div>
                <Button
                  size="small"
                  appearance="subtle"
                  onClick={() => setEditingRulesetId(open ? null : rs.id)}
                >
                  {open ? t("common.close") : t("common.edit")}
                </Button>
                <Button
                  size="small"
                  disabled={updateRulesetMut.isPending}
                  onClick={() =>
                    updateRulesetMut.mutate({
                      id: rs.id,
                      body: { is_active: !rs.is_active },
                    })
                  }
                >
                  {rs.is_active
                    ? t("notifications.rulesetsDeactivate")
                    : t("notifications.rulesetsActivate")}
                </Button>
                <Menu>
                  <MenuTrigger disableButtonEnhancement>
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<MoreHorizontalRegular />}
                      aria-label={rs.name}
                    />
                  </MenuTrigger>
                  <MenuPopover>
                    <MenuList>
                      <MenuItem
                        onClick={() =>
                          setNameDialog({
                            mode: "rename",
                            ruleset: rs,
                            value: rs.name,
                          })
                        }
                      >
                        {t("notifications.rulesetsRename")}
                      </MenuItem>
                      <MenuItem
                        disabled={deleteRulesetMut.isPending}
                        onClick={() => setDeleteDialog(rs)}
                      >
                        {t("notifications.rulesetsDelete")}
                      </MenuItem>
                    </MenuList>
                  </MenuPopover>
                </Menu>
              </div>

              {open && editingRuleset && (
                <div
                  className={mergeClasses(
                    styles.editor,
                    i === rulesets.length - 1 && styles.editorLast,
                  )}
                >
                  {draftRules.length === 0 && (
                    <Text size={200} className={styles.muted}>
                      {t("notifications.rulesetsRulesEmpty")}
                    </Text>
                  )}
                  {draftRules.map((rule, idx) => (
                    <RuleEditor
                      key={rule.id}
                      index={idx}
                      rule={rule}
                      destinations={destinations}
                      knownEvents={ALL_EVENT_KEYS}
                      isFirst={idx === 0}
                      isLast={idx === draftRules.length - 1}
                      onPatch={(p) => patchDraftRule(idx, p)}
                      onMove={(d) => moveDraftRule(idx, d)}
                      onDelete={() =>
                        setDraftRules((prev) =>
                          prev.filter((_, j) => j !== idx),
                        )
                      }
                    />
                  ))}
                  <div className={styles.editorFooter}>
                    <Button
                      size="small"
                      icon={<AddRegular />}
                      onClick={addDraftRule}
                    >
                      {t("notifications.rulesetsAddRule")}
                    </Button>
                    {draftDirty && (
                      <span className={styles.unsaved}>
                        {t("notifications.rulesetsUnsaved")}
                      </span>
                    )}
                    <Button
                      size="small"
                      style={draftDirty ? undefined : { marginLeft: "auto" }}
                      disabled={!draftDirty || updateRulesetMut.isPending}
                      onClick={() => setDraftRules(editingRuleset.rules)}
                    >
                      {t("common.discard")}
                    </Button>
                    <Button
                      size="small"
                      appearance="primary"
                      disabled={!draftDirty || updateRulesetMut.isPending}
                      onClick={() =>
                        updateRulesetMut.mutate({
                          id: editingRuleset.id,
                          body: { rules: draftRules },
                        })
                      }
                    >
                      {updateRulesetMut.isPending ? (
                        <Spinner size="tiny" />
                      ) : (
                        t("common.saveChanges")
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* ── Dialogs ── */}
      <Dialog
        open={jsonOpen}
        onOpenChange={(_, d) => {
          if (!d.open) setJsonOpen(false);
        }}
      >
        <DialogSurface className={styles.jsonSurface}>
          <DialogBody>
            <DialogTitle>{t("notifications.jsonTitle")}</DialogTitle>
            <DialogContent>
              <Field
                hint={t("notifications.jsonHint")}
                validationMessage={
                  jsonError
                    ? t("notifications.jsonError", { error: jsonError })
                    : undefined
                }
              >
                <Textarea
                  value={jsonText}
                  onChange={(e) => {
                    setJsonText(e.target.value);
                    setJsonError(null);
                  }}
                  rows={18}
                  resize="vertical"
                  textarea={{ className: styles.jsonInput }}
                />
              </Field>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button>{t("common.cancel")}</Button>
              </DialogTrigger>
              <Button appearance="primary" onClick={applyJson}>
                {t("notifications.jsonApply")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

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
