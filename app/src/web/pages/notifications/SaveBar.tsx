// Sticky footer for a card edited as a draft: what state the draft is in,
// Discard and Save. Shown only while there is something to save or it was
// just saved; idle, the card ends at its last row.

import {
  Button,
  Spinner,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { CheckmarkRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";

const useStyles = makeStyles({
  bar: {
    position: "sticky",
    bottom: 0,
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "8px",
    padding: "12px var(--card-pad)",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    borderBottomLeftRadius: tokens.borderRadiusXLarge,
    borderBottomRightRadius: tokens.borderRadiusXLarge,
    background: tokens.colorNeutralBackground1,
  },
  status: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginRight: "auto",
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground3,
  },
  statusOk: {
    color: tokens.colorStatusSuccessForeground1,
  },
});

export function SaveBar({
  dirty,
  saved,
  pending,
  savedLabel,
  onDiscard,
  onSave,
}: {
  dirty: boolean;
  /** Just saved; shows `savedLabel` for a moment. */
  saved: boolean;
  pending: boolean;
  savedLabel: string;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  if (!dirty && !saved && !pending) return null;
  return (
    <div className={styles.bar}>
      <span
        className={mergeClasses(styles.status, saved && styles.statusOk)}
        role="status"
      >
        {saved ? (
          <>
            <CheckmarkRegular />
            {savedLabel}
          </>
        ) : dirty ? (
          t("notifications.unsaved")
        ) : null}
      </span>
      <Button disabled={!dirty || pending} onClick={onDiscard}>
        {t("common.discard")}
      </Button>
      <Button
        appearance="primary"
        disabled={!dirty || pending}
        onClick={onSave}
      >
        {pending ? <Spinner size="tiny" /> : t("common.saveChanges")}
      </Button>
    </div>
  );
}
