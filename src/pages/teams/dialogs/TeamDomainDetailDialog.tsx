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
} from "@fluentui/react-components";
import {
  ArrowClockwiseRegular,
  CheckmarkCircleRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Domain, VerificationMethod } from "../../../lib/api";
import { LabeledLine } from "../../../components/LabeledLine";
import { VerificationInstructions } from "../../domains/components";

interface TeamDomainDetailDialogProps {
  domain: Domain | null;
  canManage: boolean;
  verifyingDomain: string | null;
  onClose: () => void;
  onVerify: (domainId: string, method: VerificationMethod) => Promise<void>;
}

export function TeamDomainDetailDialog({
  domain,
  canManage,
  verifyingDomain,
  onClose,
  onVerify,
}: TeamDomainDetailDialogProps) {
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
            {canManage && (
              <Button
                appearance="outline"
                icon={<ArrowClockwiseRegular />}
                disabled={verifyingDomain === domain?.id}
                onClick={async () => {
                  if (!domain) return;
                  await onVerify(domain.id, method);
                  onClose();
                }}
              >
                {verifyingDomain === domain?.id ? (
                  <Spinner size="tiny" />
                ) : (
                  t("common.verify")
                )}
              </Button>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
