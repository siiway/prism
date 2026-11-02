// Click-to-copy wrapper for list avatars/icons.
//
// The My Apps / Teams / Team members / Authorized apps lists show an avatar
// per row; wrapping it in this trigger lets a click copy the row's id
// (client id for apps, user id for users, team id for teams) without
// navigating. The click is stopped so a surrounding card's navigate handler
// doesn't fire too.

import {
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { type ReactNode, type KeyboardEvent, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { CopyRegular } from "@fluentui/react-icons";
import { useCopy } from "../lib/useCopy";

const useStyles = makeStyles({
  text: {
    justifyContent: "flex-start",
    gap: "6px",
    maxWidth: "100%",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },
  ellipsis: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  trigger: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    borderRadius: tokens.borderRadiusMedium,
    transitionProperty: "opacity",
    transitionDuration: "0.1s",
    ":hover": { opacity: 0.75 },
    ":focus-visible": {
      outline: `2px solid ${tokens.colorCompoundBrandForeground1}`,
    },
  },
});

interface CopyIdTriggerProps {
  id: string;
  /** Tooltip label describing what gets copied. */
  label: string;
  /** Tooltip label to flash on success. Defaults to a generic "Copied!".
   *  Callers should pass a specific label (e.g. "Copied team ID") so the
   *  confirmation says *what* landed on the clipboard. */
  copiedLabel?: string;
  /** Extra styles for the trigger, e.g. left-aligned text in a table cell. */
  className?: string;
  children: ReactNode;
}

export function CopyIdTrigger({
  id,
  label,
  copiedLabel,
  className,
  children,
}: CopyIdTriggerProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const { state, copy: copyText } = useCopy();
  const copy = () => void copyText(id);

  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    copy();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      copy();
    }
  };

  return (
    <Tooltip
      content={
        state === "copied"
          ? (copiedLabel ?? t("common.copied"))
          : state === "failed"
            ? t("common.copyFailed")
            : label
      }
      relationship="label"
    >
      <div
        className={mergeClasses(styles.trigger, className)}
        role="button"
        tabIndex={0}
        aria-label={label}
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </Tooltip>
  );
}

/** An id in monospace with a copy icon, copied on click — a list cell or a
 *  page footer. */
export function CopyIdText({
  id,
  label,
  copiedLabel,
}: {
  id: string;
  label: string;
  copiedLabel?: string;
}) {
  const styles = useStyles();
  return (
    <CopyIdTrigger
      id={id}
      label={label}
      copiedLabel={copiedLabel}
      className={styles.text}
    >
      <span className={styles.ellipsis}>{id}</span>
      <CopyRegular />
    </CopyIdTrigger>
  );
}
