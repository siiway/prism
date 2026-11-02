// Pieces of the pages a social sign-in passes through after the provider
// callback (create an account, pick one of several linked accounts, enter a
// 2FA code). Each loads a short-lived pending state by its key.

import {
  Avatar,
  Button,
  MessageBar,
  Spinner,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type { FormEvent, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AuthShell } from "./AuthShell";

const useStyles = makeStyles({
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: tokens.colorNeutralBackground1,
    padding: "16px",
    boxSizing: "border-box",
  },
  muted: { color: tokens.colorNeutralForeground3 },
  subtitle: { color: tokens.colorNeutralForeground3, marginTop: "8px" },
  header: { textAlign: "center" },
  avatar: { alignSelf: "center" },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    width: "100%",
  },
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    width: "100%",
  },
});

/** The card all three pages sit in. */
export function SocialShell({ children }: { children: ReactNode }) {
  return (
    <AuthShell maxWidth={420} cardGap={24}>
      {children}
    </AuthShell>
  );
}

/** A spinner while the pending state loads; once it failed (expired, or
 *  already used), the way back to the sign-in page. */
export function SocialPendingFallback({ expired }: { expired: boolean }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const navigate = useNavigate();
  if (!expired)
    return (
      <div className={styles.page}>
        <Spinner size="large" />
      </div>
    );
  return (
    <SocialShell>
      <Title2>{t("auth.sessionExpired")}</Title2>
      <Text className={styles.muted}>{t("auth.sessionExpiredText")}</Text>
      <Button appearance="primary" onClick={() => navigate("/login")}>
        {t("auth.backToLogin")}
      </Button>
    </SocialShell>
  );
}

/** Title and explanation, under the account's picture when there is one. */
export function SocialHeader({
  avatar,
  title,
  subtitle,
  centered = true,
}: {
  avatar?: { name: string; url: string | null };
  title: string;
  subtitle: string;
  centered?: boolean;
}) {
  const styles = useStyles();
  return (
    <>
      {avatar && (
        <Avatar
          image={avatar.url ? { src: avatar.url } : undefined}
          name={avatar.name}
          size={64}
          className={styles.avatar}
        />
      )}
      <div className={centered ? styles.header : undefined}>
        <Title2>{title}</Title2>
        <Text block className={styles.subtitle}>
          {subtitle}
        </Text>
      </div>
    </>
  );
}

export function SocialError({ error }: { error: string }) {
  if (!error) return null;
  return (
    <MessageBar intent="error" style={{ width: "100%" }}>
      {error}
    </MessageBar>
  );
}

/** A social page's form: its fields, then submit and "back to sign in". */
export function SocialForm({
  onSubmit,
  submitting,
  canSubmit,
  label,
  busyLabel,
  children,
}: {
  onSubmit: () => void;
  submitting: boolean;
  canSubmit: boolean;
  label: string;
  busyLabel: string;
  children: ReactNode;
}) {
  const styles = useStyles();
  return (
    <form
      className={styles.form}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
      <div className={styles.actions}>
        <Button
          appearance="primary"
          type="submit"
          disabled={submitting || !canSubmit}
          icon={submitting ? <Spinner size="tiny" /> : undefined}
        >
          {submitting ? busyLabel : label}
        </Button>
        <BackToLogin />
      </div>
    </form>
  );
}

export function BackToLogin() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Button appearance="subtle" onClick={() => navigate("/login")}>
      {t("auth.backToLogin")}
    </Button>
  );
}
