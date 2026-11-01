// Settings: the team's profile and policies, one card per concern. Switches
// save as they change; the profile form has its own Save.

import {
  Button,
  Field,
  Input,
  Link,
  MessageBar,
  Spinner,
  Switch,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { DeleteRegular, OpenRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, type Team } from "../../../lib/api";
import { useApi, useAppOrigin } from "../../../lib/api-context";
import { useConfirm } from "../../../lib/useConfirm";
import { useSiteName } from "../../../lib/useSiteName";
import { ImageUrlInput } from "../../../components/ImageUrlInput";
import {
  SettingsBody,
  SettingsCard,
  SettingsFooter,
  SettingsRow,
  SettingsSubhead,
} from "../../../components/Settings";
import type { TeamTabProps } from "./types";

const useStyles = makeStyles({
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    maxWidth: "560px",
  },
  danger: { color: tokens.colorPaletteRedForeground1 },
  mono: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    overflowWrap: "anywhere",
  },
});

type TeamFlag =
  | "require_2fa"
  | "require_verified_email"
  | "restrict_member_list_for_members"
  | "enable_groups"
  | "invite_registration_enabled"
  | "allow_normal_user_join"
  | "profile_is_public"
  | "profile_show_description"
  | "profile_show_avatar"
  | "profile_show_owner"
  | "profile_show_member_count"
  | "profile_show_apps"
  | "profile_show_domains"
  | "profile_show_members"
  | "profile_show_sub_teams";

// Team field, site default, label.
const PROFILE_FIELDS = [
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
] as const;

export function SettingsTab({
  team,
  isOwner,
  isCoOwnerOrAbove,
  showMsg,
}: TeamTabProps) {
  const api = useApi();
  // The configured origin, not window.location: the server renders this
  // page too, and the two must agree.
  const origin = useAppOrigin();
  const styles = useStyles();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const siteName = useSiteName();
  const { confirm, confirmDialog } = useConfirm();
  const teamId = team.id;

  const { data: site } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });

  const fail = (err: unknown) =>
    showMsg(
      "error",
      err instanceof ApiError ? err.message : t("teams.failedUpdateTeam"),
    );

  // ── Profile form: unsaved edits over the server copy ───────────────────────
  const base = {
    name: team.name,
    description: team.description,
    avatar_url: team.unproxied_avatar_url ?? "",
  };
  const [edits, setEdits] = useState<Partial<typeof base>>({});
  const form = { ...base, ...edits };
  const dirty =
    form.name !== base.name ||
    form.description !== base.description ||
    form.avatar_url !== base.avatar_url;
  const [saving, setSaving] = useState(false);

  const saveProfile = async () => {
    setSaving(true);
    try {
      await api.updateTeam(teamId, {
        name: form.name.trim(),
        description: form.description.trim(),
        avatar_url: form.avatar_url.trim(),
      });
      await qc.invalidateQueries({ queryKey: ["team", teamId] });
      await qc.invalidateQueries({ queryKey: ["teams"] });
      setEdits({});
      showMsg("success", t("teams.teamUpdated"));
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  // ── Switches ───────────────────────────────────────────────────────────────
  const [pending, setPending] = useState<TeamFlag | null>(null);
  const setFlag = async (field: TeamFlag, value: boolean) => {
    setPending(field);
    try {
      await api.updateTeam(teamId, { [field]: value });
      await qc.invalidateQueries({ queryKey: ["team", teamId] });
      if (field === "enable_groups")
        await qc.invalidateQueries({ queryKey: ["team-groups", teamId] });
      if (field === "restrict_member_list_for_members")
        await qc.invalidateQueries({ queryKey: ["team-members", teamId] });
    } catch (err) {
      fail(err);
    } finally {
      setPending(null);
    }
  };

  const flagSwitch = (
    field: TeamFlag,
    label: string,
    checked: boolean,
    disabled = false,
  ) => (
    <Switch
      aria-label={label}
      checked={checked}
      disabled={disabled || pending === field}
      onChange={(_, d) => setFlag(field, d.checked)}
    />
  );

  const deleteTeam = async () => {
    const ok = await confirm({
      title: t("teams.deleteTeamTitle", { name: team.name }),
      body: t("teams.dangerZoneDesc"),
      confirmLabel: t("teams.deleteTeam"),
    });
    if (!ok) return;
    try {
      await api.deleteTeam(teamId);
      await qc.invalidateQueries({ queryKey: ["teams"] });
      navigate("/teams");
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("teams.failedDeleteTeam"),
      );
    }
  };

  const siteForces2fa = !!site?.default_team_require_2fa;
  const siteForcesEmail = !!site?.default_team_require_verified_email;
  const joinUrl = `${origin}/join/${teamId}`;

  return (
    <>
      <SettingsCard
        id="profile"
        title={t("teams.profileTitle")}
        description={t("teams.profileDesc")}
      >
        <SettingsBody>
          <div className={styles.form}>
            <Field label={t("teams.teamNameField")} required>
              <Input
                value={form.name}
                onChange={(_, d) => setEdits((e) => ({ ...e, name: d.value }))}
              />
            </Field>
            <Field label={t("teams.descriptionField")}>
              <Textarea
                value={form.description}
                onChange={(_, d) =>
                  setEdits((e) => ({ ...e, description: d.value }))
                }
                rows={2}
                resize="vertical"
              />
            </Field>
            <ImageUrlInput
              label={t("teams.avatarUrlField")}
              value={form.avatar_url}
              placeholder={t("teams.avatarUrlPlaceholder")}
              onChange={(v) => setEdits((e) => ({ ...e, avatar_url: v }))}
            />
          </div>
        </SettingsBody>
        <SettingsFooter>
          {dirty && !saving && (
            <Button appearance="subtle" onClick={() => setEdits({})}>
              {t("common.discard")}
            </Button>
          )}
          <Button
            appearance="primary"
            disabled={!dirty || saving || !form.name.trim()}
            onClick={saveProfile}
          >
            {saving ? <Spinner size="tiny" /> : t("common.saveChanges")}
          </Button>
        </SettingsFooter>
      </SettingsCard>

      {(isOwner || isCoOwnerOrAbove) && (
        <SettingsCard
          id="membership"
          title={t("teams.membershipTitle")}
          description={t("teams.membershipDesc")}
        >
          {isOwner && (
            <>
              <SettingsRow
                label={t("teams.requireVerifiedEmail")}
                description={
                  siteForcesEmail
                    ? t("teams.requirementForcedBySite")
                    : t("teams.requireVerifiedEmailDesc")
                }
              >
                {flagSwitch(
                  "require_verified_email",
                  t("teams.requireVerifiedEmail"),
                  team.require_verified_email || siteForcesEmail,
                  siteForcesEmail,
                )}
              </SettingsRow>
              <SettingsRow
                label={t("teams.require2FA")}
                description={
                  siteForces2fa
                    ? t("teams.requirementForcedBySite")
                    : t("teams.require2FADesc")
                }
              >
                {flagSwitch(
                  "require_2fa",
                  t("teams.require2FA"),
                  team.require_2fa || siteForces2fa,
                  siteForces2fa,
                )}
              </SettingsRow>
            </>
          )}
          <SettingsRow
            label={t("teams.restrictMemberListForMembers")}
            description={t("teams.memberListVisibilityDesc")}
          >
            {flagSwitch(
              "restrict_member_list_for_members",
              t("teams.restrictMemberListForMembers"),
              team.restrict_member_list_for_members,
            )}
          </SettingsRow>
          {isOwner && (
            <SettingsRow
              label={t("teams.enableGroups")}
              description={t("teams.groupsSettingsDesc")}
            >
              {flagSwitch(
                "enable_groups",
                t("teams.enableGroups"),
                team.enable_groups,
              )}
            </SettingsRow>
          )}
        </SettingsCard>
      )}

      {/* Only once a site admin has authorised the team, or while it is
          already on: otherwise an owner can do nothing about it. */}
      {isOwner &&
        (team.invite_registration_granted ||
          team.invite_registration_enabled) && (
          <SettingsCard
            id="invite-registration"
            title={t("teams.inviteRegTitle")}
            description={t("teams.inviteRegDesc", { siteName })}
          >
            <SettingsRow
              label={t("teams.inviteRegEnable")}
              description={
                !team.invite_registration_granted ? (
                  t("teams.inviteRegNotGranted")
                ) : team.invite_registration_enabled ? (
                  <Link href={joinUrl} target="_blank">
                    {joinUrl}
                  </Link>
                ) : undefined
              }
            >
              {flagSwitch(
                "invite_registration_enabled",
                t("teams.inviteRegEnable"),
                team.invite_registration_granted &&
                  team.invite_registration_enabled,
                !team.invite_registration_granted,
              )}
            </SettingsRow>
            {team.invite_registration_granted &&
              team.invite_registration_exemptions?.email_verification && (
                <SettingsBody>
                  <MessageBar intent="warning">
                    {t("teams.inviteRegExemptEmail")}
                  </MessageBar>
                </SettingsBody>
              )}
            <SettingsRow
              label={t("teams.allowNormalJoin", { siteName })}
              description={t("teams.allowNormalJoinHint")}
            >
              {flagSwitch(
                "allow_normal_user_join",
                t("teams.allowNormalJoin", { siteName }),
                team.allow_normal_user_join,
              )}
            </SettingsRow>
          </SettingsCard>
        )}

      {(site?.enable_public_profiles ?? true) && (
        <SettingsCard
          id="public-profile"
          title={t("teams.publicProfileTitle")}
          description={t("teams.publicProfileDesc")}
          action={
            team.profile_is_public && (
              <Button
                as="a"
                href={`/t/${teamId}`}
                target="_blank"
                size="small"
                icon={<OpenRegular />}
              >
                {t("teams.viewPublicProfile")}
              </Button>
            )
          }
        >
          <SettingsRow
            label={t("teams.makeProfilePublic")}
            description={
              <span className={styles.mono}>
                {origin}/t/{teamId}
              </span>
            }
          >
            {flagSwitch(
              "profile_is_public",
              t("teams.makeProfilePublic"),
              team.profile_is_public,
            )}
          </SettingsRow>
          {team.profile_is_public && site && (
            <>
              <SettingsSubhead>
                {t("teams.publicProfileFieldsHint")}
              </SettingsSubhead>
              {PROFILE_FIELDS.map(([teamKey, siteKey, labelKey]) => {
                if (
                  teamKey === "profile_show_sub_teams" &&
                  !(site.enable_sub_teams ?? true)
                )
                  return null;
                const value = team[teamKey as keyof Team] as boolean | null;
                return (
                  <SettingsRow
                    key={teamKey}
                    label={t(labelKey)}
                    description={
                      value === null
                        ? t("teams.publicProfileFollowingDefault")
                        : undefined
                    }
                  >
                    {flagSwitch(teamKey, t(labelKey), value ?? site[siteKey])}
                  </SettingsRow>
                );
              })}
            </>
          )}
        </SettingsCard>
      )}

      {isOwner && (
        <SettingsCard id="delete" title={t("teams.dangerZone")}>
          <SettingsRow
            label={t("teams.deleteTeam")}
            description={t("teams.dangerZoneDesc")}
          >
            <Button
              size="small"
              icon={<DeleteRegular />}
              className={styles.danger}
              onClick={deleteTeam}
            >
              {t("common.delete")}
            </Button>
          </SettingsRow>
        </SettingsCard>
      )}

      {confirmDialog}
    </>
  );
}
