// Editor for one ruleset rule.
//
// A ruleset is an ordered list of rules, each with a match (an event glob:
// "*", "security.*", … and optionally a set of accounts) and an action (mute,
// or send to one or more destinations at a level). Disabled rules are
// skipped; "stop" halts evaluation after a match.

import {
  Button,
  Checkbox,
  Combobox,
  Dropdown,
  Input,
  Option,
  Radio,
  RadioGroup,
  Text,
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
  DeleteRegular,
  DismissRegular,
} from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import type {
  NotificationLevel,
  NotificationRulesetRule,
  NotificationRuleSendChannel,
} from "../../lib/api";
import { Segmented } from "../../components/Segmented";
import {
  DEST_ICONS,
  DEST_KIND_KEYS,
  type DestKind,
  type Destination,
} from "./destinations";
import { NARROW, useNotificationStyles } from "./styles";

const useStyles = makeStyles({
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
});

function RuleAccountFilter(props: {
  destinations: Destination[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const styles = useStyles();
  const shared = useNotificationStyles();
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
      <Text size={200} className={shared.muted}>
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
            <span className={shared.truncate}>{d.label}</span>
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

export function RuleEditor(props: {
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
  const shared = useNotificationStyles();
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
          input={{ className: shared.monoInput }}
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
