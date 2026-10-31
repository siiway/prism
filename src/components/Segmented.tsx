// Compact segmented radio group: a hairline track with one highlighted
// segment. Used for the account menu's theme and language switches and the
// notification level pickers. A null value highlights nothing, which bulk
// controls use for "mixed".

import { makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import type { ReactNode } from "react";

const useStyles = makeStyles({
  root: {
    display: "inline-flex",
    padding: "2px",
    gap: "2px",
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxSizing: "border-box",
  },
  fill: {
    display: "flex",
    width: "100%",
  },
  segment: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "26px",
    height: "24px",
    padding: "0 6px",
    border: "none",
    borderRadius: tokens.borderRadiusSmall,
    background: "transparent",
    color: tokens.colorNeutralForeground3,
    fontFamily: "inherit",
    fontSize: "12px",
    whiteSpace: "nowrap",
    cursor: "pointer",
    "& svg": { fontSize: "14px" },
    ":hover": {
      color: tokens.colorNeutralForeground1,
    },
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "-2px",
    },
    ":disabled": { cursor: "default", opacity: 0.5 },
  },
  segmentFill: {
    flex: 1,
  },
  active: {
    background: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
  // For values that switch something on, so they stand out from "off" at a
  // glance in a long list of pickers.
  activeBrand: {
    background: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground2,
    ":hover": { color: tokens.colorBrandForeground2 },
  },
});

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Rendered instead of the label, e.g. an icon; the label becomes its name. */
  content?: ReactNode;
  /** Highlight with the accent colour when selected. */
  brand?: boolean;
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T | null;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  /** Stretch to the container width with equal segments. */
  fill?: boolean;
  disabled?: boolean;
  className?: string;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  fill,
  disabled,
  className,
}: SegmentedProps<T>) {
  const styles = useStyles();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={mergeClasses(styles.root, fill && styles.fill, className)}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.content ? o.label : undefined}
            title={o.content ? o.label : undefined}
            disabled={disabled}
            className={mergeClasses(
              styles.segment,
              fill && styles.segmentFill,
              selected && styles.active,
              selected && o.brand && styles.activeBrand,
            )}
            onClick={() => onChange(o.value)}
          >
            {o.content ?? o.label}
          </button>
        );
      })}
    </div>
  );
}
