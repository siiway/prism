// Public-facing team profile viewer at /t/:id. Same shape as PublicProfile —
// renders only the sections the team owner has chosen to share.

import {
  Avatar,
  Badge,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AppsRegular,
  CalendarRegular,
  GlobeRegular,
  PeopleRegular,
  PersonRegular,
} from "@fluentui/react-icons";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useApi } from "../lib/api-context";
import {
  PublicAppRow,
  PublicChip,
  PublicDivider,
  PublicDomains,
  PublicField,
  PublicHeader,
  PublicPage,
  PublicPageFallback,
  PublicSection,
} from "../components/PublicPage";

const useStyles = makeStyles({
  muted: { color: tokens.colorNeutralForeground3 },
  parentTeamLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "4px 10px",
    borderRadius: "999px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground3,
    textDecoration: "none",
    color: tokens.colorNeutralForeground2,
    transition: "background 120ms ease, border-color 120ms ease",
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground3Hover,
      borderTopColor: tokens.colorNeutralStroke1Hover,
      borderRightColor: tokens.colorNeutralStroke1Hover,
      borderBottomColor: tokens.colorNeutralStroke1Hover,
      borderLeftColor: tokens.colorNeutralStroke1Hover,
    },
  },
  subTeamsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: "8px",
  },
  subTeamCard: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "10px",
    borderRadius: "6px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground3,
    textDecoration: "none",
    color: "inherit",
    minWidth: 0,
    transition:
      "background 120ms ease, border-color 120ms ease, transform 120ms ease",
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground3Hover,
      borderTopColor: tokens.colorNeutralStroke1Hover,
      borderRightColor: tokens.colorNeutralStroke1Hover,
      borderBottomColor: tokens.colorNeutralStroke1Hover,
      borderLeftColor: tokens.colorNeutralStroke1Hover,
      transform: "translateY(-1px)",
    },
  },
  subTeamCardBody: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    flex: 1,
  },
  ellipsis: {
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
});

export function PublicTeam() {
  const api = useApi();
  const styles = useStyles();
  const { id = "" } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();

  const { data, error } = useQuery({
    queryKey: ["public-team", id],
    queryFn: () => api.getPublicTeamProfile(id),
    retry: false,
  });

  if (!data) return <PublicPageFallback error={error} ns="publicTeam" />;

  const team = data.team;
  const hasAnyAdditionalSection =
    !!team.owner ||
    team.member_count !== null ||
    (team.apps?.length ?? 0) > 0 ||
    (team.domains?.length ?? 0) > 0 ||
    (team.members?.length ?? 0) > 0 ||
    (team.sub_teams?.length ?? 0) > 0 ||
    !!team.parent_team;

  return (
    <PublicPage>
      <PublicHeader>
        <Avatar
          name={team.name}
          image={team.avatar_url ? { src: team.avatar_url } : undefined}
          size={96}
          shape="square"
        />
        <Title2 block style={{ textAlign: "center", marginBottom: 0 }}>
          {team.name}
        </Title2>
        <Badge appearance="tint" color="informative" icon={<GlobeRegular />}>
          {t("publicTeam.publicTeamBadge")}
        </Badge>
        {team.description && (
          <Text
            block
            style={{
              color: tokens.colorNeutralForeground2,
              textAlign: "center",
            }}
          >
            {team.description}
          </Text>
        )}
        {team.parent_team && (
          <RouterLink
            to={`/t/${team.parent_team.id}`}
            className={styles.parentTeamLink}
          >
            <Avatar
              name={team.parent_team.name}
              image={
                team.parent_team.avatar_url
                  ? { src: team.parent_team.avatar_url }
                  : undefined
              }
              size={20}
              shape="square"
            />
            <Text size={200}>
              {t("publicTeam.subTeamOf", {
                parent: team.parent_team.name,
              })}
            </Text>
          </RouterLink>
        )}
      </PublicHeader>

      <PublicField icon={<CalendarRegular />}>
        <Text>
          {t("publicTeam.createdOn", {
            date: new Date(team.created_at * 1000).toLocaleDateString(
              i18n.resolvedLanguage,
            ),
          })}
        </Text>
      </PublicField>

      {hasAnyAdditionalSection && <PublicDivider />}

      {team.owner && (
        <PublicField icon={<PersonRegular />}>
          <Text>{t("publicTeam.runByLabel")}</Text>
          {team.owner.username ? (
            <RouterLink
              to={`/u/${team.owner.username}`}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Avatar
                name={team.owner.display_name}
                image={
                  team.owner.avatar_url
                    ? { src: team.owner.avatar_url }
                    : undefined
                }
                size={20}
              />
              <Text weight="semibold">@{team.owner.username}</Text>
            </RouterLink>
          ) : (
            <Text weight="semibold">{team.owner.display_name}</Text>
          )}
        </PublicField>
      )}

      {team.member_count !== null && (
        <PublicField icon={<PeopleRegular />}>
          <Text>
            {t("publicTeam.memberCount", { count: team.member_count })}
          </Text>
        </PublicField>
      )}

      {team.members && team.members.length > 0 && (
        <PublicSection
          icon={<PeopleRegular />}
          title={t("publicTeam.membersHeading", {
            count: team.members.length,
          })}
          wrap
        >
          {team.members.map((m) => (
            <PublicChip
              key={m.username}
              to={`/u/${encodeURIComponent(m.username)}`}
              name={m.display_name}
              avatarUrl={m.avatar_url}
              label={
                <Text size={300} weight="semibold">
                  {m.display_name}
                </Text>
              }
              detail={`@${m.username} · ${m.role}`}
            />
          ))}
        </PublicSection>
      )}

      {team.apps && team.apps.length > 0 && (
        <PublicSection
          icon={<AppsRegular />}
          title={t("publicTeam.appsHeading", { count: team.apps.length })}
        >
          {team.apps.map((a) => (
            <PublicAppRow
              key={a.client_id}
              name={a.name}
              iconUrl={a.icon_url}
              sub={a.description}
            />
          ))}
        </PublicSection>
      )}

      {team.domains && team.domains.length > 0 && (
        <PublicDomains
          domains={team.domains}
          title={t("publicTeam.domainsHeading", {
            count: team.domains.length,
          })}
        />
      )}

      {team.sub_teams && team.sub_teams.length > 0 && (
        <PublicSection
          icon={<PeopleRegular />}
          title={t("publicTeam.subTeamsHeading", {
            count: team.sub_teams.length,
          })}
        >
          <div className={styles.subTeamsGrid}>
            {team.sub_teams.map((s) => (
              <RouterLink
                key={s.id}
                to={`/t/${s.id}`}
                className={styles.subTeamCard}
              >
                <Avatar
                  name={s.name}
                  image={s.avatar_url ? { src: s.avatar_url } : undefined}
                  size={32}
                  shape="square"
                />
                <div className={styles.subTeamCardBody}>
                  <Text
                    weight="semibold"
                    size={300}
                    className={styles.ellipsis}
                  >
                    {s.name}
                  </Text>
                  <Text
                    size={200}
                    className={`${styles.ellipsis} ${styles.muted}`}
                  >
                    {t("publicTeam.subTeamMemberCount", {
                      count: s.member_count,
                    })}
                  </Text>
                </div>
              </RouterLink>
            ))}
          </div>
        </PublicSection>
      )}
    </PublicPage>
  );
}
