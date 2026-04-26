// Public-facing team profile viewer at /t/:id. Same shape as PublicProfile —
// renders only the sections the team owner has chosen to share.

import {
  Avatar,
  Badge,
  Spinner,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AppsRegular,
  CalendarRegular,
  EarthRegular,
  GlobeRegular,
  PeopleRegular,
  PersonRegular,
  ShieldRegular,
} from "@fluentui/react-icons";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../lib/api";

const useStyles = makeStyles({
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    background: tokens.colorNeutralBackground1,
    padding: "32px 16px",
    boxSizing: "border-box",
  },
  card: {
    width: "100%",
    maxWidth: "560px",
    padding: "32px",
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground2,
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  header: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "12px",
  },
  field: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    color: tokens.colorNeutralForeground2,
  },
  divider: {
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    margin: "8px 0",
  },
  sectionTitle: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  appRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "10px 12px",
    borderRadius: "6px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground3,
  },
  appInfo: { flex: 1, minWidth: 0 },
});

export function PublicTeam() {
  const styles = useStyles();
  const { id = "" } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();

  const { data, isLoading, error } = useQuery({
    queryKey: ["public-team", id],
    queryFn: () => api.getPublicTeamProfile(id),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className={styles.page}>
        <Spinner size="large" />
      </div>
    );
  }

  if (error || !data) {
    const isNotFound = error instanceof ApiError && error.status === 404;
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <Title2>
            {isNotFound
              ? t("publicTeam.notFoundTitle")
              : t("publicTeam.errorTitle")}
          </Title2>
          <Text style={{ color: tokens.colorNeutralForeground3 }}>
            {isNotFound
              ? t("publicTeam.notFoundDesc")
              : error instanceof ApiError
                ? error.message
                : t("publicTeam.errorDesc")}
          </Text>
        </div>
      </div>
    );
  }

  const team = data.team;
  const hasAnyAdditionalSection =
    !!team.owner ||
    team.member_count !== null ||
    (team.apps?.length ?? 0) > 0 ||
    (team.domains?.length ?? 0) > 0 ||
    (team.members?.length ?? 0) > 0;

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.header}>
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
        </div>

        <div className={styles.field}>
          <CalendarRegular />
          <Text>
            {t("publicTeam.createdOn", {
              date: new Date(team.created_at * 1000).toLocaleDateString(
                i18n.resolvedLanguage,
              ),
            })}
          </Text>
        </div>

        {hasAnyAdditionalSection && <div className={styles.divider} />}

        {team.owner && (
          <div className={styles.field}>
            <PersonRegular />
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
          </div>
        )}

        {team.member_count !== null && (
          <div className={styles.field}>
            <PeopleRegular />
            <Text>
              {t("publicTeam.memberCount", { count: team.member_count })}
            </Text>
          </div>
        )}

        {team.members && team.members.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className={styles.sectionTitle}>
              <PeopleRegular />
              {t("publicTeam.membersHeading", { count: team.members.length })}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {team.members.map((m) => (
                <RouterLink
                  key={m.username}
                  to={`/u/${encodeURIComponent(m.username)}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    border: `1px solid ${tokens.colorNeutralStroke1}`,
                    borderRadius: 6,
                    textDecoration: "none",
                    color: "inherit",
                    background: tokens.colorNeutralBackground3,
                  }}
                >
                  <Avatar
                    name={m.display_name}
                    image={m.avatar_url ? { src: m.avatar_url } : undefined}
                    size={20}
                  />
                  <Text size={300} weight="semibold">
                    {m.display_name}
                  </Text>
                  <Text
                    size={100}
                    style={{ color: tokens.colorNeutralForeground3 }}
                  >
                    @{m.username} · {m.role}
                  </Text>
                </RouterLink>
              ))}
            </div>
          </div>
        )}

        {team.apps && team.apps.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className={styles.sectionTitle}>
              <AppsRegular />
              {t("publicTeam.appsHeading", { count: team.apps.length })}
            </div>
            {team.apps.map((a) => (
              <div key={a.client_id} className={styles.appRow}>
                {a.icon_url ? (
                  <Avatar
                    image={{ src: a.icon_url }}
                    name={a.name}
                    size={32}
                    shape="square"
                  />
                ) : (
                  <Avatar
                    name={a.name}
                    size={32}
                    shape="square"
                    icon={<AppsRegular />}
                  />
                )}
                <div className={styles.appInfo}>
                  <Text weight="semibold" block>
                    {a.name}
                  </Text>
                  {a.description && (
                    <Text
                      size={200}
                      block
                      style={{
                        color: tokens.colorNeutralForeground3,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {a.description}
                    </Text>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {team.domains && team.domains.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className={styles.sectionTitle}>
              <EarthRegular />
              {t("publicTeam.domainsHeading", {
                count: team.domains.length,
              })}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {team.domains.map((d) => (
                <Badge
                  key={d.domain}
                  appearance="tint"
                  color="success"
                  icon={<ShieldRegular />}
                >
                  {d.domain}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
