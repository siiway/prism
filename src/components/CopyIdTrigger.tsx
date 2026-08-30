// Click-to-copy wrapper for list avatars/icons.
//
// The My Apps / Teams / Team members / Authorized apps lists show an avatar
// per row; wrapping it in this trigger lets a click copy the row's id
// (client id for apps, user id for users, team id for teams) without
// navigating. The click is stopped so a surrounding card's navigate handler
// doesn't fire too.

import { Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import {
  useState,
  type ReactNode,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useTranslation } from "react-i18next";

const useStyles = makeStyles({
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
  children: ReactNode;
}

export function CopyIdTrigger({ id, label, children }: CopyIdTriggerProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const copy = () => {
    void navigator.clipboard
      .writeText(id)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Clipboard access can be denied (permission, insecure context).
        // Surface the failure in the tooltip instead of swallowing the
        // rejection and silently leaving nothing copied.
        setFailed(true);
        setTimeout(() => setFailed(false), 1500);
      });
  };

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
        copied ? t("common.copied") : failed ? t("common.copyFailed") : label
      }
      relationship="label"
    >
      <div
        className={styles.trigger}
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
