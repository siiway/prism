// Shared shell for auth-flow pages (login, register, init, OAuth consent,
// step-up 2FA). Modelled on the Cloudflare dashboard sign-in: no card, just
// the brand top-left and a narrow form column on a plain page, with legal
// links at the foot. One place owns this so the flows stay identical.
//
// --auth-card-pad is kept (at 0) for children that bleed to the column
// edges with `margin: 0 calc(-1 * var(--auth-card-pad))`, e.g. the consent
// screen's dividers; without a card there is no padding to bleed past.

import { Text, makeStyles } from "@fluentui/react-components";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api-context";
import { BrandMark } from "./BrandMark";
import { NoticeBoard } from "./NoticeBoard";
import { LegalFooter } from "./LegalFooter";

const useStyles = makeStyles({
  page: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
    background: "var(--prism-canvas)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    minHeight: "64px",
    padding: "0 32px",
    "@media (max-width: 480px)": {
      padding: "0 20px",
    },
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "20px",
    padding: "8vh 20px 48px",
    "@media (max-width: 480px)": {
      paddingTop: "24px",
    },
  },
  column: {
    "--auth-card-pad": "0px",
    width: "100%",
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
  },
  footer: {
    padding: "0 20px 16px",
  },
});

interface AuthShellProps {
  children: ReactNode;
  /** Column max width in px. Defaults to 400 (forms); consent screens use 440. */
  maxWidth?: number;
  /** Vertical gap between column children in px. Defaults to 20. */
  cardGap?: number;
  /** Hide the brand header (e.g. while branding is unknown). */
  hideBrand?: boolean;
}

export function AuthShell({
  children,
  maxWidth = 400,
  cardGap = 20,
  hideBrand,
}: AuthShellProps) {
  const api = useApi();
  const styles = useStyles();
  const { data: site } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        {!hideBrand && site && (
          <>
            <BrandMark name={site.site_name} iconUrl={site.site_icon_url} />
            <Text weight="semibold" size={400}>
              {site.site_name}
            </Text>
          </>
        )}
      </header>
      <main className={styles.main}>
        {/* Public notices, above the form. "Maintenance at 02:00" is most
            useful to the person who cannot sign in, so it belongs here and
            not only behind the login. */}
        <div style={{ width: "100%", maxWidth }}>
          <NoticeBoard />
        </div>
        <div className={styles.column} style={{ maxWidth, gap: cardGap }}>
          {children}
        </div>
      </main>
      <div className={styles.footer}>
        <LegalFooter />
      </div>
    </div>
  );
}
