// Team detail page — members, apps, settings tabs

import {
  Avatar,
  Badge,
  Button,
  Field,
  Input,
  Link,
  MessageBar,
  Spinner,
  Switch,
  Tab,
  TabList,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Title2,
  Textarea,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { CopyRegular } from "@fluentui/react-icons";
import {
  AppsRegular,
  DeleteRegular,
  GlobeRegular,
  GlobeSearchRegular,
  LinkRegular,
  MailRegular,
  PeopleRegular,
  SettingsRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  api,
  ApiError,
  type Domain,
  type OAuthApp,
  type TeamInvite,
} from "../../lib/api";
import { ImageUrlInput } from "../../components/ImageUrlInput";
import { useAuthStore } from "../../store/auth";
import { InviteDialog } from "./dialogs/InviteDialog";
import { AddMemberDialog } from "./dialogs/AddMemberDialog";
import { MigrateAppDialog } from "./dialogs/MigrateAppDialog";
import { NewTeamAppDialog } from "./dialogs/NewTeamAppDialog";
import { MembersTable } from "./MembersTable";
import { AppsGrid } from "./AppsGrid";
import { DomainsTable } from "./DomainsTable";
import {
  SkeletonFormCard,
  SkeletonTableRows,
} from "../../components/Skeletons";

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

const ROLE_COLORS: Record<
  string,
  "brand" | "success" | "subtle" | "informative"
> = {
  owner: "brand",
  "co-owner": "informative",
  admin: "success",
  member: "subtle",
};

type TabType = "members" | "apps" | "domains" | "invites" | "settings";

export function TeamDetail() {
  const styles = useStyles();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user: me } = useAuthStore();
  const { t } = useTranslation();

  const [tab, setTab] = useState<TabType>("members");
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
      tab === "invites" &&
      (data?.team?.my_role === "owner" ||
        data?.team?.my_role === "co-owner" ||
        data?.team?.my_role === "admin"),
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
      (data?.team?.my_role === "owner" ||
        data?.team?.my_role === "co-owner" ||
        data?.team?.my_role === "admin"),
  });

  const team = data?.team;
  const members = data?.members ?? [];
  const myRole = team?.my_role ?? "member";
  const canManage =
    myRole === "owner" || myRole === "co-owner" || myRole === "admin";
  const isOwner = myRole === "owner";
  const isCoOwnerOrAbove = myRole === "owner" || myRole === "co-owner";

  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const handleChangeRole = async (userId: string, role: string) => {
    if (!id) return;
    try {
      await api.changeTeamMemberRole(id, userId, role);
      await qc.invalidateQueries({ queryKey: ["team", id] });
      showMsg("success", t("teams.roleUpdated"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("teams.failedUpdateRole"),
      );
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!id) return;
    try {
      await api.removeTeamMember(id, userId);
      await qc.invalidateQueries({ queryKey: ["team", id] });
      showMsg("success", t("teams.memberRemoved"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("teams.failedRemoveMember"),
      );
    }
  };

  const handleTransferOwnership = async (userId: string) => {
    if (!id) return;
    try {
      await api.transferOwnership(id, userId);
      await qc.invalidateQueries({ queryKey: ["team", id] });
      showMsg("success", t("teams.ownershipTransferred"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError
          ? err.message
          : t("teams.failedTransferOwnership"),
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
      showMsg("success", t("teams.inviteRevoked"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("teams.failedRevokeInvite"),
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
      showMsg("success", t("teams.teamUpdated"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("teams.failedUpdateTeam"),
      );
    } finally {
      setSaving(false);
    }
  };

  const [savingVisibility, setSavingVisibility] = useState<string | null>(null);

  const { data: site } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });

  const handleVisibilityChange = async (
    field:
      | "profile_is_public"
      | "profile_show_description"
      | "profile_show_avatar"
      | "profile_show_owner"
      | "profile_show_member_count"
      | "profile_show_apps"
      | "profile_show_domains"
      | "profile_show_members",
    value: boolean,
  ) => {
    if (!id) return;
    setSavingVisibility(field);
    try {
      await api.updateTeam(id, { [field]: value });
      await qc.invalidateQueries({ queryKey: ["team", id] });
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("teams.failedUpdateTeam"),
      );
    } finally {
      setSavingVisibility(null);
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
        err instanceof ApiError ? err.message : t("teams.failedDeleteTeam"),
      );
    }
  };

  if (isLoading) return <SkeletonFormCard rows={5} />;
  if (!team) return <Text>{t("teams.teamNotFound")}</Text>;

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
          setTab(d.value as TabType);
          if (d.value === "settings") {
            setSettingsForm({
              name: team.name,
              description: team.description,
              avatar_url: team.unproxied_avatar_url ?? "",
            });
          }
        }}
        style={{ marginBottom: 24 }}
      >
        <Tab value="members" icon={<PeopleRegular />}>
          {t("teams.membersTab", { count: members.length })}
        </Tab>
        <Tab value="apps" icon={<AppsRegular />}>
          {t("teams.appsTab")}
        </Tab>
        <Tab value="domains" icon={<GlobeSearchRegular />}>
          {t("teams.domainsTab")}
        </Tab>
        {canManage && (
          <Tab value="invites" icon={<LinkRegular />}>
            {t("teams.invitesTab")}
          </Tab>
        )}
        {canManage && (
          <Tab value="settings" icon={<SettingsRegular />}>
            {t("teams.settingsTab")}
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
              <AddMemberDialog teamId={id!} showMsg={showMsg} />
            </div>
          )}

          <MembersTable
            members={members}
            canManage={canManage}
            isOwner={isOwner}
            isCoOwnerOrAbove={isCoOwnerOrAbove}
            myRole={myRole}
            meId={me?.id}
            onChangeRole={handleChangeRole}
            onRemoveMember={handleRemoveMember}
            onTransferOwnership={handleTransferOwnership}
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
            {t("teams.domainsDesc")}
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

      {/* Invites tab */}
      {tab === "invites" && canManage && (
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginBottom: 12,
            }}
          >
            <InviteDialog teamId={id!} showMsg={showMsg} />
          </div>

          {invitesLoading && <SkeletonTableRows rows={3} cols={4} />}

          {!invitesLoading && (invitesData?.invites ?? []).length === 0 && (
            <Text style={{ color: tokens.colorNeutralForeground3 }}>
              {t("teams.noActiveInvites")}
            </Text>
          )}

          {!invitesLoading && (invitesData?.invites ?? []).length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>
                    {t("teams.inviteTypeHeader")}
                  </TableHeaderCell>
                  <TableHeaderCell>{t("teams.roleHeader")}</TableHeaderCell>
                  <TableHeaderCell>
                    {t("teams.inviteUsesHeader")}
                  </TableHeaderCell>
                  <TableHeaderCell>
                    {t("teams.inviteExpiresHeader")}
                  </TableHeaderCell>
                  <TableHeaderCell>
                    {t("teams.inviteCreatedByHeader")}
                  </TableHeaderCell>
                  <TableHeaderCell />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(invitesData?.invites ?? []).map((inv: TeamInvite) => {
                  const inviteUrl = `${window.location.origin}/teams/join/${inv.token}`;
                  return (
                    <TableRow key={inv.token}>
                      <TableCell>
                        {inv.email ? (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <MailRegular
                              style={{ color: tokens.colorNeutralForeground3 }}
                            />
                            <Text size={300}>{inv.email}</Text>
                          </div>
                        ) : (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <LinkRegular
                              style={{ color: tokens.colorNeutralForeground3 }}
                            />
                            <Text
                              size={200}
                              style={{
                                color: tokens.colorNeutralForeground3,
                                fontFamily: "monospace",
                                wordBreak: "break-all",
                              }}
                            >
                              {inviteUrl}
                            </Text>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          color={ROLE_COLORS[inv.role] ?? "subtle"}
                          appearance="filled"
                          size="small"
                        >
                          {inv.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Text size={300}>
                          {inv.uses} / {inv.max_uses === 0 ? "∞" : inv.max_uses}
                        </Text>
                      </TableCell>
                      <TableCell>
                        <Text size={300}>
                          {new Date(inv.expires_at * 1000).toLocaleDateString()}
                        </Text>
                      </TableCell>
                      <TableCell>
                        <Text size={300}>@{inv.created_by_username}</Text>
                      </TableCell>
                      <TableCell>
                        <div style={{ display: "flex", gap: 4 }}>
                          {!inv.email && (
                            <Tooltip
                              content={
                                copiedToken === inv.token
                                  ? t("teams.copiedExclamation")
                                  : t("teams.copyLink")
                              }
                              relationship="label"
                            >
                              <Button
                                appearance="subtle"
                                icon={<CopyRegular />}
                                size="small"
                                onClick={() => handleCopyInviteLink(inv.token)}
                              />
                            </Tooltip>
                          )}
                          <Tooltip
                            content={t("teams.revokeInvite")}
                            relationship="label"
                          >
                            <Button
                              appearance="subtle"
                              icon={<DeleteRegular />}
                              size="small"
                              style={{
                                color: tokens.colorPaletteRedForeground1,
                              }}
                              onClick={() => handleRevokeInvite(inv.token)}
                            />
                          </Tooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
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
            <Field label={t("teams.teamNameField")}>
              <Input
                value={settingsForm.name}
                onChange={updateSettings("name")}
              />
            </Field>
            <Field label={t("teams.descriptionField")}>
              <Textarea
                value={settingsForm.description}
                onChange={updateSettings("description")}
                rows={3}
              />
            </Field>
            <ImageUrlInput
              label={t("teams.avatarUrlField")}
              value={settingsForm.avatar_url}
              onChange={(v) =>
                setSettingsForm((f) => ({ ...f, avatar_url: v }))
              }
            />
            <div>
              <Button
                appearance="primary"
                onClick={handleSaveSettings}
                disabled={saving}
              >
                {saving ? <Spinner size="tiny" /> : t("teams.saveChanges")}
              </Button>
            </div>
          </div>

          {(site?.enable_public_profiles ?? true) && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: 16,
                border: `1px solid ${tokens.colorNeutralStroke1}`,
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text weight="semibold" size={400} block>
                    {t("teams.publicProfileTitle")}
                  </Text>
                  <Text
                    size={200}
                    block
                    style={{
                      color: tokens.colorNeutralForeground3,
                      marginTop: 4,
                    }}
                  >
                    {t("teams.publicProfileDesc")}
                  </Text>
                </div>
                {team.profile_is_public && (
                  <Link
                    href={`/t/${team.id}`}
                    target="_blank"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      flexShrink: 0,
                    }}
                  >
                    <GlobeRegular fontSize={14} />
                    {t("teams.viewPublicProfile")}
                  </Link>
                )}
              </div>
              <Switch
                label={t("teams.makeProfilePublic")}
                checked={team.profile_is_public}
                disabled={savingVisibility === "profile_is_public"}
                onChange={(_, d) =>
                  handleVisibilityChange("profile_is_public", d.checked)
                }
              />
              {team.profile_is_public && site && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    paddingLeft: 12,
                    borderLeft: `2px solid ${tokens.colorNeutralStroke2}`,
                  }}
                >
                  <Text
                    size={200}
                    style={{ color: tokens.colorNeutralForeground3 }}
                  >
                    {t("teams.publicProfileFieldsHint")}
                  </Text>
                  {(
                    [
                      [
                        "profile_show_description",
                        "default_team_profile_show_description",
                        "teams.publicProfileShowDescription",
                      ],
                      [
                        "profile_show_avatar",
                        "default_team_profile_show_avatar",
                        "teams.publicProfileShowAvatar",
                      ],
                      [
                        "profile_show_owner",
                        "default_team_profile_show_owner",
                        "teams.publicProfileShowOwner",
                      ],
                      [
                        "profile_show_member_count",
                        "default_team_profile_show_member_count",
                        "teams.publicProfileShowMemberCount",
                      ],
                      [
                        "profile_show_apps",
                        "default_team_profile_show_apps",
                        "teams.publicProfileShowApps",
                      ],
                      [
                        "profile_show_domains",
                        "default_team_profile_show_domains",
                        "teams.publicProfileShowDomains",
                      ],
                      [
                        "profile_show_members",
                        "default_team_profile_show_members",
                        "teams.publicProfileShowMembers",
                      ],
                    ] as const
                  ).map(([teamKey, siteKey, labelKey]) => {
                    const teamValue = team[teamKey];
                    const siteDefault = site[siteKey];
                    const effective = teamValue ?? siteDefault;
                    return (
                      <Switch
                        key={teamKey}
                        label={
                          teamValue === null
                            ? `${t(labelKey)} (${t("teams.publicProfileFollowingDefault")})`
                            : t(labelKey)
                        }
                        checked={effective}
                        disabled={savingVisibility === teamKey}
                        onChange={(_, d) =>
                          handleVisibilityChange(teamKey, d.checked)
                        }
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {isOwner && (
            <div className={styles.danger}>
              <Text
                weight="semibold"
                style={{ color: tokens.colorPaletteRedForeground1 }}
              >
                {t("teams.dangerZone")}
              </Text>
              <Text
                size={200}
                style={{ color: tokens.colorNeutralForeground3 }}
              >
                {t("teams.dangerZoneDesc")}
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
                  {t("teams.deleteTeam")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
