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
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  ArrowClockwiseRegular,
  ArrowSwapRegular,
  CheckmarkCircleRegular,
  CopyRegular,
  DeleteRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import type { Domain, DomainAddResponse } from "../lib/api";

const useStyles = makeStyles({
  hiddenOnMobile: {
    "@media (max-width: 768px)": { display: "none" },
  },
  row: {
    cursor: "pointer",
    ":hover": { background: tokens.colorNeutralBackground3 },
  },
});

export function Domains() {
  const styles = useStyles();
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
  const [transferTeamId, setTransferTeamId] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [shareDomain, setShareDomain] = useState<Domain | null>(null);
  const [shareTeamId, setShareTeamId] = useState("");
  const [sharing, setSharing] = useState(false);

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

  const handleTransferToTeam = async () => {
    if (!transferDomain || !transferTeamId) return;
    setTransferring(true);
    try {
      await api.transferDomainToTeam(transferDomain.id, transferTeamId);
      await qc.invalidateQueries({ queryKey: ["domains"] });
      await qc.invalidateQueries({
        queryKey: ["team-domains", transferTeamId],
      });
      setTransferDomain(null);
      setTransferTeamId("");
      showMsg("success", "Domain moved to team");
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : "Transfer failed",
      );
    } finally {
      setTransferring(false);
    }
  };

  const handleShareToTeam = async () => {
    if (!shareDomain || !shareTeamId) return;
    setSharing(true);
    try {
      await api.shareDomainToTeam(shareDomain.id, shareTeamId);
      await qc.invalidateQueries({
        queryKey: ["team-domains", shareTeamId],
      });
      setShareDomain(null);
      setShareTeamId("");
      showMsg("success", "Domain shared with team");
    } catch (err) {
      showMsg("error", err instanceof ApiError ? err.message : "Share failed");
    } finally {
      setSharing(false);
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

      <>
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
                <TableHeaderCell className={styles.hiddenOnMobile}>
                  Verified at
                </TableHeaderCell>
                <TableHeaderCell className={styles.hiddenOnMobile}>
                  Next re-verify
                </TableHeaderCell>
                <TableHeaderCell className={styles.hiddenOnMobile}>
                  Actions
                </TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data!.domains.map((d) => (
                <TableRow
                  key={d.id}
                  className={styles.row}
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
                      {d.verified ? "Verified" : "Pending"}
                    </Badge>
                  </TableCell>
                  <TableCell className={styles.hiddenOnMobile}>
                    {d.verified_at
                      ? new Date(d.verified_at * 1000).toLocaleDateString()
                      : "—"}
                  </TableCell>
                  <TableCell className={styles.hiddenOnMobile}>
                    {d.next_reverify_at
                      ? new Date(d.next_reverify_at * 1000).toLocaleDateString()
                      : "—"}
                  </TableCell>
                  <TableCell className={styles.hiddenOnMobile}>
                    <div
                      style={{ display: "flex", gap: 4 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        icon={<ArrowClockwiseRegular />}
                        size="small"
                        appearance="subtle"
                        disabled={verifying === d.id}
                        onClick={() => handleVerify(d.id)}
                      >
                        {verifying === d.id ? (
                          <Spinner size="tiny" />
                        ) : (
                          "Verify"
                        )}
                      </Button>
                      {manageableTeams.length > 0 && (
                        <>
                          <Button
                            icon={<ArrowSwapRegular />}
                            size="small"
                            appearance="subtle"
                            title="Move to team"
                            onClick={() => {
                              setTransferDomain(d);
                              setTransferTeamId("");
                            }}
                          />
                          <Button
                            icon={<CopyRegular />}
                            size="small"
                            appearance="subtle"
                            title="Share with team"
                            onClick={() => {
                              setShareDomain(d);
                              setShareTeamId("");
                            }}
                          />
                        </>
                      )}
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

        {/* Row detail dialog (primary use on mobile) */}
        <Dialog
          open={!!selectedDomain}
          onOpenChange={(_, s) => {
            if (!s.open) setSelectedDomain(null);
          }}
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle style={{ fontFamily: "monospace" }}>
                {selectedDomain?.domain}
              </DialogTitle>
              <DialogContent>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 12 }}
                >
                  <Badge
                    color={selectedDomain?.verified ? "success" : "subtle"}
                    appearance="filled"
                    icon={
                      selectedDomain?.verified ? (
                        <CheckmarkCircleRegular />
                      ) : undefined
                    }
                    style={{ width: "fit-content" }}
                  >
                    {selectedDomain?.verified ? "Verified" : "Pending"}
                  </Badge>

                  {selectedDomain?.verified_at && (
                    <Text size={200}>
                      <strong>Verified:</strong>{" "}
                      {new Date(
                        selectedDomain.verified_at * 1000,
                      ).toLocaleDateString()}
                    </Text>
                  )}
                  {selectedDomain?.next_reverify_at && (
                    <Text size={200}>
                      <strong>Next re-verify:</strong>{" "}
                      {new Date(
                        selectedDomain.next_reverify_at * 1000,
                      ).toLocaleDateString()}
                    </Text>
                  )}

                  {!selectedDomain?.verified && (
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
                        <code>_prism-verify.{selectedDomain?.domain}</code>
                      </Text>
                      <Text size={200}>
                        <strong>Value:</strong>{" "}
                        <code>
                          prism-verify={selectedDomain?.verification_token}
                        </code>
                      </Text>
                    </div>
                  )}
                </div>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setSelectedDomain(null)}>Close</Button>
                <Button
                  appearance="outline"
                  icon={<ArrowClockwiseRegular />}
                  disabled={verifying === selectedDomain?.id}
                  onClick={async () => {
                    if (!selectedDomain) return;
                    await handleVerify(selectedDomain.id);
                    setSelectedDomain(null);
                  }}
                >
                  {verifying === selectedDomain?.id ? (
                    <Spinner size="tiny" />
                  ) : (
                    "Verify"
                  )}
                </Button>
                <Button
                  appearance="primary"
                  style={{ background: tokens.colorPaletteRedBackground3 }}
                  onClick={() => {
                    if (!selectedDomain) return;
                    handleDelete(selectedDomain.id);
                    setSelectedDomain(null);
                  }}
                >
                  Delete
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>

        {/* Transfer to team dialog */}
        <Dialog
          open={!!transferDomain}
          onOpenChange={(_, s) => {
            if (!s.open) setTransferDomain(null);
          }}
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Move domain to team</DialogTitle>
              <DialogContent>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 12 }}
                >
                  <Text>
                    Move{" "}
                    <strong style={{ fontFamily: "monospace" }}>
                      {transferDomain?.domain}
                    </strong>{" "}
                    to a team. The domain will be removed from your personal
                    domains and managed by the team.
                  </Text>
                  <Field label="Select team" required>
                    <Select
                      value={transferTeamId}
                      onChange={(_, d) => setTransferTeamId(d.value)}
                    >
                      <option value="">— choose a team —</option>
                      {manageableTeams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setTransferDomain(null)}>Cancel</Button>
                <Button
                  appearance="primary"
                  onClick={handleTransferToTeam}
                  disabled={transferring || !transferTeamId}
                >
                  {transferring ? <Spinner size="tiny" /> : "Move to team"}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>

        {/* Share to team dialog */}
        <Dialog
          open={!!shareDomain}
          onOpenChange={(_, s) => {
            if (!s.open) setShareDomain(null);
          }}
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Share domain with team</DialogTitle>
              <DialogContent>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 12 }}
                >
                  <Text>
                    Share{" "}
                    <strong style={{ fontFamily: "monospace" }}>
                      {shareDomain?.domain}
                    </strong>{" "}
                    with a team. The domain will also appear in the team's
                    verified domains — your personal copy is kept.
                  </Text>
                  <Field label="Select team" required>
                    <Select
                      value={shareTeamId}
                      onChange={(_, d) => setShareTeamId(d.value)}
                    >
                      <option value="">— choose a team —</option>
                      {manageableTeams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setShareDomain(null)}>Cancel</Button>
                <Button
                  appearance="primary"
                  onClick={handleShareToTeam}
                  disabled={sharing || !shareTeamId}
                >
                  {sharing ? <Spinner size="tiny" /> : "Share with team"}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      </>
    </div>
  );
}
