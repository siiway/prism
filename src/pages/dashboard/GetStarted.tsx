// Getting-started view for a brand-new account (no apps, no domains yet),
// modelled on the Cloudflare dashboard's empty account home: one heading and
// a few cards, each with a small line illustration and a single action.

import {
  Button,
  Input,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { ArrowRightRegular } from "@fluentui/react-icons";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AppArt,
  DomainArt,
  LinkArt,
  SecureArt,
} from "../../components/Illustrations";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingTop: "24px",
  },
  title: {
    textAlign: "center",
    marginBottom: "32px",
    letterSpacing: "-0.015em",
  },
  grid: {
    width: "100%",
    maxWidth: "960px",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: "12px",
  },
  card: {
    display: "flex",
    flexDirection: "column",
    padding: "6px",
    borderRadius: tokens.borderRadiusXLarge,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground1,
  },
  art: {
    height: "170px",
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground2,
    overflow: "hidden",
    "& svg": {
      display: "block",
      width: "100%",
      height: "100%",
    },
  },
  body: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "14px 8px 8px",
  },
  desc: {
    color: tokens.colorNeutralForeground3,
    fontSize: "13px",
    lineHeight: "18px",
  },
  action: {
    marginTop: "auto",
    paddingTop: "14px",
  },
});

interface CardProps {
  art: ReactNode;
  title: string;
  desc: string;
  action: ReactNode;
}

function Card({ art, title, desc, action }: CardProps) {
  const styles = useStyles();
  return (
    <div className={styles.card}>
      <div className={styles.art}>{art}</div>
      <div className={styles.body}>
        <Text weight="semibold">{title}</Text>
        <span className={styles.desc}>{desc}</span>
        <div className={styles.action}>{action}</div>
      </div>
    </div>
  );
}

interface GetStartedProps {
  siteName: string;
  /** Whether the account may create apps / domains (restricted accounts may not). */
  canCreateApp: boolean;
  canAddDomain: boolean;
  /** A second factor (TOTP or passkey) is already set up. */
  secured: boolean;
}

export function GetStarted({
  siteName,
  canCreateApp,
  canAddDomain,
  secured,
}: GetStartedProps) {
  const styles = useStyles();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [domain, setDomain] = useState("");

  const submitDomain = () => {
    const value = domain.trim();
    if (!value) return;
    navigate("/domains", { state: { newDomain: value } });
  };

  return (
    <div className={styles.root}>
      <Text as="h1" size={800} weight="semibold" className={styles.title}>
        {t("dashboard.getStarted.title")}
      </Text>
      <div className={styles.grid}>
        {canCreateApp && (
          <Card
            art={<AppArt />}
            title={t("dashboard.getStarted.appTitle")}
            desc={t("dashboard.getStarted.appDesc", { siteName })}
            action={
              <Button onClick={() => navigate("/apps/new")}>
                {t("dashboard.getStarted.appAction")}
              </Button>
            }
          />
        )}
        {canAddDomain && (
          <Card
            art={<DomainArt />}
            title={t("dashboard.getStarted.domainTitle")}
            desc={t("dashboard.getStarted.domainDesc")}
            action={
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submitDomain();
                }}
              >
                <Input
                  value={domain}
                  onChange={(_, d) => setDomain(d.value)}
                  placeholder={t("dashboard.getStarted.domainPlaceholder")}
                  style={{ width: "100%" }}
                  contentAfter={
                    <Button
                      type="submit"
                      appearance="transparent"
                      size="small"
                      icon={<ArrowRightRegular />}
                      disabled={!domain.trim()}
                      aria-label={t("dashboard.getStarted.domainAction")}
                    />
                  }
                />
              </form>
            }
          />
        )}
        {secured ? (
          <Card
            art={<LinkArt />}
            title={t("dashboard.getStarted.linkTitle")}
            desc={t("dashboard.getStarted.linkDesc")}
            action={
              <Button onClick={() => navigate("/connections")}>
                {t("dashboard.getStarted.linkAction")}
              </Button>
            }
          />
        ) : (
          <Card
            art={<SecureArt />}
            title={t("dashboard.getStarted.secureTitle")}
            desc={t("dashboard.getStarted.secureDesc")}
            action={
              <Button onClick={() => navigate("/security")}>
                {t("dashboard.getStarted.secureAction")}
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}
