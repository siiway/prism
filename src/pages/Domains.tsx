// Domain verification page

import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  MessageBar,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Title2,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  CheckmarkCircleRegular,
  DeleteRegular,
  ArrowClockwiseRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import type { DomainAddResponse } from "../lib/api";

export function Domains() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["domains"],
    queryFn: api.listDomains,
  });

  const [newDomain, setNewDomain] = useState("");
  const [adding, setAdding] = useState(false);
  const [addedInfo, setAddedInfo] = useState<DomainAddResponse | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);

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
        err instanceof ApiError ? err.message : "Failed to add domain",
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
        showMsg("success", "Domain verified!");
        await qc.invalidateQueries({ queryKey: ["domains"] });
      } else {
        showMsg(
          "error",
          "TXT record not found yet. Make sure the DNS record is set and try again.",
        );
      }
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : "Verification failed",
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
      showMsg("error", err instanceof ApiError ? err.message : "Delete failed");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Title2>Domain Verification</Title2>
      <Text style={{ color: tokens.colorNeutralForeground3 }}>
        Verify domains to associate them with your apps. DNS TXT records are
        automatically re-verified periodically.
      </Text>

      {message && (
        <MessageBar intent={message.type === "success" ? "success" : "error"}>
          {message.text}
        </MessageBar>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <Field label="Add domain" style={{ flex: 1 }}>
          <Input
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            placeholder="example.com"
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
          {adding ? <Spinner size="tiny" /> : "Add"}
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
            Add this DNS TXT record to verify {addedInfo.domain}:
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
              <strong>Type:</strong> TXT
            </Text>
            <Text size={200}>
              <strong>Name:</strong> <code>{addedInfo.txt_record}</code>
            </Text>
            <Text size={200}>
              <strong>Value:</strong> <code>{addedInfo.txt_value}</code>
            </Text>
          </div>
          <Button
            size="small"
            onClick={() => setAddedInfo(null)}
            style={{ marginTop: 12 }}
          >
            Dismiss
          </Button>
        </div>
      )}

      {isLoading ? (
        <Spinner />
      ) : (data?.domains.length ?? 0) === 0 ? (
        <Text
          style={{
            color: tokens.colorNeutralForeground3,
            textAlign: "center",
            padding: "40px 0",
          }}
        >
          No domains added yet.
        </Text>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Domain</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Verified at</TableHeaderCell>
              <TableHeaderCell>Next re-verify</TableHeaderCell>
              <TableHeaderCell>Actions</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data!.domains.map((d) => (
              <TableRow key={d.id}>
                <TableCell style={{ fontFamily: "monospace" }}>
                  {d.domain}
                </TableCell>
                <TableCell>
                  <Badge
                    color={d.verified ? "success" : "subtle"}
                    appearance="filled"
                    icon={d.verified ? <CheckmarkCircleRegular /> : undefined}
                  >
                    {d.verified ? "Verified" : "Pending"}
                  </Badge>
                </TableCell>
                <TableCell>
                  {d.verified_at
                    ? new Date(d.verified_at * 1000).toLocaleDateString()
                    : "—"}
                </TableCell>
                <TableCell>
                  {d.next_reverify_at
                    ? new Date(d.next_reverify_at * 1000).toLocaleDateString()
                    : "—"}
                </TableCell>
                <TableCell>
                  <div style={{ display: "flex", gap: 4 }}>
                    <Button
                      icon={<ArrowClockwiseRegular />}
                      size="small"
                      appearance="subtle"
                      disabled={verifying === d.id}
                      onClick={() => handleVerify(d.id)}
                    >
                      {verifying === d.id ? <Spinner size="tiny" /> : "Verify"}
                    </Button>
                    <Dialog>
                      <DialogTrigger disableButtonEnhancement>
                        <Button
                          icon={<DeleteRegular />}
                          size="small"
                          appearance="subtle"
                        />
                      </DialogTrigger>
                      <DialogSurface>
                        <DialogBody>
                          <DialogTitle>Remove domain?</DialogTitle>
                          <DialogContent>
                            Remove <strong>{d.domain}</strong> from your
                            verified domains?
                          </DialogContent>
                          <DialogActions>
                            <DialogTrigger>
                              <Button>Cancel</Button>
                            </DialogTrigger>
                            <Button
                              appearance="primary"
                              style={{
                                background: tokens.colorPaletteRedBackground3,
                              }}
                              onClick={() => handleDelete(d.id)}
                            >
                              Remove
                            </Button>
                          </DialogActions>
                        </DialogBody>
                      </DialogSurface>
                    </Dialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
