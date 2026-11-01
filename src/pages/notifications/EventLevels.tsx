// The Events card's right pane: one destination's level for every event.
// "All events" and each group set many events at once; groups start
// collapsed so the list stays short, and open groups stay open when another
// destination is picked.

import {
  Button,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { ChevronRightRegular, CopyRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { NotificationRules } from "../../lib/api";
import { Segmented, type SegmentedOption } from "../../components/Segmented";
import { ALL_EVENT_KEYS, EVENT_GROUPS } from "./catalog";
import {
  DEST_ICONS,
  DEST_KIND_KEYS,
  copyLevels,
  destKey,
  getLevel,
  uniformLevel,
  withLevel,
  type Destination,
  type LevelChoice,
} from "./destinations";
import { useNotificationStyles } from "./styles";

const useStyles = makeStyles({
  pane: {
    minWidth: 0,
  },
  head: {
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
  title: {
    display: "flex",
    alignItems: "baseline",
    gap: "8px",
    flex: 1,
    minWidth: 0,
  },
  copyItem: {
    maxWidth: "320px",
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
  // Lines an event's text up with its group title, past the chevron.
  nestedRow: {
    paddingLeft: "calc(var(--card-pad) + 26px)",
  },
  eventCell: {
    flex: "1 1 220px",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
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
  levelCell: {
    width: "176px",
    flexShrink: 0,
  },
});

/** The Off / Brief / Full picker for one or more events. */
function LevelPicker({
  dest,
  label,
  events,
  rules,
  onChange,
}: {
  dest: Destination;
  label: string;
  events: string[];
  rules: NotificationRules;
  onChange: (next: NotificationRules) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const options: SegmentedOption<LevelChoice>[] = [
    { value: "off", label: t("notifications.levelOff") },
    { value: "brief", label: t("notifications.levelBrief"), brand: true },
    { value: "full", label: t("notifications.levelFull"), brand: true },
  ];
  return (
    <Segmented<LevelChoice>
      fill
      className={styles.levelCell}
      label={`${label}: ${dest.label}`}
      value={
        events.length === 1
          ? getLevel(rules, events[0], dest)
          : uniformLevel(rules, events, dest)
      }
      options={options}
      onChange={(choice) => onChange(withLevel(rules, events, dest, choice))}
    />
  );
}

/** Copy every event's level from another destination to `dest`. */
function CopyFromMenu({
  dest,
  destinations,
  rules,
  onChange,
}: {
  dest: Destination;
  destinations: Destination[];
  rules: NotificationRules;
  onChange: (next: NotificationRules) => void;
}) {
  const styles = useStyles();
  const shared = useNotificationStyles();
  const { t } = useTranslation();
  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <Button size="small" appearance="subtle" icon={<CopyRegular />}>
          {t("notifications.copyFrom")}
        </Button>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {destinations
            .filter((d) => d !== dest)
            .map((d) => {
              const Icon = DEST_ICONS[d.kind];
              return (
                <MenuItem
                  key={destKey(d)}
                  icon={<Icon />}
                  title={d.label}
                  className={styles.copyItem}
                  content={{ className: shared.truncate }}
                  onClick={() => onChange(copyLevels(rules, d, dest))}
                >
                  {d.label}
                </MenuItem>
              );
            })}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

export function EventLevels({
  dest,
  destinations,
  rules,
  onChange,
}: {
  dest: Destination;
  /** All destinations, for "Copy from". */
  destinations: Destination[];
  rules: NotificationRules;
  onChange: (next: NotificationRules) => void;
}) {
  const styles = useStyles();
  const shared = useNotificationStyles();
  const { t } = useTranslation();
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const allOpen = openGroups.size === EVENT_GROUPS.length;
  const Icon = DEST_ICONS[dest.kind];

  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function groupSummary(events: string[]) {
    const on = events.filter((ev) => getLevel(rules, ev, dest) !== "off");
    return on.length > 0
      ? t("notifications.groupSummaryOn", {
          on: on.length,
          count: events.length,
        })
      : t("notifications.groupSummary", { count: events.length });
  }

  const picker = (label: string, events: string[]) => (
    <LevelPicker
      dest={dest}
      label={label}
      events={events}
      rules={rules}
      onChange={onChange}
    />
  );

  return (
    <section className={styles.pane} aria-label={dest.label}>
      <div className={styles.head}>
        <Icon aria-hidden />
        <div className={styles.title}>
          <Text
            weight="semibold"
            className={shared.truncate}
            title={dest.label}
          >
            {dest.label}
          </Text>
          <Text size={200} className={shared.muted}>
            {t(DEST_KIND_KEYS[dest.kind])}
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
          <CopyFromMenu
            dest={dest}
            destinations={destinations}
            rules={rules}
            onChange={onChange}
          />
        )}
      </div>

      <div className={mergeClasses(styles.row, styles.groupRow)}>
        <div className={styles.eventCell}>
          <Text weight="semibold">{t("notifications.allEvents")}</Text>
        </div>
        {picker(t("notifications.allEvents"), ALL_EVENT_KEYS)}
      </div>

      {EVENT_GROUPS.map((group) => {
        const open = openGroups.has(group.groupKey);
        const title = t(group.groupKey);
        const events = group.events.map((e) => e.value);
        return [
          <div
            key={group.groupKey}
            className={mergeClasses(styles.row, styles.groupRow)}
          >
            <button
              type="button"
              className={styles.groupToggle}
              aria-expanded={open}
              onClick={() => toggleGroup(group.groupKey)}
            >
              <ChevronRightRegular
                aria-hidden
                className={mergeClasses(
                  styles.chevron,
                  open && styles.chevronOpen,
                )}
              />
              <span className={styles.eventCell}>
                <Text weight="semibold">{title}</Text>
                <Text size={200} className={shared.muted}>
                  {groupSummary(events)}
                </Text>
              </span>
            </button>
            {picker(title, events)}
          </div>,
          ...(open ? group.events : []).map((entry) => (
            <div
              key={entry.value}
              className={mergeClasses(styles.row, styles.nestedRow)}
            >
              <div className={styles.eventCell}>
                <Text>{t(entry.labelKey)}</Text>
                <Text size={200} className={shared.muted}>
                  {t(entry.descKey)}
                </Text>
              </div>
              {picker(t(entry.labelKey), [entry.value])}
            </div>
          )),
        ];
      })}
    </section>
  );
}
