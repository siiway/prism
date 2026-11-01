// The bordered list used by top-level list pages (apps, teams, domains,
// admin lists): a muted heading row and one grid row per item, its key facts
// in columns. Secondary columns drop away on narrow screens.
//
//   <DataList columns={[{ label: "Name", width: "2fr" }, …]}>
//     {items.map((x) => <DataListRow key={x.id} to={`/x/${x.id}`} cells={[…]} />)}
//   </DataList>
//
// A row with `to` is one link (keyboard, middle-click, new tab) and gets a
// chevron; it must not hold other controls. A row with controls passes
// `onClick` instead and keeps a real link in its first cell.

import { makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { ChevronRightRegular } from "@fluentui/react-icons";
import { createContext, useContext, type ReactNode } from "react";
import { Link } from "react-router-dom";

const NARROW = "@media (max-width: 768px)";

export interface DataListColumn {
  /** Heading text; empty for an unlabelled column (actions). */
  label: ReactNode;
  /** CSS grid track, e.g. "minmax(0, 2fr)" or "120px". */
  width: string;
  /** Hidden on narrow screens. */
  secondary?: boolean;
  /** Right-align the column (numbers, actions). */
  end?: boolean;
}

const useStyles = makeStyles({
  frame: {
    borderRadius: tokens.borderRadiusXLarge,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground1,
    overflow: "hidden",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "var(--cols)",
    gap: "16px",
    alignItems: "center",
    [NARROW]: { gridTemplateColumns: "var(--cols-narrow)" },
  },
  head: {
    padding: "10px 16px",
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    minHeight: "40px",
    boxSizing: "border-box",
  },
  row: {
    minHeight: "56px",
    padding: "10px 16px",
    boxSizing: "border-box",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    color: "inherit",
    textDecorationLine: "none",
  },
  clickable: {
    cursor: "pointer",
    ":hover": { background: tokens.colorNeutralBackground1Hover },
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "-2px",
    },
  },
  selected: { background: tokens.colorNeutralBackground1Selected },
  cell: {
    minWidth: 0,
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground2,
    overflowWrap: "anywhere",
  },
  first: { color: tokens.colorNeutralForeground1 },
  secondary: { [NARROW]: { display: "none" } },
  // Flex alone: a text-align here would leak into controls in the cell
  // (it shoved a Switch knob out of its track).
  end: { display: "flex", justifyContent: "flex-end" },
  chevron: { fontSize: "14px", color: tokens.colorNeutralForeground3 },
});

const ColumnsContext = createContext<DataListColumn[]>([]);

function tracks(columns: DataListColumn[], chevron: boolean, narrow: boolean) {
  const list = columns
    .filter((c) => !narrow || !c.secondary)
    .map((c) => c.width);
  if (chevron) list.push("14px");
  return list.join(" ");
}

interface DataListProps {
  columns: DataListColumn[];
  /** Rows link somewhere: reserve the chevron column. */
  linked?: boolean;
  /** Replaces the column headings, e.g. a bulk-action bar. */
  head?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function DataList({
  columns,
  linked,
  head,
  children,
  className,
}: DataListProps) {
  const styles = useStyles();
  const vars = {
    "--cols": tracks(columns, !!linked, false),
    "--cols-narrow": tracks(columns, !!linked, true),
  } as React.CSSProperties;
  return (
    <ColumnsContext.Provider value={columns}>
      <div className={mergeClasses(styles.frame, className)} style={vars}>
        {head ?? (
          <div className={mergeClasses(styles.grid, styles.head)} aria-hidden>
            {columns.map((c, i) => (
              <span
                key={i}
                className={mergeClasses(
                  c.secondary && styles.secondary,
                  c.end && styles.end,
                )}
              >
                {c.label}
              </span>
            ))}
            {linked && <span />}
          </div>
        )}
        {children}
      </div>
    </ColumnsContext.Provider>
  );
}

interface DataListRowProps {
  /** One node per column, in order. */
  cells: ReactNode[];
  /** The whole row links here. */
  to?: string;
  /** Router state passed with `to`, e.g. where the page was opened from. */
  state?: unknown;
  onClick?: () => void;
  selected?: boolean;
}

export function DataListRow({
  cells,
  to,
  state,
  onClick,
  selected,
}: DataListRowProps) {
  const styles = useStyles();
  const columns = useContext(ColumnsContext);
  const className = mergeClasses(
    styles.grid,
    styles.row,
    (to || onClick) && styles.clickable,
    selected && styles.selected,
  );
  const content = (
    <>
      {cells.map((cell, i) => (
        <div
          key={i}
          className={mergeClasses(
            styles.cell,
            i === 0 && styles.first,
            columns[i]?.secondary && styles.secondary,
            columns[i]?.end && styles.end,
          )}
        >
          {cell}
        </div>
      ))}
      {to && <ChevronRightRegular className={styles.chevron} />}
    </>
  );
  if (to)
    return (
      <Link to={to} state={state} className={className}>
        {content}
      </Link>
    );
  return (
    <div className={className} onClick={onClick}>
      {content}
    </div>
  );
}

const useNameStyles = makeStyles({
  root: { display: "flex", alignItems: "center", gap: "12px", minWidth: 0 },
  text: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
  line: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
    flexWrap: "wrap",
  },
  name: {
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    overflowWrap: "anywhere",
  },
  sub: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

/** First-column content: an icon or avatar, the name, badges, a subtitle. */
export function DataListName({
  icon,
  name,
  badges,
  sub,
}: {
  icon?: ReactNode;
  name: ReactNode;
  badges?: ReactNode;
  sub?: ReactNode;
}) {
  const styles = useNameStyles();
  return (
    <div className={styles.root}>
      {icon}
      <div className={styles.text}>
        <div className={styles.line}>
          <span className={styles.name}>{name}</span>
          {badges}
        </div>
        {sub && <span className={styles.sub}>{sub}</span>}
      </div>
    </div>
  );
}
