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
import type { Domain } from "../../../lib/api";

interface DeleteDomainDialogProps {
  domain: Domain;
  onDelete: (id: string) => void;
}

export function DeleteDomainDialog({
  domain,
  onDelete,
}: DeleteDomainDialogProps) {
  return (
    <Dialog>
      <DialogTrigger disableButtonEnhancement>
        <Button icon={<DeleteRegular />} size="small" appearance="subtle" />
      </DialogTrigger>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Remove domain?</DialogTitle>
          <DialogContent>
            Remove <strong>{domain.domain}</strong> from your verified domains?
          </DialogContent>
          <DialogActions>
            <DialogTrigger>
              <Button>Cancel</Button>
            </DialogTrigger>
            <Button
              appearance="primary"
              style={{ background: tokens.colorPaletteRedBackground3 }}
              onClick={() => onDelete(domain.id)}
            >
              Remove
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
