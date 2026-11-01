// Notification preferences. Two parts:
//
// - Events: destination-first. A list of destinations (each verified email,
//   linked Telegram and Discord account) on the left; picking one shows every
//   event with a single Off / Brief / Full picker. Group rows and an "All
//   events" row set many events at once, and "Copy from" clones another
//   destination's levels. One column of pickers stays readable however many
//   destinations there are, which a destination × event grid did not.
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
  ChevronRightRegular,
  CodeRegular,
  CopyRegular,
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
import { SettingsCard } from "../components/Settings";
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
import { SkeletonSettingsPage } from "../components/Skeletons";

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

/** Give `to` the same level as `from` for every event. */
function copyLevels(
  rules: NotificationRules,
  from: Destination,
  to: Destination,
): NotificationRules {
  let next = rules;
  for (const ev of ALL_EVENT_KEYS) {
    next = withLevel(next, [ev], to, getLevel(rules, ev, from));
  }
  return next;
}

function destKey(d: Destination) {
  return `${d.kind}:${d.id}`;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const NARROW = "@media (max-width: 640px)";
// Content is the window minus the app sidebar, so the two-pane events layout
// needs a wider window than the phone breakpoint.
const WIDE = "@media (max-width: 960px)";

const useStyles = makeStyles({
  root: {
    maxWidth: "960px",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
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

  // Events: destination list | event pane. Below WIDE the list sits on top
  // and scrolls sideways.
  events: {
    display: "grid",
    gridTemplateColumns: "232px minmax(0, 1fr)",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    [WIDE]: { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  destList: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "12px",
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    [WIDE]: {
      flexDirection: "row",
      overflowX: "auto",
      padding: "8px var(--card-pad)",
      borderRight: "none",
      borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
  },
  destListLabel: {
    padding: "4px 10px 8px",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    [WIDE]: { display: "none" },
  },
  destItem: {
    display: "grid",
    gridTemplateColumns: "16px minmax(0, 1fr)",
    alignItems: "center",
    columnGap: "10px",
    rowGap: "1px",
    padding: "7px 10px",
    border: "none",
    borderRadius: tokens.borderRadiusMedium,
    background: "transparent",
    color: tokens.colorNeutralForeground2,
    fontFamily: "inherit",
    fontSize: tokens.fontSizeBase300,
    textAlign: "left",
    cursor: "pointer",
    "& > svg": {
      fontSize: "16px",
      color: tokens.colorNeutralForeground3,
    },
    ":hover": {
      background: tokens.colorSubtleBackgroundHover,
      color: tokens.colorNeutralForeground1,
    },
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "-2px",
    },
    [WIDE]: {
      flex: "0 0 auto",
      maxWidth: "240px",
    },
  },
  destItemActive: {
    background: tokens.colorSubtleBackgroundSelected,
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold,
    ":hover": { background: tokens.colorSubtleBackgroundSelected },
    "& > svg": { color: tokens.colorNeutralForeground1 },
  },
  destSummary: {
    gridColumn: 2,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground3,
  },
  destSummaryOn: {
    color: tokens.colorBrandForeground2,
  },
  pane: {
    minWidth: 0,
  },
  paneHead: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minHeight: "52px",
    padding: "8px var(--card-pad)",
    boxSizing: "border-box",
    "& > svg": {
      fontSize: "16px",
      flexShrink: 0,
      color: tokens.colorNeutralForeground3,
    },
  },
  paneTitle: {
    display: "flex",
    alignItems: "baseline",
    gap: "8px",
    flex: 1,
    minWidth: 0,
  },
  row: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "8px 24px",
    minHeight: "56px",
    padding: "10px var(--card-pad)",
    boxSizing: "border-box",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  groupRow: {
    minHeight: "48px",
    background: tokens.colorNeutralBackground2,
  },
  eventCell: {
    flex: "1 1 220px",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  levelCell: {
    width: "176px",
    flexShrink: 0,
  },
  // Lines an event's text up with its group title, past the chevron.
  nestedRow: {
    paddingLeft: "calc(var(--card-pad) + 26px)",
  },
  groupToggle: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flex: "1 1 220px",
    minWidth: 0,
    padding: 0,
    border: "none",
    background: "transparent",
    color: "inherit",
    fontFamily: "inherit",
    textAlign: "left",
    cursor: "pointer",
    borderRadius: tokens.borderRadiusSmall,
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "2px",
    },
  },
  chevron: {
    flexShrink: 0,
    fontSize: "16px",
    color: tokens.colorNeutralForeground3,
    transitionProperty: "transform",
    transitionDuration: tokens.durationFaster,
  },
  chevronOpen: {
    transform: "rotate(90deg)",
  },
  copyItem: {
    maxWidth: "320px",
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

  const [selectedDest, setSelectedDest] = useState<string | null>(null);
  // Expanded event groups; all collapsed at first so the list stays short.
  // Shared across destinations, so switching keeps the same groups open.
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
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

  if (isLoading)
    return (
      <div className={styles.root}>
        <PageHeader
          title={t("notifications.title")}
          subtitle={t("notifications.subtitle")}
          style={{ marginBottom: 4 }}
        />
        <SkeletonSettingsPage cards={[8]} />
      </div>
    );

  const current =
    destinations.find((d) => destKey(d) === selectedDest) ?? destinations[0];

  const levelOptions: SegmentedOption<LevelChoice>[] = [
    { value: "off", label: t("notifications.levelOff") },
    { value: "brief", label: t("notifications.levelBrief"), brand: true },
    { value: "full", label: t("notifications.levelFull"), brand: true },
  ];

  const groupSummary = (dest: Destination, events: string[]) => {
    const on = events.filter((ev) => getLevel(rules, ev, dest) !== "off");
    return on.length > 0
      ? t("notifications.groupSummaryOn", {
          on: on.length,
          count: events.length,
        })
      : t("notifications.groupSummary", { count: events.length });
  };

  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  const allOpen = openGroups.size === EVENT_GROUPS.length;

  /**
   * One picker row. `group` makes the title a disclosure button for the
   * group's events; `nested` indents an event under its group.
   */
  const levelRow = (
    dest: Destination,
    key: string,
    title: string,
    description: string | null,
    events: string[],
    opts: { group?: boolean; nested?: boolean } = {},
  ) => (
    <div
      key={key}
      className={mergeClasses(
        styles.row,
        description === null && styles.groupRow,
        opts.nested && styles.nestedRow,
      )}
    >
      {opts.group ? (
        <button
          type="button"
          className={styles.groupToggle}
          aria-expanded={openGroups.has(key)}
          onClick={() => toggleGroup(key)}
        >
          <ChevronRightRegular
            aria-hidden
            className={mergeClasses(
              styles.chevron,
              openGroups.has(key) && styles.chevronOpen,
            )}
          />
          <span className={styles.eventCell}>
            <Text weight="semibold">{title}</Text>
            <Text size={200} className={styles.muted}>
              {groupSummary(dest, events)}
            </Text>
          </span>
        </button>
      ) : (
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
      )}
      <Segmented<LevelChoice>
        fill
        className={styles.levelCell}
        label={`${title}: ${dest.label}`}
        value={
          events.length === 1
            ? getLevel(rules, events[0], dest)
            : uniformLevel(rules, events, dest)
        }
        options={levelOptions}
        onChange={(choice) =>
          updateRules(withLevel(rules, events, dest, choice))
        }
      />
    </div>
  );

  const CurrentIcon = current ? DEST_ICONS[current.kind] : null;

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
      <SettingsCard
        id="events"
        title={t("notifications.eventsTitle")}
        description={t("notifications.eventsDesc")}
        action={
          <Button
            size="small"
            appearance="subtle"
            icon={<CodeRegular />}
            onClick={openJson}
          >
            {t("notifications.jsonEdit")}
          </Button>
        }
      >
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

        {!current || !CurrentIcon ? (
          <div className={styles.cardEmpty}>
            {t("notifications.noDestinations")}
          </div>
        ) : (
          <div className={styles.events}>
            <nav
              className={styles.destList}
              aria-label={t("notifications.destinationsLabel")}
            >
              <span className={styles.destListLabel}>
                {t("notifications.destinationsLabel")}
              </span>
              {destinations.map((dest) => {
                const Icon = DEST_ICONS[dest.kind];
                const on = ALL_EVENT_KEYS.filter(
                  (ev) => getLevel(rules, ev, dest) !== "off",
                ).length;
                const active = dest === current;
                return (
                  <button
                    key={destKey(dest)}
                    type="button"
                    aria-pressed={active}
                    title={`${t(DEST_KIND_KEYS[dest.kind])} · ${dest.label}`}
                    className={mergeClasses(
                      styles.destItem,
                      active && styles.destItemActive,
                    )}
                    onClick={() => setSelectedDest(destKey(dest))}
                  >
                    <Icon aria-hidden />
                    <span className={styles.truncate}>{dest.label}</span>
                    <span
                      className={mergeClasses(
                        styles.destSummary,
                        on > 0 && styles.destSummaryOn,
                      )}
                    >
                      {on > 0
                        ? t("notifications.destSummary", { count: on })
                        : t("notifications.destSummaryNone")}
                    </span>
                  </button>
                );
              })}
            </nav>

            <section className={styles.pane} aria-label={current.label}>
              <div className={styles.paneHead}>
                <CurrentIcon aria-hidden />
                <div className={styles.paneTitle}>
                  <Text
                    weight="semibold"
                    className={styles.truncate}
                    title={current.label}
                  >
                    {current.label}
                  </Text>
                  <Text size={200} className={styles.muted}>
                    {t(DEST_KIND_KEYS[current.kind])}
                  </Text>
                </div>
                <Button
                  size="small"
                  appearance="subtle"
                  onClick={() =>
                    setOpenGroups(
                      allOpen
                        ? new Set()
                        : new Set(EVENT_GROUPS.map((g) => g.groupKey)),
                    )
                  }
                >
                  {allOpen
                    ? t("notifications.collapseAll")
                    : t("notifications.expandAll")}
                </Button>
                {destinations.length > 1 && (
                  <Menu>
                    <MenuTrigger disableButtonEnhancement>
                      <Button
                        size="small"
                        appearance="subtle"
                        icon={<CopyRegular />}
                      >
                        {t("notifications.copyFrom")}
                      </Button>
                    </MenuTrigger>
                    <MenuPopover>
                      <MenuList>
                        {destinations
                          .filter((d) => d !== current)
                          .map((d) => {
                            const Icon = DEST_ICONS[d.kind];
                            return (
                              <MenuItem
                                key={destKey(d)}
                                icon={<Icon />}
                                title={d.label}
                                className={styles.copyItem}
                                content={{ className: styles.truncate }}
                                onClick={() =>
                                  updateRules(copyLevels(rules, d, current))
                                }
                              >
                                {d.label}
                              </MenuItem>
                            );
                          })}
                      </MenuList>
                    </MenuPopover>
                  </Menu>
                )}
              </div>
              {levelRow(
                current,
                "all",
                t("notifications.allEvents"),
                null,
                ALL_EVENT_KEYS,
              )}
              {EVENT_GROUPS.map((group) => [
                levelRow(
                  current,
                  group.groupKey,
                  t(group.groupKey),
                  null,
                  group.events.map((e) => e.value),
                  { group: true },
                ),
                ...(openGroups.has(group.groupKey) ? group.events : []).map(
                  (entry) =>
                    levelRow(
                      current,
                      entry.value,
                      t(entry.labelKey),
                      t(entry.descKey),
                      [entry.value],
                      { nested: true },
                    ),
                ),
              ])}
            </section>
          </div>
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
      </SettingsCard>

      {/* ── Rulesets ── */}
      <SettingsCard
        id="rulesets"
        title={t("notifications.rulesetsTitle")}
        description={t("notifications.rulesetsDesc")}
        action={
          <Button
            size="small"
            icon={<AddRegular />}
            disabled={createRulesetMut.isPending}
            onClick={() => setNameDialog({ mode: "new", value: "" })}
          >
            {t("notifications.rulesetsNew")}
          </Button>
        }
      >
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
      </SettingsCard>

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
