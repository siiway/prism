// Full empty state for a main list page that has nothing in it yet (no apps,
// no teams, no tokens…). Where EmptyState is a one-liner for empty tables and
// searches, this explains what the page is for and how to start: an
// illustration beside a heading, a short description, numbered steps and the
// page's primary action. Modelled on the Cloudflare dashboard's empty pages.

import { Text, makeStyles, tokens } from "@fluentui/react-components";
import type { ReactNode } from "react";

const useStyles = makeStyles({
  root: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.15fr)",
    gap: "6px",
    padding: "6px",
    borderRadius: tokens.borderRadiusXLarge,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground1,
    "@media (max-width: 720px)": {
      gridTemplateColumns: "minmax(0, 1fr)",
    },
  },
  art: {
    minHeight: "220px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground2,
    overflow: "hidden",
    "& svg": {
      display: "block",
      width: "100%",
      maxWidth: "360px",
      height: "auto",
    },
    "@media (max-width: 720px)": {
      minHeight: "170px",
    },
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "22px 22px 20px",
    "@media (max-width: 720px)": {
      padding: "14px 10px 10px",
    },
  },
  desc: {
    color: tokens.colorNeutralForeground3,
    fontSize: "13px",
    lineHeight: "20px",
  },
  steps: {
    listStyleType: "none",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    margin: "8px 0 4px",
  },
  step: {
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
    fontSize: "13px",
    lineHeight: "20px",
    color: tokens.colorNeutralForeground2,
  },
  stepNum: {
    flexShrink: 0,
    width: "20px",
    height: "20px",
    borderRadius: "50%",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "11px",
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
  },
  action: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    marginTop: "auto",
    paddingTop: "12px",
  },
});

interface GetStartedPanelProps {
  art: ReactNode;
  title: ReactNode;
  description: ReactNode;
  steps?: ReactNode[];
  action?: ReactNode;
}

export function GetStartedPanel({
  art,
  title,
  description,
  steps,
  action,
}: GetStartedPanelProps) {
  const styles = useStyles();
  return (
    <section className={styles.root}>
      <div className={styles.art}>{art}</div>
      <div className={styles.body}>
        <Text as="h2" size={500} weight="semibold">
          {title}
        </Text>
        <span className={styles.desc}>{description}</span>
        {steps && steps.length > 0 && (
          <ol className={styles.steps}>
            {steps.map((step, i) => (
              <li key={i} className={styles.step}>
                <span className={styles.stepNum}>{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        )}
        {action && <div className={styles.action}>{action}</div>}
      </div>
    </section>
  );
}
