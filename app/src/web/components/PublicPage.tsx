// The building blocks of the public profile pages (/u/:username and
// /t/:id): one centered card with a header, facts, and titled sections.

import {
  Avatar,
  Badge,
  Spinner,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { EarthRegular, ShieldRegular } from "@fluentui/react-icons";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ApiError } from "../lib/api";
import { apiErrorText } from "../lib/apiError";

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
  section: { display: "flex", flexDirection: "column", gap: "8px" },
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
  wrap: { display: "flex", flexWrap: "wrap", gap: "8px" },
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
  muted: { color: tokens.colorNeutralForeground3 },
  ellipsis: {
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  chip: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 10px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "6px",
    textDecorationLine: "none",
    color: "inherit",
    background: tokens.colorNeutralBackground3,
  },
});

/** The centered card every public page sits in. */
export function PublicPage({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return (
    <div className={styles.page}>
      <div className={styles.card}>{children}</div>
    </div>
  );
}

/** Loading, or why the page can't be shown. `ns` holds the notFound* and
 *  error* strings. */
export function PublicPageFallback({
  error,
  ns,
}: {
  error: unknown;
  ns: "publicProfile" | "publicTeam";
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  if (!error)
    return (
      <div className={styles.page}>
        <Spinner size="large" />
      </div>
    );
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <PublicPage>
      <Title2>
        {notFound ? t(`${ns}.notFoundTitle`) : t(`${ns}.errorTitle`)}
      </Title2>
      <Text className={styles.muted}>
        {notFound
          ? t(`${ns}.notFoundDesc`)
          : apiErrorText(error, t(`${ns}.errorDesc`))}
      </Text>
    </PublicPage>
  );
}

export function PublicHeader({ children }: { children: ReactNode }) {
  return <div className={useStyles().header}>{children}</div>;
}

/** An icon and a line of text: a join date, an owner, a count. */
export function PublicField({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={useStyles().field}>
      {icon}
      {children}
    </div>
  );
}

export function PublicDivider() {
  return <div className={useStyles().divider} />;
}

/** A titled section. `wrap` lays the children out as a wrapping row. */
export function PublicSection({
  icon,
  title,
  wrap,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  wrap?: boolean;
  children: ReactNode;
}) {
  const styles = useStyles();
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>
        {icon}
        {title}
      </div>
      {wrap ? <div className={styles.wrap}>{children}</div> : children}
    </div>
  );
}

/** An app: its icon, name and one muted line. */
export function PublicAppRow({
  name,
  iconUrl,
  sub,
}: {
  name: string;
  iconUrl: string | null;
  sub?: string | null;
}) {
  const styles = useStyles();
  return (
    <div className={styles.appRow}>
      <Avatar
        image={iconUrl ? { src: iconUrl } : undefined}
        name={name}
        size={32}
        shape="square"
      />
      <div className={styles.appInfo}>
        <Text weight="semibold" block>
          {name}
        </Text>
        {sub && (
          <Text
            size={200}
            block
            className={`${styles.muted} ${styles.ellipsis}`}
          >
            {sub}
          </Text>
        )}
      </div>
    </div>
  );
}

/** A link to a person or team: small avatar, name, muted detail. */
export function PublicChip({
  to,
  name,
  avatarUrl,
  label,
  detail,
}: {
  to: string;
  name: string;
  avatarUrl: string | null;
  label: ReactNode;
  detail: ReactNode;
}) {
  const styles = useStyles();
  return (
    <Link to={to} className={styles.chip}>
      <Avatar
        name={name}
        image={avatarUrl ? { src: avatarUrl } : undefined}
        size={20}
      />
      {label}
      <Text size={100} className={styles.muted}>
        {detail}
      </Text>
    </Link>
  );
}

/** The verified domains section. */
export function PublicDomains({
  domains,
  title,
}: {
  domains: Array<{ domain: string }>;
  title: ReactNode;
}) {
  return (
    <PublicSection icon={<EarthRegular />} title={title} wrap>
      {domains.map((d) => (
        <Badge
          key={d.domain}
          appearance="tint"
          color="success"
          icon={<ShieldRegular />}
        >
          {d.domain}
        </Badge>
      ))}
    </PublicSection>
  );
}
