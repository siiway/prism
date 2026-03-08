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
  tokens,
} from "@fluentui/react-components";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Domain } from "../../../lib/api";

interface TransferFromPersonalDialogProps {
  teamId: string;
  open: boolean;
  transferableDomains: Domain[];
  onClose: () => void;
  showMsg: (type: "success" | "error", text: string) => void;
}

export function TransferFromPersonalDialog({
  teamId,
  open,
  transferableDomains,
  onClose,
  showMsg,
}: TransferFromPersonalDialogProps) {
  const qc = useQueryClient();
  const [selectedDomainId, setSelectedDomainId] = useState("");
  const [transferring, setTransferring] = useState(false);

  const handleTransfer = async () => {
    if (!selectedDomainId) return;
    setTransferring(true);
    try {
      await api.transferDomainToTeam(selectedDomainId, teamId);
      await qc.invalidateQueries({ queryKey: ["team-domains", teamId] });
      await qc.invalidateQueries({ queryKey: ["domains"] });
      setSelectedDomainId("");
      onClose();
      showMsg("success", "Domain moved to team");
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : "Transfer failed",
      );
    } finally {
      setTransferring(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(_, d) => {
        if (!d.open) {
          setSelectedDomainId("");
          onClose();
        }
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Transfer personal domain to team</DialogTitle>
          <DialogContent>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Text
                size={200}
                style={{ color: tokens.colorNeutralForeground3 }}
              >
                Move one of your verified personal domains into this team. It
                will be used to verify team apps.
              </Text>
              <Field label="Select domain" required>
                <Select
                  value={selectedDomainId}
                  onChange={(_, d) => setSelectedDomainId(d.value)}
                >
                  <option value="">— choose a domain —</option>
                  {transferableDomains.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.domain}
                      {d.verified ? " ✓" : " (unverified)"}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                setSelectedDomainId("");
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button
              appearance="primary"
              onClick={handleTransfer}
              disabled={transferring || !selectedDomainId}
            >
              {transferring ? <Spinner size="tiny" /> : "Transfer to team"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
