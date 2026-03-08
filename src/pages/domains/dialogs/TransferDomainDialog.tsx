import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Select,
  Spinner,
  Text,
} from "@fluentui/react-components";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Domain, Team } from "../../../lib/api";

interface TransferDomainDialogProps {
  domain: Domain | null;
  teams: Team[];
  onClose: () => void;
  onTransfer: (teamId: string) => Promise<void>;
}

export function TransferDomainDialog({
  domain,
  teams,
  onClose,
  onTransfer,
}: TransferDomainDialogProps) {
  const { t } = useTranslation();
  const [teamId, setTeamId] = useState("");
  const [transferring, setTransferring] = useState(false);

  const handleTransfer = async () => {
    if (!teamId) return;
    setTransferring(true);
    try {
      await onTransfer(teamId);
      setTeamId("");
    } finally {
      setTransferring(false);
    }
  };

  return (
    <Dialog
      open={!!domain}
      onOpenChange={(_, s) => {
        if (!s.open) {
          setTeamId("");
          onClose();
        }
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t("domains.moveDomainToTeam")}</DialogTitle>
          <DialogContent>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Text>
                {t("domains.moveDomainDesc", { domain: domain?.domain ?? "" })}
              </Text>
              <Field label={t("domains.selectTeam")} required>
                <Select value={teamId} onChange={(_, d) => setTeamId(d.value)}>
                  <option value="">{t("domains.chooseTeam")}</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                setTeamId("");
                onClose();
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              appearance="primary"
              onClick={handleTransfer}
              disabled={transferring || !teamId}
            >
              {transferring ? (
                <Spinner size="tiny" />
              ) : (
                t("domains.moveToTeamAction")
              )}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
