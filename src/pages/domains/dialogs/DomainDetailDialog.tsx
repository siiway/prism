import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Spinner,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowClockwiseRegular,
  CheckmarkCircleRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Domain, VerificationMethod } from "../../../lib/api";
import { LabeledLine } from "../../../components/LabeledLine";
import { VerificationInstructions } from "../components";

interface DomainDetailDialogProps {
  domain: Domain | null;
  verifying: boolean;
  onClose: () => void;
  onVerify: (id: string, method: VerificationMethod) => Promise<void>;
  onDelete: (id: string) => void;
}

export function DomainDetailDialog({
  domain,
  verifying,
  onClose,
  onVerify,
  onDelete,
}: DomainDetailDialogProps) {
  const { t } = useTranslation();
  const [method, setMethod] = useState<VerificationMethod>("dns-txt");
  return (
    <Dialog
      open={!!domain}
      onOpenChange={(_, s) => {
        if (!s.open) onClose();
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle style={{ fontFamily: "monospace" }}>
            {domain?.domain}
          </DialogTitle>
          <DialogContent>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Badge
                color={domain?.verified ? "success" : "subtle"}
                appearance="filled"
                icon={domain?.verified ? <CheckmarkCircleRegular /> : undefined}
                style={{ width: "fit-content" }}
              >
                {domain?.verified
                  ? t("domains.verifiedBadge")
                  : t("domains.pending")}
              </Badge>

              {!!domain?.verified_at && (
                <LabeledLine label={t("domains.verifiedLabel")}>
                  {new Date(domain.verified_at * 1000).toLocaleDateString()}
                </LabeledLine>
              )}
              {!!domain?.verified && domain.verification_method && (
                <LabeledLine label={t("domains.methodLabel")}>
                  {t(`domains.method.${domain.verification_method}`)}
                </LabeledLine>
              )}
              {!!domain?.next_reverify_at && (
                <LabeledLine label={t("domains.nextReverifyLabel")}>
                  {new Date(
                    domain.next_reverify_at * 1000,
                  ).toLocaleDateString()}
                </LabeledLine>
              )}

              {!domain?.verified && domain && (
                <VerificationInstructions
                  domain={domain}
                  method={method}
                  onMethodChange={setMethod}
                />
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>{t("common.close")}</Button>
            <Button
              appearance="outline"
              icon={<ArrowClockwiseRegular />}
              disabled={verifying}
              onClick={async () => {
                if (!domain) return;
                await onVerify(domain.id, method);
                onClose();
              }}
            >
              {verifying ? <Spinner size="tiny" /> : t("common.verify")}
            </Button>
            <Button
              appearance="primary"
              style={{ background: tokens.colorPaletteRedBackground3 }}
              onClick={() => {
                if (!domain) return;
                onDelete(domain.id);
                onClose();
              }}
            >
              {t("common.delete")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
