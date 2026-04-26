// Public-facing user profile viewer. Renders whatever fields the backend
// returns — anything the user opted not to show comes back as null and is
// simply omitted. Works for logged-in and logged-out viewers.

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
  DocumentTextRegular,
  EarthRegular,
  GlobeRegular,
  KeyRegular,
  MailRegular,
  PeopleRegular,
  PlugConnectedRegular,
  ShieldRegular,
} from "@fluentui/react-icons";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../lib/api";
import { renderMarkdown } from "../lib/markdown";

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
  gpgRow: {
    padding: "10px 12px",
    borderRadius: "6px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground3,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  fingerprint: {
    fontFamily: "monospace",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    wordBreak: "break-all",
  },
  readme: {
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
    wordBreak: "break-word",
    "& h1, & h2, & h3, & h4, & h5, & h6": {
      marginTop: "16px",
      marginBottom: "8px",
      fontWeight: tokens.fontWeightSemibold,
    },
    "& h1": { fontSize: tokens.fontSizeBase600 },
    "& h2": { fontSize: tokens.fontSizeBase500 },
    "& h3": { fontSize: tokens.fontSizeBase400 },
    "& p": { margin: "8px 0" },
    "& ul, & ol": { paddingLeft: "24px", margin: "8px 0" },
    "& a": { color: tokens.colorBrandForegroundLink },
    "& code": {
      fontFamily: "monospace",
      background: tokens.colorNeutralBackground3,
      padding: "1px 4px",
      borderRadius: "3px",
      fontSize: "0.9em",
    },
    "& pre": {
      background: tokens.colorNeutralBackground3,
      padding: "12px",
      borderRadius: "6px",
      overflow: "auto",
    },
    "& pre code": { background: "transparent", padding: 0 },
    "& blockquote": {
      borderLeft: `3px solid ${tokens.colorNeutralStroke2}`,
      margin: "8px 0",
      padding: "0 12px",
      color: tokens.colorNeutralForeground2,
    },
    "& img": { maxWidth: "100%", borderRadius: "4px" },
    "& hr": {
      border: 0,
      borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
      margin: "16px 0",
    },
    "& table": {
      borderCollapse: "collapse",
      margin: "8px 0",
    },
    "& th, & td": {
      border: `1px solid ${tokens.colorNeutralStroke2}`,
      padding: "6px 10px",
      textAlign: "left",
    },
  },
});

export function PublicProfile() {
  const styles = useStyles();
  const { username = "" } = useParams<{ username: string }>();
  const { t, i18n } = useTranslation();

  const { data, isLoading, error } = useQuery({
    queryKey: ["public-profile", username],
    queryFn: () => api.getPublicProfile(username),
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
              ? t("publicProfile.notFoundTitle")
              : t("publicProfile.errorTitle")}
          </Title2>
          <Text style={{ color: tokens.colorNeutralForeground3 }}>
            {isNotFound
              ? t("publicProfile.notFoundDesc")
              : error instanceof ApiError
                ? error.message
                : t("publicProfile.errorDesc")}
          </Text>
        </div>
      </div>
    );
  }

  const p = data.profile;
  const hasAnyAdditionalSection =
    (p.gpg_keys?.length ?? 0) > 0 ||
    (p.authorized_apps?.length ?? 0) > 0 ||
    (p.owned_apps?.length ?? 0) > 0 ||
    (p.domains?.length ?? 0) > 0 ||
    (p.joined_teams?.length ?? 0) > 0 ||
    !!p.readme;

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.header}>
          <Avatar
            name={p.display_name ?? p.username}
            image={p.avatar_url ? { src: p.avatar_url } : undefined}
            size={96}
          />
          <div style={{ textAlign: "center" }}>
            {p.display_name && (
              <Title2 block style={{ marginBottom: 4 }}>
                {p.display_name}
              </Title2>
            )}
            <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
              @{p.username}
            </Text>
          </div>
          <Badge appearance="tint" color="informative" icon={<GlobeRegular />}>
            {t("publicProfile.publicProfileBadge")}
          </Badge>
        </div>

        {(p.email || p.joined_at) && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {p.email && (
              <div className={styles.field}>
                <MailRegular />
                <Text style={{ wordBreak: "break-all" }}>{p.email}</Text>
              </div>
            )}
            {p.joined_at && (
              <div className={styles.field}>
                <CalendarRegular />
                <Text>
                  {t("publicProfile.joinedOn", {
                    date: new Date(p.joined_at * 1000).toLocaleDateString(
                      i18n.resolvedLanguage,
                    ),
                  })}
                </Text>
              </div>
            )}
          </div>
        )}

        {hasAnyAdditionalSection && <div className={styles.divider} />}

        {p.readme && <ReadmeSection readme={p.readme} />}

        {p.gpg_keys && p.gpg_keys.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className={styles.sectionTitle}>
              <KeyRegular />
              {t("publicProfile.gpgKeysHeading", {
                count: p.gpg_keys.length,
              })}
            </div>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {t("publicProfile.gpgKeysHint", { username: p.username })}
            </Text>
            {p.gpg_keys.map((k) => (
              <div key={k.fingerprint} className={styles.gpgRow}>
                <Text weight="semibold">{k.name}</Text>
                <Text className={styles.fingerprint}>{k.fingerprint}</Text>
              </div>
            ))}
          </div>
        )}

        {p.owned_apps && p.owned_apps.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className={styles.sectionTitle}>
              <AppsRegular />
              {t("publicProfile.ownedAppsHeading", {
                count: p.owned_apps.length,
              })}
            </div>
            {p.owned_apps.map((a) => (
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
                    icon={<ShieldRegular />}
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

        {p.joined_teams && p.joined_teams.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className={styles.sectionTitle}>
              <PeopleRegular />
              {t("publicProfile.joinedTeamsHeading", {
                count: p.joined_teams.length,
              })}
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              {p.joined_teams.map((team) => (
                <Link
                  key={team.id}
                  to={`/t/${encodeURIComponent(team.id)}`}
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
                    name={team.name}
                    image={
                      team.avatar_url ? { src: team.avatar_url } : undefined
                    }
                    size={20}
                  />
                  <Text size={300}>{team.name}</Text>
                  <Text
                    size={100}
                    style={{ color: tokens.colorNeutralForeground3 }}
                  >
                    · {team.role}
                  </Text>
                </Link>
              ))}
            </div>
          </div>
        )}

        {p.domains && p.domains.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className={styles.sectionTitle}>
              <EarthRegular />
              {t("publicProfile.domainsHeading", {
                count: p.domains.length,
              })}
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
              }}
            >
              {p.domains.map((d) => (
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

        {/* Authorized apps section */}
        {p.authorized_apps && p.authorized_apps.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className={styles.sectionTitle}>
              <PlugConnectedRegular />
              {t("publicProfile.authorizedAppsHeading", {
                count: p.authorized_apps.length,
              })}
            </div>
            {p.authorized_apps.map((a) => (
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
                    icon={<PlugConnectedRegular />}
                  />
                )}
                <div className={styles.appInfo}>
                  <Text weight="semibold" block>
                    {a.name}
                  </Text>
                  {a.website_url && (
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
                      {a.website_url}
                    </Text>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReadmeSection({ readme }: { readme: string }) {
  const styles = useStyles();
  const { t } = useTranslation();
  // Re-render is rare (only on profile reload), but memoize anyway because
  // the sanitize+image-rewrite pass walks the whole DOM.
  const html = useMemo(() => renderMarkdown(readme), [readme]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className={styles.sectionTitle}>
        <DocumentTextRegular />
        {t("publicProfile.readmeHeading")}
      </div>
      <div
        className={styles.readme}
        // html is the output of marked + DOMPurify with our hardened
        // configuration in lib/markdown.ts; safe to inject.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
