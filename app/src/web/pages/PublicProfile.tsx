// Public-facing user profile viewer. Renders whatever fields the backend
// returns — anything the user opted not to show comes back as null and is
// simply omitted. Works for logged-in and logged-out viewers.

import {
  Avatar,
  Badge,
  Link as FluentLink,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AppsRegular,
  CalendarRegular,
  DocumentTextRegular,
  GlobeRegular,
  KeyRegular,
  MailRegular,
  PeopleRegular,
  PlugConnectedRegular,
} from "@fluentui/react-icons";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "../lib/api-context";
import { renderMarkdown } from "../lib/markdown";
import { CopyButton } from "../components/CopyButton";
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
  facts: { display: "flex", flexDirection: "column", gap: "8px" },
  gpgRow: {
    padding: "10px 12px",
    borderRadius: "6px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground3,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  gpgName: { display: "flex", alignItems: "center", gap: "4px" },
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
  const api = useApi();
  const styles = useStyles();
  const { username = "" } = useParams<{ username: string }>();
  const { t, i18n } = useTranslation();

  const { data, error } = useQuery({
    queryKey: ["public-profile", username],
    queryFn: () => api.getPublicProfile(username),
    retry: false,
  });

  if (!data) return <PublicPageFallback error={error} ns="publicProfile" />;

  const p = data.profile;
  const hasAnyAdditionalSection =
    (p.gpg_keys?.length ?? 0) > 0 ||
    (p.authorized_apps?.length ?? 0) > 0 ||
    (p.owned_apps?.length ?? 0) > 0 ||
    (p.domains?.length ?? 0) > 0 ||
    (p.joined_teams?.length ?? 0) > 0 ||
    !!p.readme;

  return (
    <PublicPage>
      <PublicHeader>
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
          <Text size={300} className={styles.muted}>
            @{p.username}
          </Text>
        </div>
        <Badge appearance="tint" color="informative" icon={<GlobeRegular />}>
          {t("publicProfile.publicProfileBadge")}
        </Badge>
      </PublicHeader>

      {(p.email || p.joined_at) && (
        <div className={styles.facts}>
          {p.email && (
            <PublicField icon={<MailRegular />}>
              <Text style={{ wordBreak: "break-all" }}>{p.email}</Text>
            </PublicField>
          )}
          {p.joined_at && (
            <PublicField icon={<CalendarRegular />}>
              <Text>
                {t("publicProfile.joinedOn", {
                  date: new Date(p.joined_at * 1000).toLocaleDateString(
                    i18n.resolvedLanguage,
                  ),
                })}
              </Text>
            </PublicField>
          )}
        </div>
      )}

      {hasAnyAdditionalSection && <PublicDivider />}

      {p.readme && <ReadmeSection readme={p.readme} />}

      {p.gpg_keys && p.gpg_keys.length > 0 && (
        <PublicSection
          icon={<KeyRegular />}
          title={t("publicProfile.gpgKeysHeading", {
            count: p.gpg_keys.length,
          })}
        >
          <Text size={200} className={styles.muted}>
            <FluentLink
              href={`/users/${encodeURIComponent(p.username)}.gpg`}
              target="_blank"
              rel="noopener"
            >
              {t("publicProfile.gpgKeysDownload")}
            </FluentLink>
            {" · "}
            <span className={styles.fingerprint}>/users/{p.username}.gpg</span>
          </Text>
          {p.gpg_keys.map((k) => (
            <div key={k.fingerprint} className={styles.gpgRow}>
              <div className={styles.gpgName}>
                <Text weight="semibold" style={{ flex: 1, minWidth: 0 }}>
                  {k.name}
                </Text>
                <CopyButton
                  text={k.fingerprint}
                  label={t("publicProfile.copyFingerprint")}
                />
              </div>
              <Text className={styles.fingerprint}>{k.fingerprint}</Text>
            </div>
          ))}
        </PublicSection>
      )}

      {p.owned_apps && p.owned_apps.length > 0 && (
        <PublicSection
          icon={<AppsRegular />}
          title={t("publicProfile.ownedAppsHeading", {
            count: p.owned_apps.length,
          })}
        >
          {p.owned_apps.map((a) => (
            <PublicAppRow
              key={a.client_id}
              name={a.name}
              iconUrl={a.icon_url}
              sub={a.description}
            />
          ))}
        </PublicSection>
      )}

      {p.joined_teams && p.joined_teams.length > 0 && (
        <PublicSection
          icon={<PeopleRegular />}
          title={t("publicProfile.joinedTeamsHeading", {
            count: p.joined_teams.length,
          })}
          wrap
        >
          {p.joined_teams.map((team) => (
            <PublicChip
              key={team.id}
              to={`/t/${encodeURIComponent(team.id)}`}
              name={team.name}
              avatarUrl={team.avatar_url}
              label={<Text size={300}>{team.name}</Text>}
              detail={`· ${team.role}`}
            />
          ))}
        </PublicSection>
      )}

      {p.domains && p.domains.length > 0 && (
        <PublicDomains
          domains={p.domains}
          title={t("publicProfile.domainsHeading", {
            count: p.domains.length,
          })}
        />
      )}

      {p.authorized_apps && p.authorized_apps.length > 0 && (
        <PublicSection
          icon={<PlugConnectedRegular />}
          title={t("publicProfile.authorizedAppsHeading", {
            count: p.authorized_apps.length,
          })}
        >
          {p.authorized_apps.map((a) => (
            <PublicAppRow
              key={a.client_id}
              name={a.name}
              iconUrl={a.icon_url}
              sub={a.website_url}
            />
          ))}
        </PublicSection>
      )}
    </PublicPage>
  );
}

function ReadmeSection({ readme }: { readme: string }) {
  const styles = useStyles();
  const { t } = useTranslation();
  // renderMarkdown is async because every embedded <img> URL is registered
  // with the image proxy before sanitizing. Re-render is rare (only on
  // profile reload), so a stale flash between effect runs is acceptable.
  const [html, setHtml] = useState("");
  useEffect(() => {
    let cancelled = false;
    renderMarkdown(readme).then((rendered) => {
      if (!cancelled) setHtml(rendered);
    });
    return () => {
      cancelled = true;
    };
  }, [readme]);
  return (
    <PublicSection
      icon={<DocumentTextRegular />}
      title={t("publicProfile.readmeHeading")}
    >
      <div
        className={styles.readme}
        // html is the output of marked + DOMPurify with our hardened
        // configuration in lib/markdown.ts; safe to inject.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </PublicSection>
  );
}
