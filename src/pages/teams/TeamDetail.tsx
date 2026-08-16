// Team detail page — members, apps, settings tabs

import {
  Avatar,
  Badge,
  Breadcrumb,
  BreadcrumbButton,
  BreadcrumbDivider,
  BreadcrumbItem,
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
import {
  CopyRegular,
  DismissRegular,
  SearchRegular,
} from "@fluentui/react-icons";
import {
  AppsRegular,
  OrganizationRegular,
  DeleteRegular,
  GlobeRegular,
  GlobeSearchRegular,
  LinkRegular,
  MailRegular,
  PeopleRegular,
  SettingsRegular,
  ShieldTaskRegular,
  TagRegular,
} from "@fluentui/react-icons";
import { AuditLog } from "../../components/AuditLog";
import { Pagination } from "../../components/Pagination";
import { Fragment, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  api,
  ApiError,
  type Domain,
  type OAuthApp,
  type TeamInvite,
  type TeamMember,
} from "../../lib/api";
import { useToastMessage } from "../../lib/useToastMessage";
import { EmptyState } from "../../components/EmptyState";
import { ImageUrlInput } from "../../components/ImageUrlInput";
import { useAuthStore } from "../../store/auth";
import { InviteDialog } from "./dialogs/InviteDialog";
import { AddMemberDialog } from "./dialogs/AddMemberDialog";
import { CreateSubTeamDialog } from "./dialogs/CreateSubTeamDialog";
import { MigrateAppDialog } from "./dialogs/MigrateAppDialog";
import { NewTeamAppDialog } from "./dialogs/NewTeamAppDialog";
import { AssignGroupsDialog } from "./dialogs/AssignGroupsDialog";
import { MembersTable } from "./MembersTable";
import { GroupsTab } from "./GroupsTab";
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
  breadcrumb: {
    marginBottom: "12px",
  },
  breadcrumbAvatar: {
    marginRight: "6px",
  },
  subTeamsToolbar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "12px",
  },
  subTeamsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: "12px",
  },
  subTeamCard: {
    cursor: "pointer",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "10px",
    padding: "16px",
    background: tokens.colorNeutralBackground1,
    transition: "transform 120ms ease, border-color 120ms ease",
    ":hover": {
      transform: "translateY(-1px)",
      borderTopColor: tokens.colorNeutralForeground1,
      borderRightColor: tokens.colorNeutralForeground1,
      borderBottomColor: tokens.colorNeutralForeground1,
      borderLeftColor: tokens.colorNeutralForeground1,
    },
    ":active": {
      transform: "translateY(0)",
    },
  },
  subTeamCardHeader: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
  },
  subTeamName: {
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  // Let wide tables scroll sideways on narrow screens instead of
  // overflowing the page
  tableScroll: { overflowX: "auto" },
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

type TabType =
  | "members"
  | "groups"
  | "apps"
  | "domains"
  | "sub-teams"
  | "invites"
  | "audit"
  | "settings";

export function TeamDetail() {
  const styles = useStyles();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user: me } = useAuthStore();
  const { t } = useTranslation();

  const [tab, setTab] = useState<TabType>("members");
  const { message, showMsg } = useToastMessage();

  const [subTeamsPage, setSubTeamsPage] = useState(1);
  const [subTeamsQuery, setSubTeamsQuery] = useState("");
  const [subTeamsDebouncedQuery, setSubTeamsDebouncedQuery] = useState("");

  useEffect(() => {
    const id = setTimeout(() => {
      setSubTeamsDebouncedQuery(subTeamsQuery.trim());
      setSubTeamsPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [subTeamsQuery]);

  const [invitesPage, setInvitesPage] = useState(1);
  const [invitesQuery, setInvitesQuery] = useState("");
  const [invitesDebouncedQuery, setInvitesDebouncedQuery] = useState("");

  useEffect(() => {
    const id = setTimeout(() => {
      setInvitesDebouncedQuery(invitesQuery.trim());
      setInvitesPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [invitesQuery]);

  const [appsPage, setAppsPage] = useState(1);
  const [appsQuery, setAppsQuery] = useState("");
  const [appsDebouncedQuery, setAppsDebouncedQuery] = useState("");

  useEffect(() => {
    const id = setTimeout(() => {
      setAppsDebouncedQuery(appsQuery.trim());
      setAppsPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [appsQuery]);

  const [domainsPage, setDomainsPage] = useState(1);
  const [domainsQuery, setDomainsQuery] = useState("");
  const [domainsDebouncedQuery, setDomainsDebouncedQuery] = useState("");

  useEffect(() => {
    const id = setTimeout(() => {
      setDomainsDebouncedQuery(domainsQuery.trim());
      setDomainsPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [domainsQuery]);

  const { data, isLoading } = useQuery({
    queryKey: ["team", id],
    queryFn: () => api.getTeam(id!),
    enabled: !!id,
  });

  const {
    data: appsData,
    isLoading: appsLoading,
    isFetching: appsFetching,
  } = useQuery({
    queryKey: ["team-apps", id, appsPage, appsDebouncedQuery],
    queryFn: () =>
      api.listTeamApps(id!, {
        page: appsPage,
        limit: 20,
        q: appsDebouncedQuery || undefined,
      }),
    enabled: !!id && tab === "apps",
  });

  const {
    data: invitesData,
    isLoading: invitesLoading,
    isFetching: invitesFetching,
  } = useQuery({
    queryKey: ["team-invites", id, invitesPage, invitesDebouncedQuery],
    queryFn: () =>
      api.listTeamInvites(id!, {
        page: invitesPage,
        limit: 20,
        q: invitesDebouncedQuery || undefined,
      }),
    enabled:
      !!id &&
      tab === "invites" &&
      (data?.team?.my_role === "owner" ||
        data?.team?.my_role === "co-owner" ||
        data?.team?.my_role === "admin"),
  });

  const { data: myAppsData } = useQuery({
    queryKey: ["apps"],
    queryFn: () => api.listApps(),
    enabled: tab === "apps",
  });

  const {
    data: domainsData,
    isLoading: domainsLoading,
    isFetching: domainsFetching,
  } = useQuery({
    queryKey: ["team-domains", id, domainsPage, domainsDebouncedQuery],
    queryFn: () =>
      api.listTeamDomains(id!, {
        page: domainsPage,
        limit: 20,
        q: domainsDebouncedQuery || undefined,
      }),
    enabled: !!id && tab === "domains",
  });

  const { data: personalDomainsData } = useQuery({
    queryKey: ["domains"],
    queryFn: () => api.listDomains(),
    enabled:
      tab === "domains" &&
      (data?.team?.my_role === "owner" ||
        data?.team?.my_role === "co-owner" ||
        data?.team?.my_role === "admin"),
  });

  const {
    data: subTeamsData,
    isLoading: subTeamsLoading,
    isFetching: subTeamsFetching,
  } = useQuery({
    queryKey: ["sub-teams", id, subTeamsPage, subTeamsDebouncedQuery],
    queryFn: () =>
      api.listSubTeams(id!, {
        page: subTeamsPage,
        limit: 20,
        q: subTeamsDebouncedQuery || undefined,
      }),
    enabled: !!id && tab === "sub-teams",
  });

  const team = data?.team;
  const members = data?.members ?? [];
  const myRole = team?.my_role ?? "member";
  const canManage =
    myRole === "owner" || myRole === "co-owner" || myRole === "admin";
  const isOwner = myRole === "owner";
  const isCoOwnerOrAbove = myRole === "owner" || myRole === "co-owner";

  const handleChangeRole = async (userId: string, role: string) => {
    if (!id) return;
    try {
      await api.changeTeamMemberRole(id, userId, role);
      await qc.invalidateQueries({ queryKey: ["team", id] });
      await qc.invalidateQueries({ queryKey: ["team-members", id] });
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
      await qc.invalidateQueries({ queryKey: ["team-members", id] });
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
      await qc.invalidateQueries({ queryKey: ["team-members", id] });
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

  // ── Member groups ───────────────────────────────────────────────────────────
  const [assigningGroupsFor, setAssigningGroupsFor] =
    useState<TeamMember | null>(null);

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
      | "profile_show_members"
      | "profile_show_sub_teams",
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

  const [savingRequirement, setSavingRequirement] = useState<string | null>(
    null,
  );
  const handleRequirementChange = async (
    field: "require_2fa" | "require_verified_email",
    value: boolean,
  ) => {
    if (!id) return;
    setSavingRequirement(field);
    try {
      await api.updateTeam(id, { [field]: value });
      await qc.invalidateQueries({ queryKey: ["team", id] });
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("teams.failedUpdateTeam"),
      );
    } finally {
      setSavingRequirement(null);
    }
  };

  const handleTeamFlagChange = async (
    field: "invite_registration_enabled" | "allow_normal_user_join",
    value: boolean,
  ) => {
    if (!id) return;
    setSavingRequirement(field);
    try {
      await api.updateTeam(id, { [field]: value });
      await qc.invalidateQueries({ queryKey: ["team", id] });
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("teams.failedUpdateTeam"),
      );
    } finally {
      setSavingRequirement(null);
    }
  };

  const handleEnableGroupsChange = async (value: boolean) => {
    if (!id) return;
    setSavingRequirement("enable_groups");
    try {
      await api.updateTeam(id, { enable_groups: value });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["team", id] }),
        qc.invalidateQueries({ queryKey: ["team-groups", id] }),
      ]);
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("teams.failedUpdateTeam"),
      );
    } finally {
      setSavingRequirement(null);
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

      {/* Ancestor breadcrumb (sub-teams only) */}
      {team.ancestors && team.ancestors.length > 0 && (
        <Breadcrumb
          className={styles.breadcrumb}
          aria-label={t("teams.breadcrumbLabel")}
          size="medium"
        >
          {[...team.ancestors].reverse().map((a, i, arr) => (
            <Fragment key={a.id}>
              <BreadcrumbItem>
                <BreadcrumbButton
                  onClick={() => navigate(`/teams/${a.id}`)}
                  icon={
                    <Avatar
                      name={a.name}
                      image={a.avatar_url ? { src: a.avatar_url } : undefined}
                      size={20}
                      shape="square"
                      className={styles.breadcrumbAvatar}
                    />
                  }
                >
                  {a.name}
                </BreadcrumbButton>
              </BreadcrumbItem>
              {i < arr.length - 1 && <BreadcrumbDivider />}
            </Fragment>
          ))}
        </Breadcrumb>
      )}

      {/* Header */}
      <div className={styles.header}>
        {team.avatar_url ? (
          <Avatar image={{ src: team.avatar_url }} name={team.name} size={48} />
        ) : (
          <Avatar name={team.name} size={48} />
        )}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Title2>{team.name}</Title2>
          {team.description && (
            <Text block style={{ color: tokens.colorNeutralForeground3 }}>
              {team.description}
            </Text>
          )}
        </div>
        <Badge color={ROLE_COLORS[myRole] ?? "subtle"} appearance="filled">
          {myRole}
        </Badge>
        {team.inherited_from && (
          <Tooltip
            content={t("teams.inheritedFromAncestor")}
            relationship="label"
          >
            <Badge color="informative" appearance="outline" size="small">
              {t("teams.inheritedBadge")}
            </Badge>
          </Tooltip>
        )}
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
          {t("teams.membersTab", {
            count: data?.member_count ?? members.length,
          })}
        </Tab>
        {/* Visible to managers even while the feature is off, so an owner
            can find the switch and see what's already defined. */}
        {canManage && (team.enable_groups || isOwner) && (
          <Tab value="groups" icon={<TagRegular />}>
            {t("teams.groupsTab")}
          </Tab>
        )}
        <Tab value="apps" icon={<AppsRegular />}>
          {t("teams.appsTab")}
        </Tab>
        <Tab value="domains" icon={<GlobeSearchRegular />}>
          {t("teams.domainsTab")}
        </Tab>
        {(site?.enable_sub_teams ?? true) && (
          <Tab value="sub-teams" icon={<OrganizationRegular />}>
            {t("teams.subTeamsTab", {
              count: data?.team?.sub_team_count ?? 0,
            })}
          </Tab>
        )}
        {canManage && (
          <Tab value="invites" icon={<LinkRegular />}>
            {t("teams.invitesTab")}
          </Tab>
        )}
        {(isCoOwnerOrAbove || myRole === "admin") && (
          <Tab value="audit" icon={<ShieldTaskRegular />}>
            {t("teams.auditTab")}
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
            teamId={id!}
            members={members}
            memberCount={data?.member_count ?? members.length}
            canManage={canManage}
            isOwner={isOwner}
            isCoOwnerOrAbove={isCoOwnerOrAbove}
            myRole={myRole}
            meId={me?.id}
            groupsEnabled={team.enable_groups}
            onChangeRole={handleChangeRole}
            onRemoveMember={handleRemoveMember}
            onTransferOwnership={handleTransferOwnership}
            onAssignGroups={setAssigningGroupsFor}
          />

          {assigningGroupsFor && (
            <AssignGroupsDialog
              teamId={id!}
              member={assigningGroupsFor}
              onClose={() => setAssigningGroupsFor(null)}
              showMsg={showMsg}
            />
          )}
        </div>
      )}

      {/* Member groups tab */}
      {tab === "groups" && canManage && (
        <GroupsTab
          teamId={id!}
          enabled={team.enable_groups}
          isOwner={isOwner}
          showMsg={showMsg}
        />
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

          <Input
            value={appsQuery}
            onChange={(e) => setAppsQuery(e.target.value)}
            placeholder={t("teams.searchTeamAppsPlaceholder")}
            contentBefore={<SearchRegular />}
            contentAfter={
              appsQuery ? (
                <Button
                  appearance="transparent"
                  size="small"
                  icon={<DismissRegular />}
                  aria-label={t("common.clear")}
                  onClick={() => setAppsQuery("")}
                />
              ) : undefined
            }
            style={{ minWidth: 220, flex: "1 1 220px" }}
          />

          <AppsGrid apps={appsData?.apps ?? []} loading={appsLoading} />

          <Pagination
            page={appsPage}
            pageCount={Math.max(1, Math.ceil((appsData?.total || 0) / 20))}
            total={appsData?.total}
            onChange={setAppsPage}
            disabled={appsFetching}
          />
        </div>
      )}

      {/* Domains tab */}
      {tab === "domains" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Text style={{ color: tokens.colorNeutralForeground3 }}>
            {t("teams.domainsDesc")}
          </Text>

          <Input
            value={domainsQuery}
            onChange={(e) => setDomainsQuery(e.target.value)}
            placeholder={t("teams.searchTeamDomainsPlaceholder")}
            contentBefore={<SearchRegular />}
            contentAfter={
              domainsQuery ? (
                <Button
                  appearance="transparent"
                  size="small"
                  icon={<DismissRegular />}
                  aria-label={t("common.clear")}
                  onClick={() => setDomainsQuery("")}
                />
              ) : undefined
            }
            style={{ minWidth: 220, flex: "1 1 220px" }}
          />

          <DomainsTable
            teamId={id!}
            domains={domainsData?.domains ?? []}
            loading={domainsLoading}
            canManage={canManage}
            verifyingDomain={null}
            transferableDomains={transferableDomains}
            showMsg={showMsg}
          />

          <Pagination
            page={domainsPage}
            pageCount={Math.max(1, Math.ceil((domainsData?.total || 0) / 20))}
            total={domainsData?.total}
            onChange={setDomainsPage}
            disabled={domainsFetching}
          />
        </div>
      )}

      {/* Sub-teams tab */}
      {tab === "sub-teams" && (site?.enable_sub_teams ?? true) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className={styles.subTeamsToolbar}>
            <Text style={{ color: tokens.colorNeutralForeground3 }}>
              {t("teams.subTeamsDesc")}
            </Text>
            {canManage && (
              <CreateSubTeamDialog parentTeamId={id!} showMsg={showMsg} />
            )}
          </div>
          <Input
            value={subTeamsQuery}
            onChange={(e) => setSubTeamsQuery(e.target.value)}
            placeholder={t("teams.searchSubTeamsPlaceholder")}
            contentBefore={<SearchRegular />}
            contentAfter={
              subTeamsQuery ? (
                <Button
                  appearance="transparent"
                  size="small"
                  icon={<DismissRegular />}
                  aria-label={t("common.clear")}
                  onClick={() => setSubTeamsQuery("")}
                />
              ) : undefined
            }
            style={{ minWidth: 220, flex: "1 1 220px" }}
          />
          {subTeamsLoading && <SkeletonFormCard rows={3} />}
          {!subTeamsLoading && (subTeamsData?.sub_teams ?? []).length === 0 && (
            <EmptyState
              icon={<OrganizationRegular />}
              title={t("teams.noSubTeams")}
              description={canManage ? t("teams.noSubTeamsHint") : undefined}
            />
          )}
          {!subTeamsLoading && (subTeamsData?.sub_teams ?? []).length > 0 && (
            <div className={styles.subTeamsGrid}>
              {(subTeamsData?.sub_teams ?? []).map((sub) => (
                <div
                  key={sub.id}
                  className={styles.subTeamCard}
                  onClick={() => navigate(`/teams/${sub.id}`)}
                  role="link"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      navigate(`/teams/${sub.id}`);
                    }
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                    }}
                  >
                    {sub.avatar_url ? (
                      <Avatar
                        image={{ src: sub.avatar_url }}
                        name={sub.name}
                        size={36}
                        shape="square"
                      />
                    ) : (
                      <Avatar name={sub.name} size={36} shape="square" />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className={styles.subTeamCardHeader}>
                        <Text weight="semibold" className={styles.subTeamName}>
                          {sub.name}
                        </Text>
                        <Badge
                          color={ROLE_COLORS[sub.my_role] ?? "subtle"}
                          appearance="filled"
                          size="small"
                        >
                          {sub.my_role}
                        </Badge>
                      </div>
                      <Text
                        size={200}
                        style={{ color: tokens.colorNeutralForeground3 }}
                      >
                        {t("teams.memberCountShort", {
                          count: sub.member_count,
                        })}
                      </Text>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Pagination
            page={subTeamsPage}
            pageCount={Math.max(1, Math.ceil((subTeamsData?.total || 0) / 20))}
            total={subTeamsData?.total}
            onChange={setSubTeamsPage}
            disabled={subTeamsFetching}
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
            <InviteDialog
              teamId={id!}
              canRegister={
                team.invite_registration_granted &&
                team.invite_registration_enabled
              }
              showMsg={showMsg}
            />
          </div>

          <Input
            value={invitesQuery}
            onChange={(e) => setInvitesQuery(e.target.value)}
            placeholder={t("teams.searchInvitesPlaceholder")}
            contentBefore={<SearchRegular />}
            contentAfter={
              invitesQuery ? (
                <Button
                  appearance="transparent"
                  size="small"
                  icon={<DismissRegular />}
                  aria-label={t("common.clear")}
                  onClick={() => setInvitesQuery("")}
                />
              ) : undefined
            }
            style={{ minWidth: 220, flex: "1 1 220px", marginBottom: 12 }}
          />

          {invitesLoading && <SkeletonTableRows rows={3} cols={4} />}

          {!invitesLoading && (invitesData?.invites ?? []).length === 0 && (
            <EmptyState
              icon={<LinkRegular />}
              title={t("teams.noActiveInvites")}
            />
          )}

          {!invitesLoading && (invitesData?.invites ?? []).length > 0 && (
            <div className={styles.tableScroll}>
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
                    const isHashed = inv.token.startsWith("__HASH_v1__");
                    const inviteUrl = `${window.location.origin}/teams/join/${inv.token}`;
                    const hashPreview = isHashed
                      ? `${inv.token.slice(11, 19)}…`
                      : null;
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
                                style={{
                                  color: tokens.colorNeutralForeground3,
                                }}
                              />
                              <Text size={300}>{inv.email}</Text>
                            </div>
                          ) : isHashed ? (
                            <Tooltip content={inv.token} relationship="label">
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                }}
                              >
                                <LinkRegular
                                  style={{
                                    color: tokens.colorNeutralForeground3,
                                  }}
                                />
                                <Text
                                  size={200}
                                  style={{
                                    color: tokens.colorNeutralForeground3,
                                    fontFamily: "monospace",
                                  }}
                                >
                                  {hashPreview}
                                </Text>
                              </div>
                            </Tooltip>
                          ) : (
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              <LinkRegular
                                style={{
                                  color: tokens.colorNeutralForeground3,
                                }}
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
                            {inv.uses} /{" "}
                            {inv.max_uses === 0 ? "∞" : inv.max_uses}
                          </Text>
                        </TableCell>
                        <TableCell>
                          <Text size={300}>
                            {new Date(
                              inv.expires_at * 1000,
                            ).toLocaleDateString()}
                          </Text>
                        </TableCell>
                        <TableCell>
                          <Text size={300}>@{inv.created_by_username}</Text>
                        </TableCell>
                        <TableCell>
                          <div style={{ display: "flex", gap: 4 }}>
                            {!inv.email && !isHashed && (
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
                                  onClick={() =>
                                    handleCopyInviteLink(inv.token)
                                  }
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
            </div>
          )}

          <Pagination
            page={invitesPage}
            pageCount={Math.max(1, Math.ceil((invitesData?.total || 0) / 20))}
            total={invitesData?.total}
            onChange={setInvitesPage}
            disabled={invitesFetching}
          />
        </div>
      )}

      {/* Audit tab — Transparent Team Control */}
      {tab === "audit" && (isCoOwnerOrAbove || myRole === "admin") && (
        <AuditLog base={`team/${id}`} />
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

          {isOwner &&
            (() => {
              const siteForces2fa = !!site?.default_team_require_2fa;
              const siteForcesEmail =
                !!site?.default_team_require_verified_email;
              const effective2fa = team.require_2fa || siteForces2fa;
              const effectiveEmail =
                team.require_verified_email || siteForcesEmail;
              return (
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
                  <div>
                    <Text weight="semibold" size={400} block>
                      {t("teams.joinRequirementsTitle")}
                    </Text>
                    <Text
                      size={200}
                      block
                      style={{
                        color: tokens.colorNeutralForeground3,
                        marginTop: 4,
                      }}
                    >
                      {t("teams.joinRequirementsDesc")}
                    </Text>
                  </div>
                  <Switch
                    label={
                      siteForcesEmail
                        ? `${t("teams.requireVerifiedEmail")} (${t("teams.requirementForcedBySite")})`
                        : t("teams.requireVerifiedEmail")
                    }
                    checked={effectiveEmail}
                    disabled={
                      siteForcesEmail ||
                      savingRequirement === "require_verified_email"
                    }
                    onChange={(_, d) =>
                      handleRequirementChange(
                        "require_verified_email",
                        d.checked,
                      )
                    }
                  />
                  <Switch
                    label={
                      siteForces2fa
                        ? `${t("teams.require2FA")} (${t("teams.requirementForcedBySite")})`
                        : t("teams.require2FA")
                    }
                    checked={effective2fa}
                    disabled={
                      siteForces2fa || savingRequirement === "require_2fa"
                    }
                    onChange={(_, d) =>
                      handleRequirementChange("require_2fa", d.checked)
                    }
                  />
                </div>
              );
            })()}

          {isOwner && (
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
              <div>
                <Text weight="semibold" size={400} block>
                  {t("teams.groupsSettingsTitle")}
                </Text>
                <Text
                  size={200}
                  block
                  style={{
                    color: tokens.colorNeutralForeground3,
                    marginTop: 4,
                  }}
                >
                  {t("teams.groupsSettingsDesc")}
                </Text>
              </div>
              <Switch
                label={t("teams.enableGroups")}
                checked={team.enable_groups}
                disabled={savingRequirement === "enable_groups"}
                onChange={(_, d) => handleEnableGroupsChange(d.checked)}
              />
            </div>
          )}

          {/* Only shown once a site admin has authorised the team, or while
              it is already on — there is nothing an owner can do about it
              otherwise, and an inert switch invites support questions. */}
          {isOwner &&
            (team.invite_registration_granted ||
              team.invite_registration_enabled) && (
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
                <div>
                  <Text weight="semibold" size={400} block>
                    {t("teams.inviteRegTitle")}
                  </Text>
                  <Text
                    size={200}
                    block
                    style={{
                      color: tokens.colorNeutralForeground3,
                      marginTop: 4,
                    }}
                  >
                    {t("teams.inviteRegDesc")}
                  </Text>
                </div>

                {!team.invite_registration_granted ? (
                  <MessageBar intent="info">
                    {t("teams.inviteRegNotGranted")}
                  </MessageBar>
                ) : (
                  <>
                    <Switch
                      label={t("teams.inviteRegEnable")}
                      checked={team.invite_registration_enabled}
                      disabled={
                        savingRequirement === "invite_registration_enabled"
                      }
                      onChange={(_, d) =>
                        handleTeamFlagChange(
                          "invite_registration_enabled",
                          d.checked,
                        )
                      }
                    />
                    {team.invite_registration_exemptions
                      ?.email_verification && (
                      <MessageBar intent="warning">
                        {t("teams.inviteRegExemptEmail")}
                      </MessageBar>
                    )}
                    {team.invite_registration_enabled && (
                      <Text size={200}>
                        {t("teams.inviteRegPageLink")}:{" "}
                        <Link href={`/join/${team.id}`} target="_blank">
                          {`${typeof window === "undefined" ? "" : window.location.origin}/join/${team.id}`}
                        </Link>
                      </Text>
                    )}
                  </>
                )}

                <Switch
                  label={t("teams.allowNormalJoin")}
                  checked={team.allow_normal_user_join}
                  disabled={savingRequirement === "allow_normal_user_join"}
                  onChange={(_, d) =>
                    handleTeamFlagChange("allow_normal_user_join", d.checked)
                  }
                />
                <Text
                  size={200}
                  style={{ color: tokens.colorNeutralForeground3 }}
                >
                  {t("teams.allowNormalJoinHint")}
                </Text>
              </div>
            )}

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
                {!!team.profile_is_public && (
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
              {!!team.profile_is_public && site && (
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
                      [
                        "profile_show_sub_teams",
                        "default_team_profile_show_sub_teams",
                        "teams.publicProfileShowSubTeams",
                      ],
                    ] as const
                  ).map(([teamKey, siteKey, labelKey]) => {
                    if (
                      teamKey === "profile_show_sub_teams" &&
                      !(site?.enable_sub_teams ?? true)
                    ) {
                      return null;
                    }
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
