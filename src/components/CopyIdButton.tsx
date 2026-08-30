import { Button, Tooltip } from "@fluentui/react-components";
import {
  CheckmarkRegular,
  CopyRegular,
  DismissRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function CopyIdButton({ id, label }: { id: string; label?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  function copy() {
    void navigator.clipboard
      .writeText(id)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Clipboard access can be denied (permission, insecure context).
        // Surface the failure instead of swallowing the rejection and
        // silently leaving nothing copied.
        setFailed(true);
        setTimeout(() => setFailed(false), 1500);
      });
  }

  return (
    <Tooltip
      content={
        copied
          ? t("common.copied")
          : failed
            ? t("common.copyFailed")
            : (label ?? t("common.copyId"))
      }
      relationship="label"
    >
      <Button
        size="small"
        appearance="subtle"
        icon={
          copied ? (
            <CheckmarkRegular />
          ) : failed ? (
            <DismissRegular />
          ) : (
            <CopyRegular />
          )
        }
        onClick={copy}
      />
    </Tooltip>
  );
}
