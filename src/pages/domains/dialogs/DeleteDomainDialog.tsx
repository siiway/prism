import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  tokens,
} from "@fluentui/react-components";
import { DeleteRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import type { Domain } from "../../../lib/api";

interface DeleteDomainDialogProps {
  domain: Domain;
  onDelete: (id: string) => void;
}

export function DeleteDomainDialog({
  domain,
  onDelete,
}: DeleteDomainDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog>
      <DialogTrigger disableButtonEnhancement>
        <Button icon={<DeleteRegular />} size="small" appearance="subtle" />
      </DialogTrigger>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t("domains.removeDomain")}</DialogTitle>
          <DialogContent>
            {t("domains.removeDomainDesc", { domain: domain.domain })}
          </DialogContent>
          <DialogActions>
            <DialogTrigger>
              <Button>{t("common.cancel")}</Button>
            </DialogTrigger>
            <Button
              appearance="primary"
              style={{ background: tokens.colorPaletteRedBackground3 }}
              onClick={() => onDelete(domain.id)}
            >
              {t("common.remove")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
