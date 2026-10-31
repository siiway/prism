// Layout for full-page create flows (new app, new team, new token): a back
// link to the list, the page header, and the form in a single card whose
// footer holds the actions. Used instead of modal dialogs so a create flow
// has its own URL and room to explain each field.

import { makeStyles, tokens } from "@fluentui/react-components";
import { ArrowLeftRegular } from "@fluentui/react-icons";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "./PageHeader";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    maxWidth: "720px",
  },
  back: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    alignSelf: "flex-start",
    marginBottom: "16px",
    fontSize: "13px",
    color: tokens.colorNeutralForeground3,
    ":hover": { color: tokens.colorNeutralForeground1 },
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "2px",
      borderRadius: "2px",
    },
  },
  card: {
    borderRadius: tokens.borderRadiusXLarge,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground1,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: "18px",
    padding: "24px",
    "@media (max-width: 600px)": {
      padding: "16px",
    },
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: "8px",
    padding: "14px 24px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    "@media (max-width: 600px)": {
      padding: "12px 16px",
    },
  },
});

interface FormPageProps {
  backTo: string;
  backLabel: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Footer buttons; omitted when the card shows a final result instead. */
  actions?: ReactNode;
  /** Submit handler; Enter in a text field submits like the primary button. */
  onSubmit?: () => void;
  children: ReactNode;
}

export function FormPage({
  backTo,
  backLabel,
  title,
  subtitle,
  actions,
  onSubmit,
  children,
}: FormPageProps) {
  const styles = useStyles();
  return (
    <div className={styles.root}>
      <Link to={backTo} className={styles.back}>
        <ArrowLeftRegular />
        {backLabel}
      </Link>
      <PageHeader title={title} subtitle={subtitle} />
      <form
        className={styles.card}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit?.();
        }}
      >
        <div className={styles.body}>{children}</div>
        {actions && <div className={styles.footer}>{actions}</div>}
      </form>
    </div>
  );
}
