// Edit the per-event rules as raw JSON. Applying hands the parsed rules back
// to the Events card as unsaved changes; nothing is saved from here.

import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Field,
  Textarea,
  makeStyles,
} from "@fluentui/react-components";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { NotificationRules } from "../../lib/api";
import { useNotificationStyles } from "./styles";

const useStyles = makeStyles({
  surface: {
    maxWidth: "720px",
  },
});

export function JsonDialog({
  open,
  rules,
  onApply,
  onClose,
}: {
  open: boolean;
  /** The rules to start from each time the dialog opens. */
  rules: NotificationRules;
  onApply: (rules: NotificationRules) => void;
  onClose: () => void;
}) {
  const styles = useStyles();
  const shared = useNotificationStyles();
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Reload the text from the current rules on every open (render-time sync,
  // like the page's other drafts, instead of an effect).
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setText(JSON.stringify(rules, null, 2));
      setError(null);
    }
  }

  function apply() {
    try {
      const parsed = JSON.parse(text) as NotificationRules;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      )
        throw new Error("root must be an object");
      onApply(parsed);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(_, d) => {
        if (!d.open) onClose();
      }}
    >
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>{t("notifications.jsonTitle")}</DialogTitle>
          <DialogContent>
            <Field
              hint={t("notifications.jsonHint")}
              validationMessage={
                error ? t("notifications.jsonError", { error }) : undefined
              }
            >
              <Textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setError(null);
                }}
                rows={18}
                resize="vertical"
                textarea={{ className: shared.monoInput }}
              />
            </Field>
          </DialogContent>
          <DialogActions>
            <DialogTrigger disableButtonEnhancement>
              <Button>{t("common.cancel")}</Button>
            </DialogTrigger>
            <Button appearance="primary" onClick={apply}>
              {t("notifications.jsonApply")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
