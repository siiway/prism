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
import type { Domain } from "../../../lib/api";

interface TeamDomainDetailDialogProps {
  domain: Domain | null;
  canManage: boolean;
  verifyingDomain: string | null;
  onClose: () => void;
  onVerify: (domainId: string) => Promise<void>;
}

export function TeamDomainDetailDialog({
  domain,
  canManage,
  verifyingDomain,
  onClose,
  onVerify,
}: TeamDomainDetailDialogProps) {
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
                {domain?.verified ? "Verified" : "Pending"}
              </Badge>
              {domain?.verified_at && (
                <Text size={200}>
                  <strong>Verified:</strong>{" "}
                  {new Date(domain.verified_at * 1000).toLocaleDateString()}
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
                    Add this DNS TXT record:
                  </Text>
                  <Text size={200}>
                    <strong>Name:</strong>{" "}
                    <code>_prism-verify.{domain?.domain}</code>
                  </Text>
                  <Text size={200}>
                    <strong>Value:</strong>{" "}
                    <code>prism-verify={domain?.verification_token}</code>
                  </Text>
                </div>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>Close</Button>
            {canManage && (
              <Button
                appearance="outline"
                icon={<ArrowClockwiseRegular />}
                disabled={verifyingDomain === domain?.id}
                onClick={async () => {
                  if (!domain) return;
                  await onVerify(domain.id);
                  onClose();
                }}
              >
                {verifyingDomain === domain?.id ? (
                  <Spinner size="tiny" />
                ) : (
                  "Verify"
                )}
              </Button>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
