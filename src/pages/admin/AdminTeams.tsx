// Admin team management

import {
  Avatar,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Dropdown,
  Field,
  Input,
  MessageBar,
  Option,
  Tooltip,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  DeleteRegular,
  DismissCircleRegular,
  EditRegular,
  MailRegular,
  PeopleTeamRegular,
  PersonAddRegular,
  SearchRegular,
  SettingsRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import { useToastMessage } from "../../lib/useToastMessage";
import { CopyIdButton } from "../../components/CopyIdButton";
import { Pagination } from "../../components/Pagination";
import { SkeletonTableRows } from "../../components/Skeletons";

const useStyles = makeStyles({
  // Let the table scroll sideways on narrow screens instead of
  // overflowing the page
  tableScroll: { overflowX: "auto" },
  detailGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
    "@media (max-width: 500px)": { gridTemplateColumns: "1fr" },
  },
});

export function AdminTeams() {
  const api = useApi();
  const styles = useStyles();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const { message, showMsg } = useToastMessage();
  const [viewing, setViewing] = useState<Record<string, unknown> | null>(null);

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["admin-teams", page, search],
    queryFn: () => api.adminListTeams(page, search),
  });

  // Granting is the second of the two doors guarding account minting: the
  // site master switch opens the feature, this authorises one team to use it.
  const [busyTeam, setBusyTeam] = useState<string | null>(null);
  const [dissolving, setDissolving] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [dissolveConfirm, setDissolveConfirm] = useState("");

  // Email verification is the one site-level check a team's invite path may
  // skip — it is the only one whose cost scales with the number of
  // registrations. Captcha, proof-of-work and every rate limit stay on.
  const handleToggleExemption = async (id: string, skipEmail: boolean) => {
    setBusyTeam(id);
    try {
      await api.adminSetInviteRegistration(id, {
        exemptions: { email_verification: skipEmail },
      });
      await qc.invalidateQueries({ queryKey: ["admin-teams"] });
    } catch (err) {
      showMsg?.(
        "error",
        err instanceof ApiError ? err.message : "Failed to update",
      );
    } finally {
      setBusyTeam(null);
    }
  };

  const handleToggleGrant = async (id: string, granted: boolean) => {
    setBusyTeam(id);
    try {
      await api.adminSetInviteRegistration(id, { granted });
      await qc.invalidateQueries({ queryKey: ["admin-teams"] });
    } catch (err) {
      showMsg?.(
        "error",
        err instanceof ApiError ? err.message : "Failed to update",
      );
    } finally {
      setBusyTeam(null);
    }
  };

  const handleStartDissolve = async () => {
    if (!dissolving) return;
    setBusyTeam(dissolving.id);
    try {
      const res = await api.adminStartDissolve(
        dissolving.id,
        dissolveConfirm.trim(),
      );
      await qc.invalidateQueries({ queryKey: ["admin-teams"] });
      setDissolving(null);
      setDissolveConfirm("");
      showMsg?.(
        "success",
        `Dissolution started — ${res.deactivated_accounts} account(s) deactivated`,
      );
    } catch (err) {
      showMsg?.(
        "error",
        err instanceof ApiError ? err.message : "Failed to start dissolution",
      );
    } finally {
      setBusyTeam(null);
    }
  };

  // Adding a member and creating a team both go through the ordinary team
  // API — the site-admin override means an admin is treated as owner of every
  // team, so there is no separate admin-only path to keep in step with it.
  const [addingTo, setAddingTo] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [addUsername, setAddUsername] = useState("");
  const [addRole, setAddRole] = useState("member");
  const [creating, setCreating] = useState(false);
  const [newTeam, setNewTeam] = useState({
    name: "",
    description: "",
    owner: "",
  });

  const handleAddMember = async () => {
    if (!addingTo || !addUsername.trim()) return;
    setBusyTeam(addingTo.id);
    try {
      await api.addTeamMember(addingTo.id, {
        username: addUsername.trim(),
        role: addRole,
      });
      await qc.invalidateQueries({ queryKey: ["admin-teams"] });
      setAddingTo(null);
      setAddUsername("");
      setAddRole("member");
      showMsg("success", t("admin.teamMemberAdded"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.error"),
      );
    } finally {
      setBusyTeam(null);
    }
  };

  const handleCreateTeam = async () => {
    if (!newTeam.name.trim()) return;
    try {
      await api.createTeam({
        name: newTeam.name.trim(),
        description: newTeam.description.trim() || undefined,
        owner_username: newTeam.owner.trim() || undefined,
      });
      await qc.invalidateQueries({ queryKey: ["admin-teams"] });
      setCreating(false);
      setNewTeam({ name: "", description: "", owner: "" });
      showMsg("success", t("admin.teamCreated"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.error"),
      );
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.adminDeleteTeam(id);
      await qc.invalidateQueries({ queryKey: ["admin-teams"] });
      showMsg("success", t("admin.teamDeleted"));
      setViewing(null);
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("admin.deleteFailed"),
      );
    }
  };

  const totalPages = data ? Math.ceil(data.total / 20) : 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>
      {message && (
        <MessageBar intent={message.type === "success" ? "success" : "error"}>
          {message.text}
        </MessageBar>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t("admin.searchTeams")}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          style={{ flex: 1 }}
        />
        <Button icon={<SearchRegular />} onClick={handleSearch}>
          {t("common.search")}
        </Button>
        <Button
          appearance="primary"
          icon={<AddRegular />}
          onClick={() => setCreating(true)}
        >
          {t("admin.teamCreate")}
        </Button>
      </div>

      {isLoading ? (
        <SkeletonTableRows rows={8} cols={4} />
      ) : (
        <div className={styles.tableScroll}>
          <Table style={{ tableLayout: "auto" }}>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>{t("admin.teamHeader")}</TableHeaderCell>
                <TableHeaderCell>{t("admin.ownerHeader")}</TableHeaderCell>
                <TableHeaderCell>{t("admin.membersHeader")}</TableHeaderCell>
                <TableHeaderCell style={{ width: 1 }} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.teams.map((team) => (
                <TableRow key={team.id}>
                  <TableCell>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      {team.avatar_url ? (
                        <Avatar
                          image={{ src: team.avatar_url }}
                          name={team.name}
                          size={24}
                        />
                      ) : (
                        <Avatar name={team.name} size={24} />
                      )}
                      <div>
                        <Text weight="semibold" block>
                          {team.name}
                        </Text>
                        {team.description && (
                          <Text
                            size={200}
                            style={{ color: tokens.colorNeutralForeground3 }}
                          >
                            {team.description.slice(0, 40)}
                          </Text>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Text size={200}>
                      {team.owner_username ? `@${team.owner_username}` : "—"}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <Text size={200}>{team.member_count}</Text>
                  </TableCell>
                  <TableCell>
                    <div
                      style={{
                        display: "flex",
                        gap: 4,
                        justifyContent: "flex-end",
                      }}
                    >
                      <CopyIdButton id={team.id} />
                      {/* Site admins hold owner-level authority on every
                          team, so the ordinary team page is the management
                          screen — no second, half-featured admin copy of it. */}
                      <Tooltip
                        relationship="label"
                        content={t("admin.manageTeamTooltip")}
                      >
                        <Button
                          size="small"
                          appearance="subtle"
                          icon={<SettingsRegular />}
                          onClick={() => navigate(`/teams/${team.id}`)}
                        />
                      </Tooltip>
                      <Tooltip
                        relationship="label"
                        content={t("admin.teamAddMember")}
                      >
                        <Button
                          size="small"
                          appearance="subtle"
                          icon={<PeopleTeamRegular />}
                          onClick={() =>
                            setAddingTo({ id: team.id, name: team.name })
                          }
                        />
                      </Tooltip>
                      {/* Teams that minted accounts cannot be deleted in one
                          shot — the staged flow deactivates first and the
                          reaper clears the accounts over several ticks. */}
                      <Tooltip
                        relationship="label"
                        content={
                          team.invite_registration_granted
                            ? t("admin.revokeInviteRegistration")
                            : t("admin.grantInviteRegistration")
                        }
                      >
                        <Button
                          size="small"
                          appearance="subtle"
                          disabled={busyTeam === team.id}
                          icon={<PersonAddRegular />}
                          style={
                            team.invite_registration_granted
                              ? { color: tokens.colorPaletteGreenForeground1 }
                              : undefined
                          }
                          onClick={() =>
                            handleToggleGrant(
                              team.id,
                              !team.invite_registration_granted,
                            )
                          }
                        />
                      </Tooltip>
                      {team.invite_registration_granted && (
                        <Tooltip
                          relationship="label"
                          content={
                            team.invite_registration_exemptions
                              ?.email_verification
                              ? t("admin.requireEmailForInvites")
                              : t("admin.skipEmailForInvites")
                          }
                        >
                          <Button
                            size="small"
                            appearance="subtle"
                            disabled={busyTeam === team.id}
                            icon={<MailRegular />}
                            style={
                              team.invite_registration_exemptions
                                ?.email_verification
                                ? {
                                    color: tokens.colorPaletteYellowForeground1,
                                  }
                                : undefined
                            }
                            onClick={() =>
                              handleToggleExemption(
                                team.id,
                                !team.invite_registration_exemptions
                                  ?.email_verification,
                              )
                            }
                          />
                        </Tooltip>
                      )}
                      {team.invite_registration_granted && (
                        <Tooltip
                          relationship="label"
                          content={t("admin.stagedDissolve")}
                        >
                          <Button
                            size="small"
                            appearance="subtle"
                            icon={<DismissCircleRegular />}
                            onClick={() =>
                              setDissolving({ id: team.id, name: team.name })
                            }
                          />
                        </Tooltip>
                      )}
                      <Button
                        size="small"
                        appearance="subtle"
                        icon={<EditRegular />}
                        onClick={() =>
                          setViewing(team as unknown as Record<string, unknown>)
                        }
                      />
                      <Dialog>
                        <DialogTrigger disableButtonEnhancement>
                          <Button
                            size="small"
                            appearance="subtle"
                            icon={<DeleteRegular />}
                          />
                        </DialogTrigger>
                        <DialogSurface>
                          <DialogBody>
                            <DialogTitle>
                              {t("admin.deleteTeamConfirm", {
                                name: team.name,
                              })}
                            </DialogTitle>
                            <DialogActions>
                              <DialogTrigger>
                                <Button>{t("common.cancel")}</Button>
                              </DialogTrigger>
                              <Button
                                appearance="primary"
                                style={{
                                  background: tokens.colorPaletteRedBackground3,
                                }}
                                onClick={() => handleDelete(team.id)}
                              >
                                {t("common.delete")}
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
        </div>
      )}

      {totalPages > 1 && (
        <Pagination
          page={page}
          pageCount={totalPages}
          onChange={setPage}
          disabled={isLoading || isFetching}
        />
      )}

      {/* Team detail dialog */}
      <Dialog
        open={viewing !== null}
        onOpenChange={(_, d) => !d.open && setViewing(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              {t("admin.editTeam")} — {viewing?.name as string}
            </DialogTitle>
            <DialogContent>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  paddingTop: 8,
                }}
              >
                <div className={styles.detailGrid}>
                  <Field label={t("admin.ownerHeader")}>
                    <Input
                      value={
                        viewing?.owner_username
                          ? `@${viewing.owner_username}`
                          : "—"
                      }
                      readOnly
                    />
                  </Field>
                  <Field label={t("admin.membersHeader")}>
                    <Input
                      value={String(viewing?.member_count ?? 0)}
                      readOnly
                    />
                  </Field>
                </div>

                <div className={styles.detailGrid}>
                  <Field label={t("admin.appsHeader")}>
                    <Input value={String(viewing?.app_count ?? 0)} readOnly />
                  </Field>
                  <Field label={t("admin.createdHeader")}>
                    <Input
                      value={
                        viewing?.created_at
                          ? new Date(
                              (viewing.created_at as number) * 1000,
                            ).toLocaleDateString()
                          : "—"
                      }
                      readOnly
                    />
                  </Field>
                </div>

                {typeof viewing?.description === "string" &&
                  viewing.description && (
                    <Field label={t("admin.teamDescHeader")}>
                      <Input value={viewing.description} readOnly />
                    </Field>
                  )}
              </div>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setViewing(null)}>
                {t("common.close")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog
        open={!!dissolving}
        onOpenChange={(_, d) => {
          if (!d.open) {
            setDissolving(null);
            setDissolveConfirm("");
          }
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("admin.stagedDissolveTitle")}</DialogTitle>
            <DialogContent>
              <Text block>
                {t("admin.stagedDissolveBody", {
                  name: dissolving?.name ?? "",
                })}
              </Text>
              <Field
                label={t("admin.stagedDissolveConfirmLabel", {
                  name: dissolving?.name ?? "",
                })}
                style={{ marginTop: 12 }}
              >
                <Input
                  value={dissolveConfirm}
                  onChange={(e) => setDissolveConfirm(e.target.value)}
                />
              </Field>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDissolving(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                appearance="primary"
                style={{ background: tokens.colorPaletteRedBackground3 }}
                disabled={
                  dissolveConfirm.trim() !== dissolving?.name ||
                  busyTeam === dissolving?.id
                }
                onClick={handleStartDissolve}
              >
                {t("admin.stagedDissolveStart")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Add anyone to any team. The team's own join requirements (2FA,
          verified email) and the restricted-account scope rule are overridden
          here on purpose — the server records what it waived in the team's
          audit log. */}
      <Dialog
        open={addingTo !== null}
        onOpenChange={(_, d) => !d.open && setAddingTo(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              {t("admin.teamAddMemberTitle", { team: addingTo?.name ?? "" })}
            </DialogTitle>
            <DialogContent>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  paddingTop: 8,
                }}
              >
                <MessageBar intent="info">
                  {t("admin.teamAddMemberHint")}
                </MessageBar>
                <Field label={t("admin.teamMemberUsername")}>
                  <Input
                    value={addUsername}
                    onChange={(_, d) => setAddUsername(d.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddMember()}
                  />
                </Field>
                <Field label={t("admin.teamMemberRole")}>
                  <Dropdown
                    value={addRole}
                    selectedOptions={[addRole]}
                    onOptionSelect={(_, d) =>
                      setAddRole(d.optionValue ?? "member")
                    }
                  >
                    <Option value="member">member</Option>
                    <Option value="admin">admin</Option>
                    <Option value="co-owner">co-owner</Option>
                  </Dropdown>
                </Field>
              </div>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setAddingTo(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                appearance="primary"
                disabled={!addUsername.trim() || busyTeam === addingTo?.id}
                onClick={handleAddMember}
              >
                {t("common.add")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog
        open={creating}
        onOpenChange={(_, d) => !d.open && setCreating(false)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("admin.teamCreateTitle")}</DialogTitle>
            <DialogContent>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  paddingTop: 8,
                }}
              >
                <Field label={t("admin.teamNameLabel")}>
                  <Input
                    value={newTeam.name}
                    onChange={(_, d) =>
                      setNewTeam((prev) => ({ ...prev, name: d.value }))
                    }
                  />
                </Field>
                <Field label={t("admin.teamDescriptionLabel")}>
                  <Input
                    value={newTeam.description}
                    onChange={(_, d) =>
                      setNewTeam((prev) => ({ ...prev, description: d.value }))
                    }
                  />
                </Field>
                <Field
                  label={t("admin.teamOwnerLabel")}
                  hint={t("admin.teamOwnerHint")}
                >
                  <Input
                    value={newTeam.owner}
                    onChange={(_, d) =>
                      setNewTeam((prev) => ({ ...prev, owner: d.value }))
                    }
                  />
                </Field>
              </div>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setCreating(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                appearance="primary"
                disabled={!newTeam.name.trim()}
                onClick={handleCreateTeam}
              >
                {t("common.create")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
