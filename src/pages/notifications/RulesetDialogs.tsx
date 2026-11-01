// Name (new or rename) and delete dialogs for the Rulesets card.

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
  Input,
  tokens,
} from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import type { NotificationRuleset } from "../../lib/api";

export type NameDialogState =
  | { mode: "new"; value: string }
  | { mode: "rename"; ruleset: NotificationRuleset; value: string };

export function RulesetNameDialog({
  state,
  onChange,
  onSubmit,
  onClose,
}: {
  /** Null while closed. */
  state: NameDialogState | null;
  onChange: (state: NameDialogState) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const rename = state?.mode === "rename";
  return (
    <Dialog
      open={state !== null}
      onOpenChange={(_, d) => {
        if (!d.open) onClose();
      }}
    >
      <DialogSurface>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <DialogBody>
            <DialogTitle>
              {rename
                ? t("notifications.rulesetsRename")
                : t("notifications.rulesetsNew")}
            </DialogTitle>
            <DialogContent>
              <Field
                label={
                  state?.mode === "rename"
                    ? t("notifications.rulesetsRenamePrompt", {
                        name: state.ruleset.name,
                      })
                    : t("notifications.rulesetsNamePrompt")
                }
              >
                <Input
                  autoFocus
                  value={state?.value ?? ""}
                  onChange={(_, d) => {
                    if (state) onChange({ ...state, value: d.value });
                  }}
                />
              </Field>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button type="button">{t("common.cancel")}</Button>
              </DialogTrigger>
              <Button
                type="submit"
                appearance="primary"
                disabled={!state?.value.trim()}
              >
                {rename ? t("common.save") : t("common.create")}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}

export function RulesetDeleteDialog({
  ruleset,
  onConfirm,
  onClose,
}: {
  /** The ruleset to delete; null while closed. */
  ruleset: NotificationRuleset | null;
  onConfirm: (ruleset: NotificationRuleset) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={ruleset !== null}
      onOpenChange={(_, d) => {
        if (!d.open) onClose();
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t("notifications.rulesetsDelete")}</DialogTitle>
          <DialogContent>
            {ruleset &&
              t("notifications.rulesetsDeleteConfirm", {
                name: ruleset.name,
              })}
          </DialogContent>
          <DialogActions>
            <DialogTrigger disableButtonEnhancement>
              <Button>{t("common.cancel")}</Button>
            </DialogTrigger>
            <Button
              appearance="primary"
              style={{ background: tokens.colorPaletteRedBackground3 }}
              onClick={() => {
                if (ruleset) onConfirm(ruleset);
                onClose();
              }}
            >
              {t("common.delete")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
