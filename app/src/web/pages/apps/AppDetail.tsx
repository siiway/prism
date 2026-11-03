// OAuth app detail page: a header, tabs of settings cards, and the
// form state they share. Each card saves its own section (see detail/shared).

import {
  Avatar,
  Badge,
  Button,
  Tab,
  TabList,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { OpenRegular, ShieldCheckmarkRegular } from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiErrorText } from "../../lib/apiError";
import { useApi } from "../../lib/api-context";
import { setDocumentPageTitle } from "../../lib/documentTitle";
import { useToastMessage } from "../../lib/useToastMessage";
import { SettingsPage, SettingsToast } from "../../components/Settings";
import { ViewBanner } from "../../components/ViewBanner";
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
import { OAuthTab } from "./detail/OAuthTab";
import { PermissionsTab } from "./detail/PermissionsTab";
import { AccessTab } from "./detail/AccessTab";
import { SamlTab } from "./detail/SamlTab";
import { ModerationTab } from "./detail/ModerationTab";
import { BackButton, DetailHeader } from "../../components/DetailHeader";

const TABS = [
  "overview",
  "oauth",
  "saml",
  "permissions",
  "access",
  "moderation",
] as const;
type TabId = (typeof TABS)[number];

// Card anchors, so /apps/:id#scopes opens the tab that holds the card.
const CARD_TAB: Record<string, TabId> = {
  credentials: "oauth",
  endpoints: "oauth",
  details: "overview",
  ownership: "overview",
  delete: "overview",
  redirects: "oauth",
  "sign-out": "oauth",
  "client-auth": "oauth",
  scopes: "permissions",
  "scope-definitions": "permissions",
  "scope-access": "permissions",
  access: "access",
  saml: "saml",
  "saml-idp": "saml",
  "saml-attributes": "saml",
};

const useStyles = makeStyles({
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
  // ?tab=sign-in is what the OAuth tab used to be called.
  const rawTab = params.get("tab");
  const paramTab = (rawTab === "sign-in" ? "oauth" : rawTab) as TabId | null;
  // Opened from the admin app list: back leads there.
  const fromAdmin =
    (location.state as { from?: string } | null)?.from === "admin-apps";
  // Moderation is for site admins in admin view only.
  const canModerate = isSiteAdmin && !normalView;
  const requested =
    hashTab ?? (paramTab && TABS.includes(paramTab) ? paramTab : "overview");
  const tab: TabId =
    requested === "moderation" && !canModerate ? "overview" : requested;
  const selectTab = (next: TabId) => {
    const p = new URLSearchParams(params);
    if (next === "overview") p.delete("tab");
    else p.set("tab", next);
    // Drop a card anchor from another tab, or it would pull the tab back.
    // Keep router state (where the page was opened from) across tabs.
    navigate(
      { search: p.toString() ? `?${p}` : "" },
      { replace: true, state: location.state },
    );
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
  const [saving, setSaving] = useState<Section | "switch" | null>(null);

  if (isLoading) return <SkeletonSettingsPage cards={[2, 5, 4]} />;

  if (!app) {
    // An admin who dropped the override sees a 404 for apps they don't own;
    // offer the way back rather than a dead end.
    if (isSiteAdmin && normalView)
      return (
        <ViewBanner
          intent="info"
          action={{
            label: t("teams.normalViewSwitchBack"),
            onClick: () => setView(false),
          }}
        >
          {t("apps.normalViewNotOwner")}
        </ViewBanner>
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
      // One save at a time (every footer disables while one is in flight):
      // the server rewrites the whole app row from what it read, so two
      // overlapping saves could quietly undo each other.
      if (saving) return;
      setSaving(section);
      // What was sent, so edits typed while the request is in flight
      // survive it instead of being cleared along with the saved ones.
      const sent = new Map(
        sectionFields(section).map((k) => [k, JSON.stringify(form[k])]),
      );
      try {
        await api.updateApp(app.id, payloadFor(section, form));
        await qc.invalidateQueries({ queryKey: ["app", app.id] });
        await qc.invalidateQueries({ queryKey: ["apps"] });
        setEdits((e) => {
          const next = { ...e };
          for (const [k, value] of sent)
            if (k in next && JSON.stringify(next[k]) === value) delete next[k];
          return next;
        });
        showMsg("success", t("apps.appUpdated"));
      } catch (err) {
        showMsg("error", apiErrorText(err, t("common.saveFailed")));
      } finally {
        setSaving(null);
      }
    },
    discard,
    exclusive: async (run) => {
      if (saving) return;
      setSaving("switch");
      try {
        await run();
      } finally {
        setSaving(null);
      }
    },
  };

  return (
    <SettingsPage>
      <BackButton
        to={
          fromAdmin
            ? "/admin/apps"
            : app.team_id
              ? `/teams/${app.team_id}`
              : "/apps"
        }
      >
        {fromAdmin
          ? t("admin.applicationsTab")
          : app.team_id
            ? (app.team_name ?? t("apps.team"))
            : t("apps.myApplications")}
      </BackButton>

      <DetailHeader
        icon={
          <Avatar
            image={app.icon_url ? { src: app.icon_url } : undefined}
            name={app.name}
            size={48}
            shape="square"
          />
        }
        title={app.name}
        badges={
          <>
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
          </>
        }
        subtitle={app.description}
        actions={
          app.website_url && (
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
          )
        }
      />

      {isSiteAdmin && !normalView && !adminBannerDismissed && (
        <ViewBanner
          intent="warning"
          onDismiss={dismissAdminBanner}
          action={{
            label: t("teams.siteAdminSwitchToNormal"),
            onClick: () => setView(true),
          }}
        >
          {t("apps.siteAdminViewActive")}
        </ViewBanner>
      )}
      {isSiteAdmin && normalView && !normalBannerDismissed && (
        <ViewBanner
          intent="info"
          onDismiss={dismissNormalBanner}
          action={{
            label: t("teams.normalViewSwitchBack"),
            onClick: () => setView(false),
          }}
        >
          {t("apps.memberViewActive")}
        </ViewBanner>
      )}

      <div className={styles.tabBar}>
        <TabList
          className={styles.tabs}
          selectedValue={tab}
          onTabSelect={(_, d) => selectTab(d.value as TabId)}
        >
          <Tab value="overview">{t("apps.tabOverview")}</Tab>
          <Tab value="oauth">{t("apps.tabOAuth")}</Tab>
          <Tab value="saml">{t("apps.tabSaml")}</Tab>
          <Tab value="permissions">{t("apps.permissionsTab")}</Tab>
          <Tab value="access">{t("apps.tabAccess")}</Tab>
          {canModerate && (
            <Tab value="moderation">{t("apps.moderation.tab")}</Tab>
          )}
        </TabList>
      </div>

      <SettingsToast message={message} />

      {tab === "overview" && (
        <OverviewTab app={app} formApi={formApi} showMsg={showMsg} />
      )}
      {tab === "oauth" && (
        <OAuthTab
          app={app}
          formApi={formApi}
          newSecret={newSecret}
          setNewSecret={setNewSecret}
          showMsg={showMsg}
        />
      )}
      {tab === "saml" && <SamlTab app={app} showMsg={showMsg} />}
      {tab === "permissions" && (
        <PermissionsTab app={app} formApi={formApi} showMsg={showMsg} />
      )}
      {tab === "access" && (
        <AccessTab app={app} formApi={formApi} showMsg={showMsg} />
      )}
      {tab === "moderation" && (
        <ModerationTab app={app} formApi={formApi} showMsg={showMsg} />
      )}
    </SettingsPage>
  );
}
