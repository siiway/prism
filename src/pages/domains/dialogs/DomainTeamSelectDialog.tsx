import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Spinner,
  Text,
} from "@fluentui/react-components";
import { Select } from "../../../components/Select";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Domain, Team } from "../../../lib/api";

// Shared "pick a team, then act on this domain" dialog backing both the
// share-with-team and move-to-team flows. Title/description/action label
// come in pre-translated so the i18n keys stay literal at the call sites,
// where the static key checker can verify them.
interface DomainTeamSelectDialogProps {
  domain: Domain | null;
  teams: Team[];
  title: string;
  description: string;
  actionLabel: string;
  onClose: () => void;
  onConfirm: (teamId: string) => Promise<void>;
}

export function DomainTeamSelectDialog({
  domain,
  teams,
  title,
  description,
  actionLabel,
  onClose,
  onConfirm,
}: DomainTeamSelectDialogProps) {
  const { t } = useTranslation();
  const [teamId, setTeamId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    if (!teamId) return;
    setSubmitting(true);
    try {
      await onConfirm(teamId);
      setTeamId("");
    } finally {
      setSubmitting(false);
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
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Text>{description}</Text>
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
              onClick={handleConfirm}
              disabled={submitting || !teamId}
            >
              {submitting ? <Spinner size="tiny" /> : actionLabel}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
