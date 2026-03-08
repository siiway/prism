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
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
      showMsg("success", t("domains.domainMovedToTeam"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("domains.transferFailed"),
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
          <DialogTitle>{t("domains.transferPersonalTitle")}</DialogTitle>
          <DialogContent>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Text
                size={200}
                style={{ color: tokens.colorNeutralForeground3 }}
              >
                {t("domains.transferPersonalDesc")}
              </Text>
              <Field label={t("domains.selectDomain")} required>
                <Select
                  value={selectedDomainId}
                  onChange={(_, d) => setSelectedDomainId(d.value)}
                >
                  <option value="">{t("domains.chooseDomain")}</option>
                  {transferableDomains.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.domain}
                      {d.verified ? " ✓" : t("domains.unverifiedSuffix")}
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
              {t("common.cancel")}
            </Button>
            <Button
              appearance="primary"
              onClick={handleTransfer}
              disabled={transferring || !selectedDomainId}
            >
              {transferring ? (
                <Spinner size="tiny" />
              ) : (
                t("domains.transferToTeam")
              )}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
