// The Events card's left column: every destination with how many events it
// has on. Picking one shows its levels in EventLevels. Below WIDE it becomes
// a row above the events that scrolls sideways.

import { makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import type { NotificationRules } from "../../lib/api";
import { ALL_EVENT_KEYS } from "./catalog";
import {
  DEST_ICONS,
  DEST_KIND_KEYS,
  destKey,
  getLevel,
  type Destination,
} from "./destinations";
import { WIDE, useNotificationStyles } from "./styles";

const useStyles = makeStyles({
  list: {
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
  label: {
    padding: "4px 10px 8px",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    [WIDE]: { display: "none" },
  },
  item: {
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
  itemActive: {
    background: tokens.colorSubtleBackgroundSelected,
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold,
    ":hover": { background: tokens.colorSubtleBackgroundSelected },
    "& > svg": { color: tokens.colorNeutralForeground1 },
  },
  summary: {
    gridColumn: 2,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground3,
  },
  summaryOn: {
    color: tokens.colorBrandForeground2,
  },
});

export function DestinationList({
  destinations,
  current,
  rules,
  onSelect,
}: {
  destinations: Destination[];
  current: Destination;
  rules: NotificationRules;
  onSelect: (dest: Destination) => void;
}) {
  const styles = useStyles();
  const shared = useNotificationStyles();
  const { t } = useTranslation();
  return (
    <nav
      className={styles.list}
      aria-label={t("notifications.destinationsLabel")}
    >
      <span className={styles.label}>
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
            className={mergeClasses(styles.item, active && styles.itemActive)}
            onClick={() => onSelect(dest)}
          >
            <Icon aria-hidden />
            <span className={shared.truncate}>{dest.label}</span>
            <span
              className={mergeClasses(
                styles.summary,
                on > 0 && styles.summaryOn,
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
  );
}
