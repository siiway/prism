// Shared page header: title + optional subtitle on the left, optional
// action buttons on the right. Keeps spacing and typography consistent
// across pages instead of each one rolling its own header row.

import { Text, Title2, makeStyles, tokens } from "@fluentui/react-components";
import { useEffect, type ReactNode } from "react";
import { setDocumentPageTitle } from "../lib/documentTitle";

const useStyles = makeStyles({
  root: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "12px",
    marginBottom: "24px",
  },
  titles: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    minWidth: 0,
  },
  title: {
    letterSpacing: "-0.015em",
  },
  subtitle: {
    color: tokens.colorNeutralForeground3,
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexShrink: 0,
  },
});

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Browser tab title when the visible title doesn't suit one, e.g. a
   *  greeting. Defaults to the title when it is a plain string. */
  tabTitle?: string;
  /** Override spacing, e.g. marginBottom: 0 inside flex-gap layouts. */
  style?: React.CSSProperties;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  tabTitle: tabTitleProp,
  style,
}: PageHeaderProps) {
  const styles = useStyles();
  // Name the browser tab after the page ("Security · Prism"). Only plain
  // string titles; a rich title (with badges, say) leaves the site name.
  const tabTitle = tabTitleProp ?? (typeof title === "string" ? title : null);
  useEffect(() => {
    if (!tabTitle) return;
    setDocumentPageTitle(tabTitle);
    return () => setDocumentPageTitle(null);
  }, [tabTitle]);
  return (
    <div className={styles.root} style={style}>
      <div className={styles.titles}>
        <Title2 className={styles.title}>{title}</Title2>
        {subtitle && <Text className={styles.subtitle}>{subtitle}</Text>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
