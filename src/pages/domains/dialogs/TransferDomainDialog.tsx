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
          <DialogTitle>Move domain to team</DialogTitle>
          <DialogContent>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Text>
                Move{" "}
                <strong style={{ fontFamily: "monospace" }}>
                  {domain?.domain}
                </strong>{" "}
                to a team. The domain will be removed from your personal domains
                and managed by the team.
              </Text>
              <Field label="Select team" required>
                <Select value={teamId} onChange={(_, d) => setTeamId(d.value)}>
                  <option value="">— choose a team —</option>
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
              Cancel
            </Button>
            <Button
              appearance="primary"
              onClick={handleTransfer}
              disabled={transferring || !teamId}
            >
              {transferring ? <Spinner size="tiny" /> : "Move to team"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
