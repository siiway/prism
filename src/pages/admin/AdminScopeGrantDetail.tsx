// One scope grant (/admin/scope-grants/:kind/:id): which app holds it, for
// which account or team, exactly what it can do, and how many live tokens
// carry it. Revoking takes the scopes out of the app's approvals and deletes
// those tokens, so the app has to ask again.

import {
  Badge,
  Button,
  MessageBar,
  Spinner,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { ArrowLeftRegular, DeleteRegular } from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ScopeGrantKind } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import { apiErrorText } from "../../lib/apiError";
import { formatDate } from "../../lib/datetime";
import { setDocumentPageTitle } from "../../lib/documentTitle";
import { scopeLabel } from "../../lib/scopeLabels";
import { useConfirm } from "../../lib/useConfirm";
import { useToastMessage } from "../../lib/useToastMessage";
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsToast,
} from "../../components/Settings";
import { SkeletonSettingsCard } from "../../components/Skeletons";

const useStyles = makeStyles({
  back: {
    alignSelf: "flex-start",
    marginLeft: "-8px",
    color: tokens.colorNeutralForeground3,
  },
  titles: { display: "flex", flexDirection: "column", gap: "4px" },
  titleLine: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
  },
  muted: { color: tokens.colorNeutralForeground3 },
  mono: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  value: { textAlign: "end", overflowWrap: "anywhere" },
  link: {
    color: tokens.colorBrandForegroundLink,
    textDecorationLine: "none",
    ":hover": { textDecorationLine: "underline" },
  },
  danger: { color: tokens.colorPaletteRedForeground1 },
});

export function AdminScopeGrantDetail() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const params = useParams();
  const kind: ScopeGrantKind = params.kind === "team" ? "team" : "site";
  const id = params.id ?? "";
  const { message, showMsg } = useToastMessage();
  const { confirm, confirmDialog } = useConfirm();
  const [busy, setBusy] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-scope-grant", kind, id],
    queryFn: () => api.adminGetScopeGrant(kind, id),
    retry: false,
  });
  const grant = data?.grant;
  const appName = grant?.app_name ?? t("admin.unknownApp");

  useEffect(() => {
    if (!grant) return;
    setDocumentPageTitle(appName);
    return () => setDocumentPageTitle(null);
  }, [grant, appName]);

  const listPath =
    kind === "team" ? "/admin/scope-grants?view=team" : "/admin/scope-grants";
  const back = (
    <Button
      appearance="subtle"
      size="small"
      icon={<ArrowLeftRegular />}
      className={styles.back}
      onClick={() => navigate(listPath)}
    >
      {t("admin.scopeGrantsTab")}
    </Button>
  );

  if (isLoading)
    return (
      <SettingsPage>
        {back}
        <SkeletonSettingsCard rows={4} />
      </SettingsPage>
    );
  if (error || !grant)
    return (
      <SettingsPage>
        {back}
        <MessageBar intent="error">
          {apiErrorText(t, error, t("apiErrors.scope_grant_not_found"))}
        </MessageBar>
      </SettingsPage>
    );

  const held = grant.held_scopes.length > 0;
  // What it can do now; once nothing is held, what it was approved for.
  const scopes = held ? grant.held_scopes : grant.listed;

  const revoke = async () => {
    const ok = await confirm({
      title: t("admin.revokeGrantTitle"),
      body: t("admin.revokeGrantBody", {
        app: appName,
        count: grant.live_tokens,
      }),
      confirmLabel: t("common.revoke"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.adminRevokeScopeGrant(kind, id);
      await qc.invalidateQueries({ queryKey: ["admin-scope-grants"] });
      qc.removeQueries({ queryKey: ["admin-scope-grant", kind, id] });
      navigate(listPath, { replace: true, state: { revoked: appName } });
    } catch (err) {
      showMsg("error", apiErrorText(t, err, t("admin.revokeGrantFailed")));
      setBusy(false);
    }
  };

  const user = (userId?: string | null, username?: string | null) =>
    userId ? (
      <Link to={`/admin/users/${userId}`} className={styles.link}>
        {username ? `@${username}` : userId}
      </Link>
    ) : (
      "—"
    );

  return (
    <SettingsPage>
      {back}
      <div className={styles.titles}>
        <div className={styles.titleLine}>
          <Title2 as="h1">{appName}</Title2>
          <Badge
            appearance="tint"
            color={kind === "site" ? "danger" : "informative"}
          >
            {kind === "site"
              ? t("admin.siteGrantBadge")
              : t("admin.teamGrantBadge")}
          </Badge>
          {!held && (
            <Badge appearance="tint" color="subtle">
              {t("admin.grantNotHeld")}
            </Badge>
          )}
        </div>
        <Text className={styles.mono}>{grant.client_id}</Text>
      </div>

      <SettingsToast message={message} />

      <SettingsCard
        id="grant"
        title={t("admin.grantDetailsTitle")}
        description={
          kind === "site" ? t("admin.siteGrantDesc") : t("admin.teamGrantDesc")
        }
      >
        {kind === "site" ? (
          <SettingsRow
            label={t("admin.grantAccountHeader")}
            description={t("admin.grantAccountDesc")}
          >
            <span className={styles.value}>
              {user(grant.grantee_user_id, grant.grantee_username)}
            </span>
          </SettingsRow>
        ) : (
          <>
            <SettingsRow label={t("admin.teamHeader")}>
              <span className={styles.value}>
                {grant.team_id ? (
                  <Link to={`/teams/${grant.team_id}`} className={styles.link}>
                    {grant.team_name ?? grant.team_id}
                  </Link>
                ) : (
                  "—"
                )}
              </span>
            </SettingsRow>
            <SettingsRow
              label={t("admin.grantedByHeader")}
              description={
                grant.grantor_role
                  ? t("admin.grantorRoleDesc", { role: grant.grantor_role })
                  : t("admin.grantorGoneDesc")
              }
            >
              <span className={styles.value}>
                {user(grant.grantor_user_id, grant.grantor_username)}
              </span>
            </SettingsRow>
          </>
        )}
        <SettingsRow
          label={t("admin.grantedHeader")}
          description={
            grant.times_granted > 1
              ? t("admin.grantTimesDesc", {
                  count: grant.times_granted,
                  date: formatDate(grant.first_granted_at),
                })
              : undefined
          }
        >
          <span className={styles.value}>{formatDate(grant.granted_at)}</span>
        </SettingsRow>
        <SettingsRow
          label={t("admin.grantTokensLabel")}
          description={
            kind === "team"
              ? t("admin.grantAccountsDesc", { count: grant.accounts })
              : t("admin.grantTokensDesc")
          }
        >
          <span className={styles.value}>{grant.live_tokens}</span>
        </SettingsRow>
      </SettingsCard>

      <SettingsCard
        id="scopes"
        title={
          kind === "site"
            ? t("admin.scopesHeader")
            : t("admin.permissionsHeader")
        }
        description={held ? undefined : t("admin.grantNotHeldDesc")}
      >
        {scopes.map((s) => {
          // Team permissions come bare ("member:read"); site scopes have
          // plain-language names.
          const named =
            kind === "site" ? scopeLabel(t, s) : { label: s, desc: undefined };
          return (
            <SettingsRow key={s} label={named.label} description={named.desc}>
              {named.label !== s && <span className={styles.mono}>{s}</span>}
            </SettingsRow>
          );
        })}
      </SettingsCard>

      <SettingsCard id="danger" title={t("admin.grantDangerTitle")}>
        <SettingsRow
          label={t("admin.revokeGrantLabel")}
          description={t("admin.revokeGrantDesc")}
        >
          <Button
            size="small"
            icon={<DeleteRegular />}
            className={styles.danger}
            disabled={busy}
            onClick={() => void revoke()}
          >
            {busy ? <Spinner size="tiny" /> : t("common.revoke")}
          </Button>
        </SettingsRow>
      </SettingsCard>

      {confirmDialog}
    </SettingsPage>
  );
}
