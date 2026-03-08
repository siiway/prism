// Domain verification page

import {
  Button,
  Field,
  Input,
  MessageBar,
  Spinner,
  Text,
  Title2,
  tokens,
} from "@fluentui/react-components";
import { AddRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../lib/api";
import type { Domain, DomainAddResponse } from "../lib/api";
import { DomainDetailDialog } from "./domains/dialogs/DomainDetailDialog";
import { TransferDomainDialog } from "./domains/dialogs/TransferDomainDialog";
import { ShareDomainDialog } from "./domains/dialogs/ShareDomainDialog";
import { DomainsTable } from "./domains/DomainsTable";

export function Domains() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["domains"],
    queryFn: api.listDomains,
  });

  const { data: teamsData } = useQuery({
    queryKey: ["teams"],
    queryFn: api.listTeams,
  });
  // Only teams where user is admin/owner
  const manageableTeams = (teamsData?.teams ?? []).filter(
    (t) => t.role === "owner" || t.role === "admin",
  );

  const [newDomain, setNewDomain] = useState("");
  const [adding, setAdding] = useState(false);
  const [addedInfo, setAddedInfo] = useState<DomainAddResponse | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [selectedDomain, setSelectedDomain] = useState<Domain | null>(null);
  const [transferDomain, setTransferDomain] = useState<Domain | null>(null);
  const [shareDomain, setShareDomain] = useState<Domain | null>(null);

  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const handleAdd = async () => {
    setAdding(true);
    try {
      const res = await api.addDomain(newDomain.trim());
      setAddedInfo(res);
      setNewDomain("");
      await qc.invalidateQueries({ queryKey: ["domains"] });
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("domains.failedAddDomain"),
      );
    } finally {
      setAdding(false);
    }
  };

  const handleVerify = async (id: string) => {
    setVerifying(id);
    try {
      const res = await api.verifyDomain(id);
      if (res.verified) {
        showMsg("success", t("domains.domainVerified"));
        await qc.invalidateQueries({ queryKey: ["domains"] });
      } else {
        showMsg("error", t("domains.txtRecordNotFound"));
      }
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("domains.verificationFailed"),
      );
    } finally {
      setVerifying(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteDomain(id);
      await qc.invalidateQueries({ queryKey: ["domains"] });
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("domains.deleteFailed"),
      );
    }
  };

  const handleTransferToTeam = async (teamId: string) => {
    if (!transferDomain) return;
    try {
      await api.transferDomainToTeam(transferDomain.id, teamId);
      await qc.invalidateQueries({ queryKey: ["domains"] });
      await qc.invalidateQueries({ queryKey: ["team-domains", teamId] });
      setTransferDomain(null);
      showMsg("success", t("domains.domainMovedToTeam"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("domains.transferFailed"),
      );
      throw err;
    }
  };

  const handleShareToTeam = async (teamId: string) => {
    if (!shareDomain) return;
    try {
      await api.shareDomainToTeam(shareDomain.id, teamId);
      await qc.invalidateQueries({ queryKey: ["team-domains", teamId] });
      setShareDomain(null);
      showMsg("success", t("domains.domainSharedWithTeam"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("domains.shareFailed"),
      );
      throw err;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Title2>{t("domains.title")}</Title2>
      <Text style={{ color: tokens.colorNeutralForeground3 }}>
        {t("domains.description")}
      </Text>

      {message && (
        <MessageBar intent={message.type === "success" ? "success" : "error"}>
          {message.text}
        </MessageBar>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <Field label={t("domains.addDomain")} style={{ flex: 1 }}>
          <Input
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            placeholder={t("domains.addDomainPlaceholder")}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
        </Field>
        <Button
          appearance="primary"
          icon={<AddRegular />}
          onClick={handleAdd}
          disabled={adding || !newDomain}
          style={{ alignSelf: "flex-end" }}
        >
          {adding ? <Spinner size="tiny" /> : t("common.add")}
        </Button>
      </div>

      {addedInfo && (
        <div
          style={{
            padding: 16,
            borderRadius: 8,
            border: `1px solid ${tokens.colorNeutralStroke1}`,
            background: tokens.colorNeutralBackground3,
          }}
        >
          <Text weight="semibold" block>
            {t("domains.dnsInstructions", { domain: addedInfo.domain })}
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
              <code>{addedInfo.txt_record}</code>
            </Text>
            <Text size={200}>
              <strong>{t("domains.dnsValue")}:</strong>{" "}
              <code>{addedInfo.txt_value}</code>
            </Text>
          </div>
          <Button
            size="small"
            onClick={() => setAddedInfo(null)}
            style={{ marginTop: 12 }}
          >
            {t("common.dismiss")}
          </Button>
        </div>
      )}

      <DomainsTable
        domains={data?.domains ?? []}
        loading={isLoading}
        verifying={verifying}
        manageableTeams={manageableTeams}
        onVerify={handleVerify}
        onDelete={handleDelete}
        onSelectDomain={setSelectedDomain}
        onTransferDomain={setTransferDomain}
        onShareDomain={setShareDomain}
      />

      <DomainDetailDialog
        domain={selectedDomain}
        verifying={verifying === selectedDomain?.id}
        onClose={() => setSelectedDomain(null)}
        onVerify={handleVerify}
        onDelete={handleDelete}
      />

      <TransferDomainDialog
        domain={transferDomain}
        teams={manageableTeams}
        onClose={() => setTransferDomain(null)}
        onTransfer={handleTransferToTeam}
      />

      <ShareDomainDialog
        domain={shareDomain}
        teams={manageableTeams}
        onClose={() => setShareDomain(null)}
        onShare={handleShareToTeam}
      />
    </div>
  );
}
