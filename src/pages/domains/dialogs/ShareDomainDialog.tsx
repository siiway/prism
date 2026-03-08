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
  const { t } = useTranslation();
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
          <DialogTitle>{t("domains.shareDomainWithTeam")}</DialogTitle>
          <DialogContent>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Text>
                {t("domains.shareDomainDesc", { domain: domain?.domain ?? "" })}
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
              onClick={handleShare}
              disabled={sharing || !teamId}
            >
              {sharing ? (
                <Spinner size="tiny" />
              ) : (
                t("domains.shareWithTeamAction")
              )}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
