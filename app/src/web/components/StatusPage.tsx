// A full-page message: an icon or code, a title, a line of explanation and
// where to go next. Used for 404, access denied and signed-out pages.

import {
  Button,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

const useStyles = makeStyles({
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: tokens.colorNeutralBackground1,
    padding: "16px",
    boxSizing: "border-box",
  },
  card: {
    width: "100%",
    maxWidth: "480px",
    padding: "48px 40px",
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground2,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "16px",
    textAlign: "center",
  },
  description: { color: tokens.colorNeutralForeground3 },
  actions: { display: "flex", gap: "8px", marginTop: "8px" },
});

export function StatusPage({
  mark,
  title,
  description,
  back,
  primary,
}: {
  /** The big code or icon above the title. */
  mark: ReactNode;
  title: ReactNode;
  description: ReactNode;
  /** Label for a "go back" button, when going back makes sense. */
  back?: string;
  /** The main way on. */
  primary: { label: string; to: string };
}) {
  const styles = useStyles();
  const navigate = useNavigate();
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {mark}
        <Title2>{title}</Title2>
        <Text className={styles.description}>{description}</Text>
        <div className={styles.actions}>
          {back && <Button onClick={() => navigate(-1)}>{back}</Button>}
          <Button appearance="primary" onClick={() => navigate(primary.to)}>
            {primary.label}
          </Button>
        </div>
      </div>
    </div>
  );
}
