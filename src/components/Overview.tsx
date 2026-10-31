// Building blocks for overview pages (the account dashboard and the admin
// overview), laid out like the Cloudflare account home: attention callouts,
// short linked lists side by side, plain metric cards and a settings
// summary. Every row and card links through to the full page.

import {
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { ChevronRightRegular } from "@fluentui/react-icons";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

const useStyles = makeStyles({
  callouts: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    marginBottom: "28px",
  },
  callout: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "12px 16px",
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground1,
    flexWrap: "wrap",
  },
  calloutIcon: {
    display: "inline-flex",
    color: tokens.colorStatusWarningForeground3,
    fontSize: "20px",
    flexShrink: 0,
  },
  calloutText: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    flex: 1,
    minWidth: "200px",
  },
  muted: {
    color: tokens.colorNeutralForeground3,
  },
  lists: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "32px",
    "@media (max-width: 900px)": {
      gridTemplateColumns: "minmax(0, 1fr)",
      gap: "28px",
    },
  },
  listHead: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    paddingBottom: "8px",
    fontSize: "13px",
    color: tokens.colorNeutralForeground3,
  },
  listHeadLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    color: "inherit",
    ":hover": { color: tokens.colorNeutralForeground1 },
  },
  count: {
    padding: "0 6px",
    borderRadius: "4px",
    background: tokens.colorNeutralBackground3,
    fontSize: "11px",
    lineHeight: "18px",
    color: tokens.colorNeutralForeground2,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    minHeight: "44px",
    padding: "0 4px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground1,
    fontSize: "13px",
    fontWeight: tokens.fontWeightMedium,
    ":hover": {
      background: tokens.colorNeutralBackground1Hover,
    },
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "-2px",
    },
  },
  rowIcon: {
    display: "inline-flex",
    fontSize: "16px",
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
  },
  rowLabel: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  rowMeta: {
    fontSize: "12px",
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  chevron: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
  },
  empty: {
    padding: "12px 4px",
    fontSize: "13px",
    color: tokens.colorNeutralForeground3,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  // Reserves roughly the height of a short list while it loads, so the
  // page doesn't jump when rows arrive.
  listLoading: {
    height: "132px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  sectionTitle: {
    display: "block",
    margin: "40px 0 12px",
  },
  metrics: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "12px",
    "@media (max-width: 900px)": {
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    },
  },
  metrics3: {
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  },
  metric: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "14px 16px",
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    ":hover": {
      borderTopColor: tokens.colorNeutralStroke1Pressed,
      borderRightColor: tokens.colorNeutralStroke1Pressed,
      borderBottomColor: tokens.colorNeutralStroke1Pressed,
      borderLeftColor: tokens.colorNeutralStroke1Pressed,
    },
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "2px",
    },
  },
  metricLabel: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
  },
  metricValue: {
    fontSize: "26px",
    lineHeight: "34px",
    fontWeight: tokens.fontWeightSemibold,
    fontVariantNumeric: "tabular-nums",
  },
  metricSuffix: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground3,
  },
  metricFooter: {
    marginTop: "auto",
    paddingTop: "8px",
  },
  // Settings summary: a bordered list of label/value rows, two columns wide.
  summary: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    columnGap: "32px",
    padding: "4px 16px",
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground1,
    "@media (max-width: 900px)": {
      gridTemplateColumns: "minmax(0, 1fr)",
    },
  },
  summaryRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    minHeight: "44px",
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    // No divider under the last row of each column; the card edge is there.
    ":last-child": { borderBottomStyle: "none" },
    "@media (min-width: 901px)": {
      ":nth-last-child(2):nth-child(odd)": { borderBottomStyle: "none" },
    },
    ":hover": { color: tokens.colorNeutralForeground1 },
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "-2px",
    },
  },
  summaryValue: {
    marginLeft: "auto",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightMedium,
  },
  summaryValueMuted: {
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightRegular,
  },
});

export function Callouts({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <div className={styles.callouts}>{children}</div>;
}

interface CalloutProps {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

/** A bordered notice with a warning icon and an optional action button. */
export function Callout({ icon, title, description, action }: CalloutProps) {
  const styles = useStyles();
  return (
    <div className={styles.callout}>
      <span className={styles.calloutIcon}>{icon}</span>
      <div className={styles.calloutText}>
        <Text weight="semibold">{title}</Text>
        <Text size={200} className={styles.muted}>
          {description}
        </Text>
      </div>
      {action}
    </div>
  );
}

export function ListGrid({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <div className={styles.lists}>{children}</div>;
}

interface ListColumnProps {
  title: string;
  to: string;
  count?: number;
  empty: string;
  /** While true, reserves space instead of showing the empty message. */
  loading?: boolean;
  children: ReactNode[];
}

export function ListColumn({
  title,
  to,
  count,
  empty,
  loading,
  children,
}: ListColumnProps) {
  const styles = useStyles();
  return (
    <section>
      <div className={styles.listHead}>
        <Link to={to} className={styles.listHeadLink}>
          {title}
          {count !== undefined && <span className={styles.count}>{count}</span>}
          <ChevronRightRegular className={styles.chevron} />
        </Link>
      </div>
      {children.length > 0 ? (
        children
      ) : loading ? (
        <div className={styles.listLoading} aria-busy="true" />
      ) : (
        <div className={styles.empty}>{empty}</div>
      )}
    </section>
  );
}

interface ListRowProps {
  to: string;
  icon: ReactNode;
  label: string;
  meta?: string;
}

export function ListRow({ to, icon, label, meta }: ListRowProps) {
  const styles = useStyles();
  return (
    <Link to={to} className={styles.row}>
      <span className={styles.rowIcon}>{icon}</span>
      <span className={styles.rowLabel}>{label}</span>
      {meta && <span className={styles.rowMeta}>{meta}</span>}
      <ChevronRightRegular className={styles.chevron} />
    </Link>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return (
    <Text as="h2" weight="semibold" size={400} className={styles.sectionTitle}>
      {children}
    </Text>
  );
}

export function MetricGrid({
  columns = 4,
  children,
}: {
  columns?: 3 | 4;
  children: ReactNode;
}) {
  const styles = useStyles();
  return (
    <div
      className={mergeClasses(styles.metrics, columns === 3 && styles.metrics3)}
    >
      {children}
    </div>
  );
}

interface MetricProps {
  to: string;
  label: string;
  value: ReactNode;
  caption?: string;
  /** Pinned to the card's bottom edge, e.g. a sparkline. */
  footer?: ReactNode;
}

export function Metric({ to, label, value, caption, footer }: MetricProps) {
  const styles = useStyles();
  return (
    <Link to={to} className={styles.metric}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricValue}>{value}</span>
      {caption && <span className={styles.metricLabel}>{caption}</span>}
      {footer && <span className={styles.metricFooter}>{footer}</span>}
    </Link>
  );
}

/** The smaller "/ 12" after a metric value. */
export function MetricSuffix({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <span className={styles.metricSuffix}>{children}</span>;
}

export function SummaryList({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <div className={styles.summary}>{children}</div>;
}

interface SummaryRowProps {
  to: string;
  label: string;
  value: string;
  /** Render the value muted, for "off" or "not set". */
  dim?: boolean;
}

export function SummaryRow({ to, label, value, dim }: SummaryRowProps) {
  const styles = useStyles();
  return (
    <Link to={to} className={styles.summaryRow}>
      <span>{label}</span>
      <span
        className={mergeClasses(
          styles.summaryValue,
          dim && styles.summaryValueMuted,
        )}
      >
        {value}
      </span>
      <ChevronRightRegular className={styles.chevron} />
    </Link>
  );
}
