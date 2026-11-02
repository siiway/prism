// An icon button that copies a value and briefly shows how it went.

import { Button, Tooltip } from "@fluentui/react-components";
import {
  CheckmarkRegular,
  CopyRegular,
  DismissRegular,
} from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import { useCopy } from "../lib/useCopy";

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useTranslation();
  const { state, copy } = useCopy();
  return (
    <Tooltip
      content={
        state === "copied"
          ? t("common.copied")
          : state === "failed"
            ? t("common.copyFailed")
            : (label ?? t("common.copy"))
      }
      relationship="label"
      withArrow
    >
      <Button
        size="small"
        appearance="subtle"
        icon={
          state === "copied" ? (
            <CheckmarkRegular />
          ) : state === "failed" ? (
            <DismissRegular />
          ) : (
            <CopyRegular />
          )
        }
        onClick={() => void copy(text)}
      />
    </Tooltip>
  );
}
