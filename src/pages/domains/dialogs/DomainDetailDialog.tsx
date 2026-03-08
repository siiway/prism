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
  Text,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowClockwiseRegular,
  CheckmarkCircleRegular,
} from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import type { Domain } from "../../../lib/api";

interface DomainDetailDialogProps {
  domain: Domain | null;
  verifying: boolean;
  onClose: () => void;
  onVerify: (id: string) => Promise<void>;
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

              {domain?.verified_at && (
                <Text size={200}>
                  <strong>{t("domains.verifiedLabel")}:</strong>{" "}
                  {new Date(domain.verified_at * 1000).toLocaleDateString()}
                </Text>
              )}
              {domain?.next_reverify_at && (
                <Text size={200}>
                  <strong>{t("domains.nextReverifyLabel")}:</strong>{" "}
                  {new Date(
                    domain.next_reverify_at * 1000,
                  ).toLocaleDateString()}
                </Text>
              )}

              {!domain?.verified && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    padding: "10px 12px",
                    borderRadius: 6,
                    background: tokens.colorNeutralBackground3,
                  }}
                >
                  <Text size={200} weight="semibold">
                    {t("domains.addDnsTxtRecord")}
                  </Text>
                  <Text size={200}>
                    <strong>{t("domains.dnsName")}:</strong>{" "}
                    <code>_prism-verify.{domain?.domain}</code>
                  </Text>
                  <Text size={200}>
                    <strong>{t("domains.dnsValue")}:</strong>{" "}
                    <code>prism-verify={domain?.verification_token}</code>
                  </Text>
                </div>
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
                await onVerify(domain.id);
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
