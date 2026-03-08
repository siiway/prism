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

interface ShareDomainDialogProps {
  domain: Domain | null;
  teams: Team[];
  onClose: () => void;
  onShare: (teamId: string) => Promise<void>;
}

export function ShareDomainDialog({
  domain,
  teams,
  onClose,
  onShare,
}: ShareDomainDialogProps) {
  const [teamId, setTeamId] = useState("");
  const [sharing, setSharing] = useState(false);

  const handleShare = async () => {
    if (!teamId) return;
    setSharing(true);
    try {
      await onShare(teamId);
      setTeamId("");
    } finally {
      setSharing(false);
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
          <DialogTitle>Share domain with team</DialogTitle>
          <DialogContent>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Text>
                Share{" "}
                <strong style={{ fontFamily: "monospace" }}>
                  {domain?.domain}
                </strong>{" "}
                with a team. The domain will also appear in the team's verified
                domains — your personal copy is kept.
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
              onClick={handleShare}
              disabled={sharing || !teamId}
            >
              {sharing ? <Spinner size="tiny" /> : "Share with team"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
