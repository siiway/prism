// Team detail page — members, apps, settings tabs

import {
  Avatar,
  Badge,
  Button,
  Field,
  Input,
  MessageBar,
  Spinner,
  Tab,
  TabList,
  Text,
  Title2,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AppsRegular,
  DeleteRegular,
  GlobeSearchRegular,
  PeopleRegular,
  SettingsRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Domain, type OAuthApp } from "../../lib/api";
import { useAuthStore } from "../../store/auth";
import { InviteDialog } from "./dialogs/InviteDialog";
import { AddMemberDialog } from "./dialogs/AddMemberDialog";
import { MigrateAppDialog } from "./dialogs/MigrateAppDialog";
import { NewTeamAppDialog } from "./dialogs/NewTeamAppDialog";
import { MembersTable } from "./MembersTable";
import { AppsGrid } from "./AppsGrid";
import { DomainsTable } from "./DomainsTable";

const useStyles = makeStyles({
  header: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    marginBottom: "24px",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  danger: {
    border: `1px solid ${tokens.colorPaletteRedBorder2}`,
    borderRadius: "8px",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
});

const ROLE_COLORS: Record<string, "brand" | "success" | "subtle"> = {
  owner: "brand",
  admin: "success",
  member: "subtle",
};

type Tab = "members" | "apps" | "domains" | "settings";

export function TeamDetail() {
  const styles = useStyles();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user: me } = useAuthStore();

  const [tab, setTab] = useState<Tab>("members");
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["team", id],
    queryFn: () => api.getTeam(id!),
    enabled: !!id,
  });

  const { data: appsData, isLoading: appsLoading } = useQuery({
    queryKey: ["team-apps", id],
    queryFn: () => api.listTeamApps(id!),
    enabled: !!id && tab === "apps",
  });

  const { data: invitesData, isLoading: invitesLoading } = useQuery({
    queryKey: ["team-invites", id],
    queryFn: () => api.listTeamInvites(id!),
    enabled:
      !!id &&
      tab === "members" &&
      (data?.team?.my_role === "owner" || data?.team?.my_role === "admin"),
  });

  const { data: myAppsData } = useQuery({
    queryKey: ["apps"],
    queryFn: api.listApps,
    enabled: tab === "apps",
  });

  const { data: domainsData, isLoading: domainsLoading } = useQuery({
    queryKey: ["team-domains", id],
    queryFn: () => api.listTeamDomains(id!),
    enabled: !!id && tab === "domains",
  });

  const { data: personalDomainsData } = useQuery({
    queryKey: ["domains"],
    queryFn: api.listDomains,
    enabled:
      tab === "domains" &&
      (data?.team?.my_role === "owner" || data?.team?.my_role === "admin"),
  });

  const team = data?.team;
  const members = data?.members ?? [];
  const myRole = team?.my_role ?? "member";
  const canManage = myRole === "owner" || myRole === "admin";
  const isOwner = myRole === "owner";

  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const handleChangeRole = async (userId: string, role: string) => {
    if (!id) return;
    try {
      await api.changeTeamMemberRole(id, userId, role);
      await qc.invalidateQueries({ queryKey: ["team", id] });
      showMsg("success", "Role updated");
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : "Failed to update role",
      );
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!id) return;
    try {
      await api.removeTeamMember(id, userId);
      await qc.invalidateQueries({ queryKey: ["team", id] });
      showMsg("success", "Member removed");
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : "Failed to remove member",
      );
    }
  };

  const handleTransferOwnership = async (userId: string) => {
    if (!id) return;
    try {
      await api.transferOwnership(id, userId);
      await qc.invalidateQueries({ queryKey: ["team", id] });
      showMsg("success", "Ownership transferred");
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : "Failed to transfer ownership",
      );
    }
  };

  // ── Invites ─────────────────────────────────────────────────────────────────
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const handleRevokeInvite = async (token: string) => {
    if (!id) return;
    try {
      await api.revokeTeamInvite(id, token);
      await qc.invalidateQueries({ queryKey: ["team-invites", id] });
      showMsg("success", "Invite revoked");
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : "Failed to revoke invite",
      );
    }
  };

  const handleCopyInviteLink = async (token: string) => {
    const link = `${window.location.origin}/teams/join/${token}`;
    await navigator.clipboard.writeText(link);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  // Personal domains not already in a team
  const transferableDomains = (personalDomainsData?.domains ?? []).filter(
    (d: Domain) => !("team_id" in d && d.team_id),
  );

  const personalApps = (myAppsData?.apps ?? []).filter(
    (a: OAuthApp) => !a.team_id,
  );

  // ── Settings ────────────────────────────────────────────────────────────────
  const [settingsForm, setSettingsForm] = useState({
    name: "",
    description: "",
    avatar_url: "",
  });
  const [saving, setSaving] = useState(false);

  const updateSettings =
    (k: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setSettingsForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSaveSettings = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await api.updateTeam(id, {
        name: settingsForm.name || undefined,
        description: settingsForm.description || undefined,
        avatar_url: settingsForm.avatar_url || undefined,
      });
      await qc.invalidateQueries({ queryKey: ["team", id] });
      showMsg("success", "Team updated");
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : "Failed to update team",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTeam = async () => {
    if (!id) return;
    try {
      await api.deleteTeam(id);
      await qc.invalidateQueries({ queryKey: ["teams"] });
      navigate("/teams");
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : "Failed to delete team",
      );
    }
  };

  if (isLoading) return <Spinner />;
  if (!team) return <Text>Team not found</Text>;

  return (
    <div>
      {message && (
        <MessageBar
          intent={message.type === "success" ? "success" : "error"}
          style={{ marginBottom: 16 }}
        >
          {message.text}
        </MessageBar>
      )}

      {/* Header */}
      <div className={styles.header}>
        {team.avatar_url ? (
          <Avatar image={{ src: team.avatar_url }} name={team.name} size={48} />
        ) : (
          <Avatar name={team.name} size={48} />
        )}
        <div>
          <Title2>{team.name}</Title2>
          {team.description && (
            <Text style={{ color: tokens.colorNeutralForeground3 }}>
              {team.description}
            </Text>
          )}
        </div>
        <Badge color={ROLE_COLORS[myRole] ?? "subtle"} appearance="filled">
          {myRole}
        </Badge>
      </div>

      <TabList
        selectedValue={tab}
        onTabSelect={(_, d) => {
          setTab(d.value as Tab);
          if (d.value === "settings") {
            setSettingsForm({
              name: team.name,
              description: team.description,
              avatar_url: team.avatar_url ?? "",
            });
          }
        }}
        style={{ marginBottom: 24 }}
      >
        <Tab value="members" icon={<PeopleRegular />}>
          Members ({members.length})
        </Tab>
        <Tab value="apps" icon={<AppsRegular />}>
          Apps
        </Tab>
        <Tab value="domains" icon={<GlobeSearchRegular />}>
          Domains
        </Tab>
        {canManage && (
          <Tab value="settings" icon={<SettingsRegular />}>
            Settings
          </Tab>
        )}
      </TabList>

      {/* Members tab */}
      {tab === "members" && (
        <div>
          {canManage && (
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginBottom: 12,
              }}
            >
              <InviteDialog teamId={id!} showMsg={showMsg} />
              <AddMemberDialog teamId={id!} showMsg={showMsg} />
            </div>
          )}

          <MembersTable
            members={members}
            invites={invitesData?.invites ?? []}
            invitesLoading={invitesLoading}
            canManage={canManage}
            isOwner={isOwner}
            meId={me?.id}
            copiedToken={copiedToken}
            onChangeRole={handleChangeRole}
            onRemoveMember={handleRemoveMember}
            onTransferOwnership={handleTransferOwnership}
            onRevokeInvite={handleRevokeInvite}
            onCopyInviteLink={handleCopyInviteLink}
          />
        </div>
      )}

      {/* Apps tab */}
      {tab === "apps" && (
        <div>
          {canManage && (
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginBottom: 12,
              }}
            >
              <MigrateAppDialog
                teamId={id!}
                personalApps={personalApps}
                showMsg={showMsg}
              />
              <NewTeamAppDialog teamId={id!} showMsg={showMsg} />
            </div>
          )}

          <AppsGrid apps={appsData?.apps ?? []} loading={appsLoading} />
        </div>
      )}

      {/* Domains tab */}
      {tab === "domains" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Text style={{ color: tokens.colorNeutralForeground3 }}>
            Verified team domains are used to mark team apps as verified. Add a
            DNS TXT record to prove ownership.
          </Text>

          <DomainsTable
            teamId={id!}
            domains={domainsData?.domains ?? []}
            loading={domainsLoading}
            canManage={canManage}
            verifyingDomain={null}
            transferableDomains={transferableDomains}
            showMsg={showMsg}
          />
        </div>
      )}

      {/* Settings tab */}
      {tab === "settings" && canManage && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
            maxWidth: 480,
          }}
        >
          <div className={styles.form}>
            <Field label="Team name">
              <Input
                value={settingsForm.name}
                onChange={updateSettings("name")}
              />
            </Field>
            <Field label="Description">
              <Textarea
                value={settingsForm.description}
                onChange={updateSettings("description")}
                rows={3}
              />
            </Field>
            <Field label="Avatar URL">
              <Input
                value={settingsForm.avatar_url}
                onChange={updateSettings("avatar_url")}
                placeholder="https://example.com/logo.png"
              />
            </Field>
            <div>
              <Button
                appearance="primary"
                onClick={handleSaveSettings}
                disabled={saving}
              >
                {saving ? <Spinner size="tiny" /> : "Save changes"}
              </Button>
            </div>
          </div>

          {isOwner && (
            <div className={styles.danger}>
              <Text
                weight="semibold"
                style={{ color: tokens.colorPaletteRedForeground1 }}
              >
                Danger zone
              </Text>
              <Text
                size={200}
                style={{ color: tokens.colorNeutralForeground3 }}
              >
                Deleting this team will disown all team apps (they will return
                to their creators). This action cannot be undone.
              </Text>
              <div>
                <Button
                  appearance="outline"
                  icon={<DeleteRegular />}
                  style={{
                    color: tokens.colorPaletteRedForeground1,
                    borderColor: tokens.colorPaletteRedBorder2,
                  }}
                  onClick={handleDeleteTeam}
                >
                  Delete team
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
