// Building blocks for account settings pages (Profile, Security), laid out
// like the Cloudflare dashboard's profile pages: a narrow column of cards,
// each with a title, a one-line description and an optional action on the
// right, holding either divided rows (label left, control right) or a padded
// form. Add flows open from the card's action instead of sitting open.

import {
  MessageBar,
  Subtitle2,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { ChevronRightRegular } from "@fluentui/react-icons";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

const NARROW = "@media (max-width: 640px)";

const useStyles = makeStyles({
  page: {
    maxWidth: "960px",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  // Keeps the latest result in view while scrolled down a long page.
  toast: {
    position: "sticky",
    top: "8px",
    zIndex: 2,
  },
  card: {
    "--card-pad": "24px",
    scrollMarginTop: "16px",
    [NARROW]: { "--card-pad": "16px" },
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusXLarge,
    background: tokens.colorNeutralBackground1,
  },
  head: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "12px 16px",
    padding: "20px var(--card-pad) 16px",
  },
  titles: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    flex: "1 1 320px",
    minWidth: 0,
  },
  titleLine: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  muted: {
    color: tokens.colorNeutralForeground3,
  },
  action: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexShrink: 0,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    padding: "16px var(--card-pad) 20px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "12px 16px",
    minHeight: "60px",
    padding: "12px var(--card-pad)",
    boxSizing: "border-box",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    [NARROW]: { flexWrap: "wrap" },
  },
  rowIcon: {
    display: "inline-flex",
    flexShrink: 0,
    fontSize: "20px",
    color: tokens.colorNeutralForeground3,
  },
  rowText: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    flex: "1 1 240px",
    minWidth: 0,
  },
  rowLabel: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "6px",
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  // A div, not Text, so descriptions can hold block content.
  rowDesc: {
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    color: tokens.colorNeutralForeground3,
    minWidth: 0,
  },
  rowControl: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: "8px",
    flexShrink: 0,
    maxWidth: "100%",
    [NARROW]: { justifyContent: "flex-start" },
  },
  subhead: {
    padding: "10px var(--card-pad)",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground2,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  empty: {
    padding: "16px var(--card-pad)",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground3,
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: "8px",
    padding: "12px var(--card-pad)",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  // A data table inside a card: edge cells line up with the card padding.
  table: {
    overflowX: "auto",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    "& th:first-child, & td:first-child": {
      paddingLeft: "var(--card-pad)",
    },
    "& th:last-child, & td:last-child": {
      paddingRight: "var(--card-pad)",
    },
    "& tbody tr:last-child": { borderBottomStyle: "none" },
  },
  linkRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    minHeight: "60px",
    padding: "10px var(--card-pad)",
    boxSizing: "border-box",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    color: "inherit",
    textDecorationLine: "none",
    ":hover": { background: tokens.colorNeutralBackground1Hover },
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "-2px",
    },
  },
  linkMeta: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    [NARROW]: { display: "none" },
  },
  chevron: {
    flexShrink: 0,
    fontSize: "16px",
    color: tokens.colorNeutralForeground3,
  },
  footerStart: {
    marginRight: "auto",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
});

export function SettingsPage({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <div className={styles.page}>{children}</div>;
}

export function SettingsToast({
  message,
}: {
  message: { type: "success" | "error"; text: string } | null;
}) {
  const styles = useStyles();
  if (!message) return null;
  return (
    <div className={styles.toast} role="status">
      <MessageBar intent={message.type === "success" ? "success" : "error"}>
        {message.text}
      </MessageBar>
    </div>
  );
}

interface SettingsCardProps {
  /** Anchor for search deep links (/page#id). */
  id?: string;
  title: string;
  description?: ReactNode;
  /** Shown beside the title, e.g. an Enabled badge. */
  badge?: ReactNode;
  /** Top-right of the card, e.g. an Add button. */
  action?: ReactNode;
  children?: ReactNode;
}

export function SettingsCard({
  id,
  title,
  description,
  badge,
  action,
  children,
}: SettingsCardProps) {
  const styles = useStyles();
  return (
    <section id={id} className={styles.card}>
      <div className={styles.head}>
        <div className={styles.titles}>
          <div className={styles.titleLine}>
            <Subtitle2 as="h2">{title}</Subtitle2>
            {badge}
          </div>
          {description && (
            <Text size={200} className={styles.muted}>
              {description}
            </Text>
          )}
        </div>
        {action && <div className={styles.action}>{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** Padded content (a form, an editor) below the card header. */
export function SettingsBody({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <div className={styles.body}>{children}</div>;
}

interface SettingsRowProps {
  icon?: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  /** Controls on the right: a switch, a short input, row actions. */
  children?: ReactNode;
  className?: string;
}

export function SettingsRow({
  icon,
  label,
  description,
  children,
  className,
}: SettingsRowProps) {
  const styles = useStyles();
  return (
    <div className={mergeClasses(styles.row, className)}>
      {icon && <span className={styles.rowIcon}>{icon}</span>}
      <div className={styles.rowText}>
        <div className={styles.rowLabel}>{label}</div>
        {description && <div className={styles.rowDesc}>{description}</div>}
      </div>
      {children && <div className={styles.rowControl}>{children}</div>}
    </div>
  );
}

/** A quiet heading between groups of rows. */
export function SettingsSubhead({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <div className={styles.subhead}>{children}</div>;
}

export function SettingsEmpty({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <div className={styles.empty}>{children}</div>;
}

export function SettingsFooter({
  start,
  children,
}: {
  /** Left-aligned note, e.g. a byte count. */
  start?: ReactNode;
  children: ReactNode;
}) {
  const styles = useStyles();
  return (
    <div className={styles.footer}>
      {start && <span className={styles.footerStart}>{start}</span>}
      {children}
    </div>
  );
}

/** A table in a card, edge-aligned with the card's padding. */
export function SettingsTable({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <div className={styles.table}>{children}</div>;
}

interface SettingsLinkRowProps {
  to: string;
  /** Usually an Avatar. */
  icon?: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  /** Muted facts on the right, hidden on narrow screens. */
  meta?: ReactNode;
}

/** A row that opens another page, e.g. one app in a team's app list. */
export function SettingsLinkRow({
  to,
  icon,
  label,
  description,
  meta,
}: SettingsLinkRowProps) {
  const styles = useStyles();
  return (
    <Link to={to} className={styles.linkRow}>
      {icon}
      <div className={styles.rowText}>
        <div className={styles.rowLabel}>{label}</div>
        {description && <div className={styles.rowDesc}>{description}</div>}
      </div>
      {meta && <div className={styles.linkMeta}>{meta}</div>}
      <ChevronRightRegular className={styles.chevron} />
    </Link>
  );
}
