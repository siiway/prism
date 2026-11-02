// Password field with a show/hide toggle. Drop-in replacement for
// <Input type="password">; all other InputProps pass through.

import { Button, Input, Tooltip } from "@fluentui/react-components";
import type { InputProps } from "@fluentui/react-components";
import { EyeOffRegular, EyeRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function PasswordInput(props: Omit<InputProps, "type">) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  return (
    <Input
      {...props}
      type={visible ? "text" : "password"}
      contentAfter={
        <Tooltip
          content={
            visible ? t("common.hidePassword") : t("common.showPassword")
          }
          relationship="label"
        >
          <Button
            appearance="transparent"
            size="small"
            icon={visible ? <EyeOffRegular /> : <EyeRegular />}
            onClick={() => setVisible((v) => !v)}
            // Keep the toggle out of the tab order so Tab moves between
            // form fields; the tooltip still labels it for pointer users.
            tabIndex={-1}
          />
        </Tooltip>
      }
    />
  );
}
