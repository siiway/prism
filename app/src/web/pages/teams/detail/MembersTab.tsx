// Members: the roster (with role changes, removal and leaving) and, for
// managers, the team's invite links.

import { Badge } from "@fluentui/react-components";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { type TeamMember } from "../../../lib/api";
import { apiErrorText } from "../../../lib/apiError";
import { useApi } from "../../../lib/api-context";
import { useConfirm } from "../../../lib/useConfirm";
import { useAuthStore } from "../../../store/auth";
import { useAdminViewStore } from "../../../store/adminView";
import { SettingsCard } from "../../../components/Settings";
import { MembersTable } from "../MembersTable";
import { AddMemberDialog } from "../dialogs/AddMemberDialog";
import { AssignGroupsDialog } from "../dialogs/AssignGroupsDialog";
import { InvitesCard } from "./InvitesCard";
import type { TeamTabProps } from "./types";

interface Props extends TeamTabProps {
  /** First page of members from the team detail response. */
  members: TeamMember[];
  memberCount: number;
}

export function MembersTab({
  team,
  myRole,
  canManage,
  isOwner,
  isCoOwnerOrAbove,
  showMsg,
  members,
  memberCount,
}: Props) {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { confirm, confirmDialog } = useConfirm();
  const meId = useAuthStore((s) => s.user?.id);
  const normalView = useAdminViewStore((s) => s.normalView);
  const [assigningGroupsFor, setAssigningGroupsFor] =
    useState<TeamMember | null>(null);
  const teamId = team.id;

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["team", teamId] });
    await qc.invalidateQueries({ queryKey: ["team-members", teamId] });
  };
  const fail = (err: unknown, fallback: string) =>
    showMsg("error", apiErrorText(err, fallback));

  const changeRole = async (userId: string, role: string) => {
    try {
      await api.changeTeamMemberRole(teamId, userId, role);
      await refresh();
      showMsg("success", t("teams.roleUpdated"));
    } catch (err) {
      fail(err, t("teams.failedUpdateRole"));
    }
  };

  const removeMember = async (m: TeamMember) => {
    const leaving = m.user_id === meId;
    const ok = await confirm(
      leaving
        ? {
            title: t("teams.leaveTitle", { team: team.name }),
            body: t("teams.leaveBody"),
            confirmLabel: t("teams.leave"),
          }
        : {
            title: t("teams.removeMemberTitle", { name: m.display_name }),
            body: t("teams.removeMemberBody"),
            confirmLabel: t("common.remove"),
          },
    );
    if (!ok) return;
    try {
      await api.removeTeamMember(teamId, m.user_id);
      if (leaving) {
        await qc.invalidateQueries({ queryKey: ["teams"] });
        navigate("/teams");
        return;
      }
      await refresh();
      showMsg("success", t("teams.memberRemoved"));
    } catch (err) {
      fail(err, t("teams.failedRemoveMember"));
    }
  };

  const transferOwnership = async (m: TeamMember) => {
    const ok = await confirm({
      title: t("teams.transferTitle", { name: m.display_name }),
      body: t("teams.transferBody", { name: m.display_name }),
      confirmLabel: t("teams.transferOwnership"),
    });
    if (!ok) return;
    try {
      await api.transferOwnership(teamId, m.user_id);
      await refresh();
      showMsg("success", t("teams.ownershipTransferred"));
    } catch (err) {
      fail(err, t("teams.failedTransferOwnership"));
    }
  };

  return (
    <>
      <SettingsCard
        id="members"
        title={t("teams.membersTitle")}
        badge={
          <Badge appearance="tint" color="informative" size="small">
            {memberCount}
          </Badge>
        }
        description={
          team.restrict_member_list_for_members && !canManage
            ? t("teams.memberListHiddenNotice")
            : t("teams.membersDesc")
        }
        action={
          canManage && <AddMemberDialog teamId={teamId} showMsg={showMsg} />
        }
      >
        <MembersTable
          teamId={teamId}
          members={members}
          memberCount={memberCount}
          canManage={canManage}
          isOwner={isOwner}
          isCoOwnerOrAbove={isCoOwnerOrAbove}
          myRole={myRole}
          meId={meId}
          normalView={normalView}
          groupsEnabled={team.enable_groups}
          onChangeRole={changeRole}
          onRemoveMember={removeMember}
          onTransferOwnership={transferOwnership}
          onAssignGroups={setAssigningGroupsFor}
        />
      </SettingsCard>

      {canManage && (
        <InvitesCard team={team} showMsg={showMsg} confirm={confirm} />
      )}

      {assigningGroupsFor && (
        <AssignGroupsDialog
          teamId={teamId}
          member={assigningGroupsFor}
          onClose={() => setAssigningGroupsFor(null)}
          showMsg={showMsg}
        />
      )}
      {confirmDialog}
    </>
  );
}
