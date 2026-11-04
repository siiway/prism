// Other apps' permissions on a consent screen (OAuth and SAML): each with
// the title and description its app gave it, or a generic line without one.

import { Text, makeStyles, tokens } from "@fluentui/react-components";
import { PlugConnectedRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import type { OAuthAuthorizeInfo } from "../../shared/api";

const useStyles = makeStyles({
  heading: { color: tokens.colorNeutralForeground3, marginBottom: "8px" },
  list: { display: "flex", flexDirection: "column", gap: "8px" },
  item: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: tokens.fontSizeBase300,
  },
  icon: { color: tokens.colorBrandForeground1, flexShrink: 0 },
  muted: { color: tokens.colorNeutralForeground3 },
  meta: {
    color: tokens.colorNeutralForeground3,
    marginLeft: "6px",
    fontWeight: "normal",
  },
});

export function AppScopeList({
  appName,
  scopes,
}: {
  /** The app asking for them. */
  appName: string;
  scopes: OAuthAuthorizeInfo["app_scopes"];
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  if (scopes.length === 0) return null;
  return (
    <div>
      <Text size={200} weight="semibold" block className={styles.heading}>
        {t("oauth.appPermissionsHeading")}
      </Text>
      <div className={styles.list}>
        {scopes.map((as) => (
          <div key={as.scope} className={styles.item}>
            <PlugConnectedRegular className={styles.icon} />
            <div>
              <Text weight="semibold" block size={300}>
                {as.scope_title ?? as.app_name}
                <Text size={200} className={styles.meta}>
                  · {as.app_name} · {as.inner_scope}
                </Text>
              </Text>
              <Text size={200} className={styles.muted}>
                {as.scope_desc ??
                  t("oauth.appPermissionDesc", {
                    appName,
                    targetApp: as.app_name,
                    scope: as.inner_scope,
                  })}
              </Text>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
