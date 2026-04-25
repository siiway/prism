// Domains table + management UI for TeamDetail

import {
  Badge,
  Button,
  Field,
  Input,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Tooltip,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  ArrowClockwiseRegular,
  CheckmarkCircleRegular,
  CopyRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  api,
  ApiError,
  type Domain,
  type DomainAddResponse,
  type VerificationMethod,
} from "../../lib/api";
import { TransferFromPersonalDialog } from "./dialogs/TransferFromPersonalDialog";
import { TeamDomainDetailDialog } from "./dialogs/TeamDomainDetailDialog";
import { DeleteTeamDomainDialog } from "./dialogs/DeleteTeamDomainDialog";
import { SkeletonTableRows } from "../../components/Skeletons";

interface DomainsTableProps {
  teamId: string;
  domains: Domain[];
  loading: boolean;
  canManage: boolean;
  verifyingDomain: string | null;
  transferableDomains: Domain[];
  showMsg: (type: "success" | "error", text: string) => void;
}

export function DomainsTable({
  teamId,
  domains,
  loading,
  canManage,
  verifyingDomain: verifyingDomainProp,
  transferableDomains,
  showMsg,
}: DomainsTableProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [newDomain, setNewDomain] = useState("");
  const [addingDomain, setAddingDomain] = useState(false);
  const [addedDomainInfo, setAddedDomainInfo] =
    useState<DomainAddResponse | null>(null);
  const [verifyingDomain, setVerifyingDomain] = useState<string | null>(
    verifyingDomainProp,
  );
  const [selectedDomain, setSelectedDomain] = useState<Domain | null>(null);
  const [fromPersonalOpen, setFromPersonalOpen] = useState(false);

  const handleAddDomain = async () => {
    if (!newDomain.trim()) return;
    setAddingDomain(true);
    try {
      const res = await api.addTeamDomain(teamId, newDomain.trim());
      setAddedDomainInfo(res);
      setNewDomain("");
      await qc.invalidateQueries({ queryKey: ["team-domains", teamId] });
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("domains.failedAddDomain"),
      );
    } finally {
      setAddingDomain(false);
    }
  };

  const handleVerifyDomain = async (
    domainId: string,
    method?: VerificationMethod,
  ) => {
    setVerifyingDomain(domainId);
    try {
      const res = await api.verifyTeamDomain(teamId, domainId, method);
      if (res.verified) {
        showMsg("success", t("domains.domainVerified"));
        await qc.invalidateQueries({ queryKey: ["team-domains", teamId] });
      } else {
        showMsg("error", t("domains.verificationCheckFailed"));
      }
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("domains.verificationFailed"),
      );
    } finally {
      setVerifyingDomain(null);
    }
  };

  const handleDeleteDomain = async (domainId: string) => {
    try {
      await api.deleteTeamDomain(teamId, domainId);
      await qc.invalidateQueries({ queryKey: ["team-domains", teamId] });
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("domains.deleteFailed"),
      );
    }
  };

  const handleReturnToPersonal = async (domainId: string) => {
    try {
      await api.returnDomainToPersonal(teamId, domainId);
      await qc.invalidateQueries({ queryKey: ["team-domains", teamId] });
      await qc.invalidateQueries({ queryKey: ["domains"] });
      showMsg("success", t("domains.domainReturnedToPersonal"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("domains.transferFailed"),
      );
    }
  };

  const handleShareToPersonal = async (domainId: string) => {
    try {
      await api.shareTeamDomainToPersonal(teamId, domainId);
      await qc.invalidateQueries({ queryKey: ["domains"] });
      showMsg("success", t("domains.domainSharedToPersonal"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("domains.shareFailed"),
      );
    }
  };

  return (
    <>
      {canManage && (
        <>
          <div style={{ display: "flex", gap: 8 }}>
            <Field label={t("domains.addDomain")} style={{ flex: 1 }}>
              <Input
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                placeholder={t("domains.addDomainPlaceholder")}
                onKeyDown={(e) => e.key === "Enter" && handleAddDomain()}
              />
            </Field>
            <Button
              appearance="primary"
              icon={<AddRegular />}
              onClick={handleAddDomain}
              disabled={addingDomain || !newDomain}
              style={{ alignSelf: "flex-end" }}
            >
              {addingDomain ? <Spinner size="tiny" /> : t("common.add")}
            </Button>
            {transferableDomains.length > 0 && (
              <Button
                style={{ alignSelf: "flex-end" }}
                onClick={() => setFromPersonalOpen(true)}
              >
                {t("domains.transferFromPersonal")}
              </Button>
            )}
          </div>

          <TransferFromPersonalDialog
            teamId={teamId}
            open={fromPersonalOpen}
            transferableDomains={transferableDomains}
            onClose={() => setFromPersonalOpen(false)}
            showMsg={showMsg}
          />
        </>
      )}

      {addedDomainInfo && (
        <div
          style={{
            padding: 16,
            borderRadius: 8,
            border: `1px solid ${tokens.colorNeutralStroke1}`,
            background: tokens.colorNeutralBackground3,
          }}
        >
          <Text weight="semibold" block>
            {t("domains.dnsInstructions", { domain: addedDomainInfo.domain })}
          </Text>
          <div
            style={{
              marginTop: 8,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <Text size={200}>
              <strong>{t("domains.dnsType")}:</strong> TXT
            </Text>
            <Text size={200}>
              <strong>{t("domains.dnsName")}:</strong>{" "}
              <code>{addedDomainInfo.txt_record}</code>
            </Text>
            <Text size={200}>
              <strong>{t("domains.dnsValue")}:</strong>{" "}
              <code>{addedDomainInfo.txt_value}</code>
            </Text>
          </div>
          <Button
            size="small"
            onClick={() => setAddedDomainInfo(null)}
            style={{ marginTop: 12 }}
          >
            {t("common.dismiss")}
          </Button>
        </div>
      )}

      {loading && <SkeletonTableRows rows={5} cols={4} />}
      {!loading && domains.length === 0 && (
        <Text
          style={{
            color: tokens.colorNeutralForeground3,
            textAlign: "center",
            padding: "32px 0",
          }}
        >
          {t("domains.noDomainsYet")}
        </Text>
      )}

      {domains.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>{t("domains.domainHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("domains.statusHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("domains.verifiedAtHeader")}</TableHeaderCell>
              {canManage && (
                <TableHeaderCell>{t("domains.actionsHeader")}</TableHeaderCell>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {domains.map((d) => (
              <TableRow
                key={d.id}
                style={{ cursor: "pointer" }}
                onClick={() => setSelectedDomain(d)}
              >
                <TableCell style={{ fontFamily: "monospace" }}>
                  {d.domain}
                </TableCell>
                <TableCell>
                  <Badge
                    color={d.verified ? "success" : "subtle"}
                    appearance="filled"
                    icon={d.verified ? <CheckmarkCircleRegular /> : undefined}
                  >
                    {d.verified
                      ? t("domains.verifiedBadge")
                      : t("domains.pending")}
                  </Badge>
                </TableCell>
                <TableCell>
                  {d.verified_at
                    ? new Date(d.verified_at * 1000).toLocaleDateString()
                    : "—"}
                </TableCell>
                {canManage && (
                  <TableCell>
                    <div
                      style={{ display: "flex", gap: 4 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        icon={<ArrowClockwiseRegular />}
                        size="small"
                        appearance="subtle"
                        disabled={verifyingDomain === d.id}
                        onClick={() => handleVerifyDomain(d.id)}
                      >
                        {verifyingDomain === d.id ? (
                          <Spinner size="tiny" />
                        ) : (
                          t("common.verify")
                        )}
                      </Button>
                      <DeleteTeamDomainDialog
                        domain={d}
                        onDelete={handleDeleteDomain}
                      />
                      <Tooltip
                        content={t("domains.returnToPersonalTooltip")}
                        relationship="label"
                      >
                        <Button
                          size="small"
                          appearance="subtle"
                          onClick={() => handleReturnToPersonal(d.id)}
                        >
                          {t("domains.returnToPersonal")}
                        </Button>
                      </Tooltip>
                      <Tooltip
                        content={t("domains.shareToPersonalTooltip")}
                        relationship="label"
                      >
                        <Button
                          size="small"
                          appearance="subtle"
                          icon={<CopyRegular />}
                          onClick={() => handleShareToPersonal(d.id)}
                        />
                      </Tooltip>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <TeamDomainDetailDialog
        domain={selectedDomain}
        canManage={canManage}
        verifyingDomain={verifyingDomain}
        onClose={() => setSelectedDomain(null)}
        onVerify={handleVerifyDomain}
      />
    </>
  );
}
