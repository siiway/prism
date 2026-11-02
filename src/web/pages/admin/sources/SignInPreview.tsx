// The sign-in page's provider buttons, as people see them right now: the
// same /api/site list the login page draws, so switching a source on or off
// in the list updates it.

import { Divider, Text, makeStyles, tokens } from "@fluentui/react-components";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useApi } from "../../../lib/api-context";
import { ProviderButton } from "../../../components/ProviderButton";

const useStyles = makeStyles({
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    padding: "16px",
    borderRadius: tokens.borderRadiusXLarge,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground1,
  },
  head: { display: "flex", flexDirection: "column", gap: "2px" },
  title: { fontWeight: tokens.fontWeightSemibold },
  muted: { color: tokens.colorNeutralForeground3 },
  // A slice of the sign-in card.
  stage: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    padding: "16px",
    borderRadius: tokens.borderRadiusLarge,
    background: tokens.colorNeutralBackground2,
  },
  buttons: { display: "flex", flexDirection: "column", gap: "8px" },
  empty: {
    color: tokens.colorNeutralForeground3,
    textAlign: "center",
    paddingTop: "8px",
    paddingBottom: "8px",
  },
});

export function SignInPreview({ className }: { className?: string }) {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const { data: site } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });
  const providers = site?.enabled_providers ?? [];

  return (
    <aside className={className}>
      <div className={styles.panel}>
        <div className={styles.head}>
          <Text className={styles.title}>{t("admin.oauthSignInPreview")}</Text>
          <Text size={200} className={styles.muted}>
            {t("admin.oauthSignInPreviewDesc")}
          </Text>
        </div>
        <div className={styles.stage}>
          {providers.length === 0 ? (
            <Text size={200} className={styles.empty}>
              {site ? t("admin.oauthNoneOffered") : t("common.loading")}
            </Text>
          ) : (
            <>
              <Divider>{t("auth.orContinueWith")}</Divider>
              {/* A picture of the buttons: not focusable, not announced. */}
              <div className={styles.buttons} inert aria-hidden>
                {providers.map((p) => (
                  <ProviderButton
                    key={p.slug}
                    provider={p}
                    onClick={() => {}}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
