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

interface DeleteTeamDomainDialogProps {
  domain: Domain;
  onDelete: (id: string) => void;
}

export function DeleteTeamDomainDialog({
  domain,
  onDelete,
}: DeleteTeamDomainDialogProps) {
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
            {t("domains.removeDomainTeamDesc", { domain: domain.domain })}
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
