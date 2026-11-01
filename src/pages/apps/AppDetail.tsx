// OAuth app detail page: a header, four tabs of settings cards, and the
// form state they share. Each card saves its own section (see detail/shared).

import {
  Avatar,
  Badge,
  Button,
  MessageBar,
  Tab,
  TabList,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowLeftRegular,
  DismissRegular,
  OpenRegular,
  ShieldCheckmarkRegular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import { setDocumentPageTitle } from "../../lib/documentTitle";
import { useToastMessage } from "../../lib/useToastMessage";
import { SettingsPage, SettingsToast } from "../../components/Settings";
import { SkeletonSettingsPage } from "../../components/Skeletons";
import { useAuthStore } from "../../store/auth";
import { useAdminViewStore } from "../../store/adminView";
import {
  formFromApp,
  payloadFor,
  sectionFields,
  type AppForm,
  type AppFormApi,
  type Section,
} from "./detail/form";
import { OverviewTab } from "./detail/OverviewTab";
import { SignInTab } from "./detail/SignInTab";
import { PermissionsTab } from "./detail/PermissionsTab";
import { AccessTab } from "./detail/AccessTab";

const TABS = ["overview", "sign-in", "permissions", "access"] as const;
type TabId = (typeof TABS)[number];

// Card anchors, so /apps/:id#scopes opens the tab that holds the card.
const CARD_TAB: Record<string, TabId> = {
  credentials: "overview",
  endpoints: "overview",
  details: "overview",
  ownership: "overview",
  delete: "overview",
  redirects: "sign-in",
  "sign-out": "sign-in",
  scopes: "sign-in",
  "client-auth": "sign-in",
  "scope-definitions": "permissions",
  "scope-access": "permissions",
  access: "access",
};

const useStyles = makeStyles({
  back: {
    alignSelf: "flex-start",
    marginLeft: "-8px",
    color: tokens.colorNeutralForeground3,
  },
  header: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "16px",
  },
  titles: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    flex: "1 1 240px",
    minWidth: 0,
  },
  titleLine: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "8px",
  },
  title: {
    letterSpacing: "-0.015em",
    overflowWrap: "anywhere",
  },
  muted: { color: tokens.colorNeutralForeground3 },
  banner: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "8px 12px",
  },
  bannerClose: { marginLeft: "auto" },
  tabBar: {
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  // Line the first tab label up with the content edge.
  tabs: { marginLeft: "-10px" },
});

export function AppDetail() {
  const api = useApi();
  const styles = useStyles();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { message, showMsg } = useToastMessage();
  const isSiteAdmin = useAuthStore((state) => state.user?.role === "admin");
  const {
    normalView,
    setNormalView,
    normalBannerDismissed,
    dismissNormalBanner,
    adminBannerDismissed,
    dismissAdminBanner,
  } = useAdminViewStore();

  const setView = (normal: boolean) => {
    setNormalView(normal);
    void qc.invalidateQueries();
  };

  const { data, isLoading } = useQuery({
    queryKey: ["app", id, normalView],
    queryFn: () => api.getApp(id!),
    enabled: !!id,
  });
  const app = data?.app;

  // ── Tabs ───────────────────────────────────────────────────────────────────
  const hashTab = CARD_TAB[location.hash.slice(1)];
  const paramTab = params.get("tab") as TabId | null;
  const tab: TabId =
    hashTab ?? (paramTab && TABS.includes(paramTab) ? paramTab : "overview");
  const selectTab = (next: TabId) => {
    const p = new URLSearchParams(params);
    if (next === "overview") p.delete("tab");
    else p.set("tab", next);
    // Drop a card anchor from another tab, or it would pull the tab back.
    navigate({ search: p.toString() ? `?${p}` : "" }, { replace: true });
  };

  // ── One-time secret ────────────────────────────────────────────────────────
  // Creation hands over the plaintext secret once through router state. Keep
  // it in component state and wipe it from history so Back can't show it.
  const createdSecret = (() => {
    const value = (location.state as { clientSecret?: unknown } | null)
      ?.clientSecret;
    return typeof value === "string" ? value : "";
  })();
  const [newSecret, setNewSecret] = useState(createdSecret);
  useEffect(() => {
    if (!createdSecret) return;
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: null,
    });
  }, [
    createdSecret,
    location.hash,
    location.pathname,
    location.search,
    navigate,
  ]);

  useEffect(() => {
    if (!app?.name) return;
    setDocumentPageTitle(app.name);
    return () => setDocumentPageTitle(null);
  }, [app?.name]);

  // ── Form: unsaved edits over the server copy ───────────────────────────────
  const [edits, setEdits] = useState<Partial<AppForm>>({});
  const [saving, setSaving] = useState<Section | null>(null);

  if (isLoading) return <SkeletonSettingsPage cards={[2, 5, 4]} />;

  if (!app) {
    // An admin who dropped the override sees a 404 for apps they don't own;
    // offer the way back rather than a dead end.
    if (isSiteAdmin && normalView)
      return (
        <MessageBar intent="info">
          <div className={styles.banner}>
            <span>{t("apps.normalViewNotOwner")}</span>
            <Button size="small" onClick={() => setView(false)}>
              {t("teams.normalViewSwitchBack")}
            </Button>
          </div>
        </MessageBar>
      );
    return <Text>{t("apps.appNotFound")}</Text>;
  }

  const base = formFromApp(app);
  const form: AppForm = { ...base, ...edits };
  const discard = (section: Section) =>
    setEdits((e) => {
      const next = { ...e };
      for (const k of sectionFields(section)) delete next[k];
      return next;
    });
  const formApi: AppFormApi = {
    form,
    set: (key, value) => setEdits((e) => ({ ...e, [key]: value })),
    dirty: (section) =>
      JSON.stringify(payloadFor(section, form)) !==
      JSON.stringify(payloadFor(section, base)),
    saving,
    save: async (section) => {
      setSaving(section);
      try {
        await api.updateApp(app.id, payloadFor(section, form));
        await qc.invalidateQueries({ queryKey: ["app", app.id] });
        await qc.invalidateQueries({ queryKey: ["apps"] });
        discard(section);
        showMsg("success", t("apps.appUpdated"));
      } catch (err) {
        showMsg(
          "error",
          err instanceof ApiError ? err.message : t("common.saveFailed"),
        );
      } finally {
        setSaving(null);
      }
    },
    discard,
  };

  return (
    <SettingsPage>
      <Button
        appearance="subtle"
        size="small"
        icon={<ArrowLeftRegular />}
        className={styles.back}
        onClick={() =>
          navigate(app.team_id ? `/teams/${app.team_id}` : "/apps")
        }
      >
        {app.team_id
          ? (app.team_name ?? t("apps.team"))
          : t("apps.myApplications")}
      </Button>

      <div className={styles.header}>
        <Avatar
          image={app.icon_url ? { src: app.icon_url } : undefined}
          name={app.name}
          size={48}
          shape="square"
        />
        <div className={styles.titles}>
          <div className={styles.titleLine}>
            <Title2 as="h1" className={styles.title}>
              {app.name}
            </Title2>
            {app.is_verified && (
              <Badge
                appearance="tint"
                color="success"
                icon={<ShieldCheckmarkRegular />}
              >
                {t("apps.verified")}
              </Badge>
            )}
            {!app.is_active && (
              <Badge appearance="tint" color="danger">
                {t("apps.disabled")}
              </Badge>
            )}
            <Badge appearance="outline" color="informative">
              {app.is_public
                ? t("apps.typePublic")
                : t("apps.typeConfidential")}
            </Badge>
          </div>
          {app.description && (
            <Text className={styles.muted}>{app.description}</Text>
          )}
        </div>
        {app.website_url && (
          <Button
            as="a"
            href={app.website_url}
            target="_blank"
            rel="noreferrer"
            size="small"
            icon={<OpenRegular />}
          >
            {t("apps.openWebsite")}
          </Button>
        )}
      </div>

      {isSiteAdmin && !normalView && !adminBannerDismissed && (
        <MessageBar intent="warning">
          <div className={styles.banner}>
            <span>{t("apps.siteAdminViewActive")}</span>
            <Button size="small" onClick={() => setView(true)}>
              {t("teams.siteAdminSwitchToNormal")}
            </Button>
            <Button
              appearance="subtle"
              size="small"
              icon={<DismissRegular />}
              aria-label={t("common.close")}
              onClick={dismissAdminBanner}
              className={styles.bannerClose}
            />
          </div>
        </MessageBar>
      )}
      {isSiteAdmin && normalView && !normalBannerDismissed && (
        <MessageBar intent="info">
          <div className={styles.banner}>
            <span>{t("apps.memberViewActive")}</span>
            <Button size="small" onClick={() => setView(false)}>
              {t("teams.normalViewSwitchBack")}
            </Button>
            <Button
              appearance="subtle"
              size="small"
              icon={<DismissRegular />}
              aria-label={t("common.close")}
              onClick={dismissNormalBanner}
              className={styles.bannerClose}
            />
          </div>
        </MessageBar>
      )}

      <div className={styles.tabBar}>
        <TabList
          className={styles.tabs}
          selectedValue={tab}
          onTabSelect={(_, d) => selectTab(d.value as TabId)}
        >
          <Tab value="overview">{t("apps.tabOverview")}</Tab>
          <Tab value="sign-in">{t("apps.tabSignIn")}</Tab>
          <Tab value="permissions">{t("apps.permissionsTab")}</Tab>
          <Tab value="access">{t("apps.tabAccess")}</Tab>
        </TabList>
      </div>

      <SettingsToast message={message} />

      {tab === "overview" && (
        <OverviewTab
          app={app}
          formApi={formApi}
          newSecret={newSecret}
          setNewSecret={setNewSecret}
          showMsg={showMsg}
        />
      )}
      {tab === "sign-in" && <SignInTab formApi={formApi} />}
      {tab === "permissions" && <PermissionsTab app={app} showMsg={showMsg} />}
      {tab === "access" && <AccessTab app={app} showMsg={showMsg} />}
    </SettingsPage>
  );
}
