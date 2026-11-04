// The two in-between states of browser flows that hand off to another site
// (SAML sign-in, sign-out through SAML apps): a full-page spinner while the
// browser is on its way, and the card shown when the flow can't go on.

import {
  Spinner,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { DismissCircleRegular } from "@fluentui/react-icons";
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
  center: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    alignItems: "center",
    textAlign: "center",
  },
  muted: { color: tokens.colorNeutralForeground3 },
});

/** A full-page spinner, with what's happening when known. */
export function AuthWaiting({ text }: { text?: string }) {
  const styles = useStyles();
  return (
    <div className={styles.page}>
      <div className={styles.center}>
        <Spinner size="large" />
        {text && <Text className={styles.muted}>{text}</Text>}
      </div>
    </div>
  );
}

/** Why the flow stopped. */
export function AuthFailure({ title, text }: { title: string; text: string }) {
  const styles = useStyles();
  return (
    <AuthShell maxWidth={440} cardGap={24}>
      <div className={styles.center}>
        <DismissCircleRegular
          fontSize={48}
          style={{ color: tokens.colorPaletteRedForeground1 }}
        />
        <Title2>{title}</Title2>
        <Text>{text}</Text>
      </div>
    </AuthShell>
  );
}
