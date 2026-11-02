// "Then…": what a matching rule does. Send adds destinations at a detail
// level; Mute removes destinations earlier rules added (all of them, or
// some). Either can stop the rules below from running.

import {
  Button,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Radio,
  RadioGroup,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { AddRegular, DismissRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import {
  channelKey,
  type RuleSendChannel,
} from "../../../shared/notificationRules";
import { CheckboxField } from "../../components/CheckboxField";
import { Segmented } from "../../components/Segmented";
import { Select } from "../../components/Select";
import { SettingsCard } from "../../components/Settings";
import {
  DEST_ICONS,
  DEST_KIND_KEYS,
  destKey,
  type Destination,
} from "./destinations";
import { NARROW, useNotificationStyles } from "./styles";

export interface ActionState {
  type: "send" | "drop";
  channels: RuleSendChannel[];
  /** Mute: every destination, or only `muteAccounts`. */
  muteAll: boolean;
  muteAccounts: string[];
  stop: boolean;
}

const useStyles = makeStyles({
  body: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    padding: "16px var(--card-pad) 20px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  channels: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  channel: {
    display: "grid",
    gridTemplateColumns: "16px minmax(0, 1fr) auto auto",
    alignItems: "center",
    gap: "10px",
    "& > svg": { color: tokens.colorNeutralForeground3 },
    [NARROW]: { gridTemplateColumns: "16px minmax(0, 1fr) auto" },
  },
  level: {
    [NARROW]: { gridColumn: "2 / span 2" },
  },
  checks: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    paddingLeft: "24px",
  },
  add: { alignSelf: "flex-start" },
  error: { color: tokens.colorPaletteRedForeground1 },
});

function channelFor(d: Destination): RuleSendChannel {
  return d.kind === "email"
    ? { kind: "email", email_id: d.id, level: "full" }
    : { kind: d.kind, connection_id: d.id, level: "full" };
}

export function ActionCard({
  state,
  destinations,
  onChange,
  showErrors,
}: {
  state: ActionState;
  destinations: Destination[];
  onChange: (next: ActionState) => void;
  showErrors: boolean;
}) {
  const styles = useStyles();
  const shared = useNotificationStyles();
  const { t } = useTranslation();
  const byKey = new Map(destinations.map((d) => [destKey(d), d]));
  const used = new Set(state.channels.map(channelKey));
  const unused = destinations.filter((d) => !used.has(destKey(d)));

  const setChannel = (i: number, next: RuleSendChannel) =>
    onChange({
      ...state,
      channels: state.channels.map((c, j) => (j === i ? next : c)),
    });

  return (
    <SettingsCard
      id="action"
      title={t("notifications.rule.actionTitle")}
      description={t("notifications.rule.actionDesc")}
      action={
        <Segmented<"send" | "drop">
          label={t("notifications.rule.actionTitle")}
          value={state.type}
          options={[
            { value: "send", label: t("notifications.rule.actionSend") },
            { value: "drop", label: t("notifications.rule.actionMute") },
          ]}
          onChange={(type) => onChange({ ...state, type })}
        />
      }
    >
      <div className={styles.body}>
        {state.type === "send" ? (
          <div className={styles.channels}>
            {state.channels.length === 0 && (
              <Text
                size={200}
                className={showErrors ? styles.error : shared.muted}
              >
                {t("notifications.rule.sendEmpty")}
              </Text>
            )}
            {state.channels.map((ch, i) => {
              const dest = byKey.get(channelKey(ch));
              const Icon = DEST_ICONS[ch.kind];
              const choices = destinations.filter(
                (d) =>
                  d.kind === ch.kind && (d === dest || !used.has(destKey(d))),
              );
              return (
                <div key={channelKey(ch)} className={styles.channel}>
                  <Icon aria-label={t(DEST_KIND_KEYS[ch.kind])} />
                  <Select
                    aria-label={t("notifications.rule.destination")}
                    value={dest ? destKey(dest) : ""}
                    onChange={(_, d) => {
                      const next = destinations.find(
                        (x) => destKey(x) === d.value,
                      );
                      if (next)
                        setChannel(i, { ...channelFor(next), level: ch.level });
                    }}
                  >
                    {!dest && (
                      <option value="" disabled>
                        {t("notifications.rule.removedDestination")}
                      </option>
                    )}
                    {choices.map((d) => (
                      <option key={destKey(d)} value={destKey(d)}>
                        {d.label}
                      </option>
                    ))}
                  </Select>
                  <Segmented<"brief" | "full">
                    className={styles.level}
                    label={t("notifications.levelLabel")}
                    value={ch.level}
                    options={[
                      { value: "brief", label: t("notifications.levelBrief") },
                      { value: "full", label: t("notifications.levelFull") },
                    ]}
                    onChange={(level) => setChannel(i, { ...ch, level })}
                  />
                  <Tooltip
                    content={t("notifications.rule.removeDestination")}
                    relationship="label"
                  >
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<DismissRegular />}
                      onClick={() =>
                        onChange({
                          ...state,
                          channels: state.channels.filter((_, j) => j !== i),
                        })
                      }
                    />
                  </Tooltip>
                </div>
              );
            })}
            {unused.length > 0 && (
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <Button
                    size="small"
                    icon={<AddRegular />}
                    className={styles.add}
                  >
                    {t("notifications.rule.addDestination")}
                  </Button>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    {unused.map((d) => {
                      const Icon = DEST_ICONS[d.kind];
                      return (
                        <MenuItem
                          key={destKey(d)}
                          icon={<Icon />}
                          onClick={() =>
                            onChange({
                              ...state,
                              channels: [...state.channels, channelFor(d)],
                            })
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
        ) : (
          <div className={styles.channels}>
            <RadioGroup
              value={state.muteAll ? "all" : "some"}
              onChange={(_, d) =>
                onChange({ ...state, muteAll: d.value === "all" })
              }
            >
              <Radio value="all" label={t("notifications.rule.muteAll")} />
              <Radio value="some" label={t("notifications.rule.muteSome")} />
            </RadioGroup>
            {!state.muteAll && (
              <div className={styles.checks}>
                {destinations.map((d) => {
                  const key = destKey(d);
                  const on = state.muteAccounts.includes(key);
                  return (
                    <CheckboxField
                      key={key}
                      label={d.label}
                      hint={t(DEST_KIND_KEYS[d.kind])}
                      checked={on}
                      onChange={(checked) =>
                        onChange({
                          ...state,
                          muteAccounts: checked
                            ? [...state.muteAccounts, key]
                            : state.muteAccounts.filter((k) => k !== key),
                        })
                      }
                    />
                  );
                })}
                {showErrors && state.muteAccounts.length === 0 && (
                  <Text size={200} className={styles.error}>
                    {t("notifications.rule.muteEmpty")}
                  </Text>
                )}
              </div>
            )}
          </div>
        )}
        <CheckboxField
          label={t("notifications.rule.stop")}
          hint={t("notifications.rule.stopHint")}
          checked={state.stop}
          onChange={(stop) => onChange({ ...state, stop })}
        />
      </div>
    </SettingsCard>
  );
}
