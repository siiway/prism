// Connected apps: the OAuth apps you've approved. One bordered list, a row
// per app; a row opens in place to show what the app can do, where it's
// signed in, and the controls to cut it off.

import {
  Avatar,
  Badge,
  Button,
  Input,
  Skeleton,
  SkeletonItem,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowSyncRegular,
  CheckmarkRegular,
  ChevronDownRegular,
  ClockRegular,
  CopyRegular,
  DismissRegular,
  FlashRegular,
  GlobeRegular,
  OpenRegular,
  SearchRegular,
  WarningRegular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { type OAuthConsent, type OAuthToken } from "../lib/api";
import { apiErrorText } from "../lib/apiError";
import { useApi } from "../lib/api-context";
import { formatDate } from "../lib/datetime";
import { scopeLabel } from "../lib/scopeLabels";
import { useConfirm } from "../lib/useConfirm";
import { useToastMessage } from "../lib/useToastMessage";
import { CopyIdTrigger } from "../components/CopyIdTrigger";
import { EmptyState } from "../components/EmptyState";
import { GetStartedPanel } from "../components/GetStartedPanel";
import { ConnectedAppsArt } from "../components/Illustrations";
import { PageHeader } from "../components/PageHeader";
import { Pagination } from "../components/Pagination";
import {
  SettingsEmpty,
  SettingsFooter,
  SettingsRow,
  SettingsSubhead,
  SettingsToast,
} from "../components/Settings";

const PAGE_SIZE = 20;
const COLUMNS = "minmax(0, 2.2fr) minmax(0, 2fr) 90px 110px 20px";
const NARROW = "@media (max-width: 768px)";

const useStyles = makeStyles({
  toolbar: {
    display: "flex",
    gap: "8px",
    marginBottom: "12px",
    flexWrap: "wrap",
  },
  list: {
    "--card-pad": "16px",
    borderRadius: tokens.borderRadiusXLarge,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground1,
    overflow: "hidden",
  },
  head: {
    display: "grid",
    gridTemplateColumns: COLUMNS,
    gap: "16px",
    padding: "10px 16px",
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    [NARROW]: { display: "none" },
  },
  item: {
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  // The whole summary line is the expand button.
  row: {
    margin: 0,
    ...shorthands.borderStyle("none"),
    backgroundColor: "transparent",
    fontFamily: "inherit",
    fontSize: "inherit",
    lineHeight: "inherit",
    color: "inherit",
    textAlign: "start",
    boxSizing: "border-box",
    width: "100%",
    display: "grid",
    gridTemplateColumns: COLUMNS,
    gap: "16px",
    alignItems: "center",
    padding: "12px 16px",
    cursor: "pointer",
    ":hover": { background: tokens.colorNeutralBackground1Hover },
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "-2px",
    },
    [NARROW]: { gridTemplateColumns: "minmax(0, 1fr) 20px" },
  },
  nameCell: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    minWidth: 0,
  },
  nameText: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0,
  },
  nameLine: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
  },
  name: {
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  sub: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  secondary: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
    [NARROW]: { display: "none" },
  },
  ellipsis: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  muted: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground3,
  },
  chevron: {
    fontSize: "14px",
    color: tokens.colorNeutralForeground3,
    transitionProperty: "transform",
    transitionDuration: tokens.durationFaster,
  },
  chevronOpen: { transform: "rotate(180deg)" },
  panel: {
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
  },
  scopeGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
    gap: "12px 24px",
    padding: "14px var(--card-pad)",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  scope: {
    display: "flex",
    gap: "8px",
    minWidth: 0,
  },
  scopeIcon: {
    flexShrink: 0,
    marginTop: "2px",
    fontSize: "16px",
    color: tokens.colorBrandForeground1,
  },
  scopeIconSite: { color: tokens.colorPaletteRedForeground1 },
  scopeText: {
    display: "flex",
    flexDirection: "column",
    gap: "1px",
    minWidth: 0,
    fontSize: tokens.fontSizeBase300,
    overflowWrap: "anywhere",
  },
  scopeDesc: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  clientId: {
    gap: "6px",
    maxWidth: "100%",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: "12px",
    color: tokens.colorNeutralForeground2,
  },
  danger: {
    color: tokens.colorPaletteRedForeground1,
    ":hover": { color: tokens.colorPaletteRedForeground1 },
    ":hover:active": { color: tokens.colorPaletteRedForeground1 },
  },
  // Sticky itself: the toast inside only sticks within this wrapper.
  toast: { position: "sticky", top: "8px", zIndex: 2, marginBottom: "12px" },
});

/** "in 5m", "3h ago", or a date once it's more than a day away. */
function formatRelative(ts: number, t: TFunction, locale?: string): string {
  const diffSec = ts - Math.floor(Date.now() / 1000);
  const absSec = Math.abs(diffSec);
  const future = diffSec >= 0;
  if (absSec < 60)
    return future
      ? t("connectedApps.inLessThanMinute")
      : t("connectedApps.justNow");
  const mins = Math.floor(absSec / 60);
  if (mins < 60)
    return future
      ? t("connectedApps.inMinutes", { count: mins })
      : t("connectedApps.minutesAgo", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24)
    return future
      ? t("connectedApps.inHours", { count: hours })
      : t("connectedApps.hoursAgo", { count: hours });
  return new Date(ts * 1000).toLocaleDateString(locale);
}

/** Only link to web pages, never javascript: or other schemes. */
function webUrl(url: string | null): URL | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

/** "Profile, Email address +2 more" */
function accessSummary(t: TFunction, scopes: string[]): string {
  const labels = scopes.map((s) => scopeLabel(t, s).label);
  const shown = labels.slice(0, 2).join(", ");
  return labels.length > 2
    ? `${shown} ${t("connectedApps.accessMore", { count: labels.length - 2 })}`
    : shown;
}

function SignInRow({
  token,
  busy,
  onSignOut,
}: {
  token: OAuthToken;
  busy: boolean;
  onSignOut: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  return (
    <SettingsRow
      icon={token.is_persistent ? <ArrowSyncRegular /> : <ClockRegular />}
      label={
        token.is_persistent
          ? t("connectedApps.rememberedSignIn")
          : t("connectedApps.temporarySignIn")
      }
      description={`${t("connectedApps.signedInAt", {
        time: formatRelative(token.created_at, t, locale),
      })} · ${t("connectedApps.endsAt", {
        time: formatRelative(token.ends_at, t, locale),
      })}`}
    >
      <Button size="small" disabled={busy} onClick={onSignOut}>
        {t("connectedApps.signOut")}
      </Button>
    </SettingsRow>
  );
}

interface DetailsProps {
  consent: OAuthConsent;
  busy: string | null;
  onSignOut: (token: OAuthToken) => void;
  onAutoAuthorizeOff: () => void;
  onRevoke: () => void;
}

function ConsentDetails({
  consent,
  busy,
  onSignOut,
  onAutoAuthorizeOff,
  onRevoke,
}: DetailsProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const name = consent.app.name;
  const website = webUrl(consent.app.website_url);

  return (
    <div className={styles.panel} id={`consent-${consent.client_id}`}>
      <SettingsSubhead>{t("connectedApps.permissionsHeading")}</SettingsSubhead>
      <div className={styles.scopeGrid}>
        {consent.scopes.map((s) => {
          const info = scopeLabel(t, s);
          return (
            <div key={s} className={styles.scope}>
              {info.site ? (
                <WarningRegular
                  className={mergeClasses(
                    styles.scopeIcon,
                    styles.scopeIconSite,
                  )}
                />
              ) : (
                <CheckmarkRegular className={styles.scopeIcon} />
              )}
              <div className={styles.scopeText}>
                <span>{info.label}</span>
                {info.desc && (
                  <span className={styles.scopeDesc}>{info.desc}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <SettingsSubhead>{t("connectedApps.signInsHeading")}</SettingsSubhead>
      {consent.tokens.length === 0 ? (
        <SettingsEmpty>{t("connectedApps.noSignIns")}</SettingsEmpty>
      ) : (
        consent.tokens.map((token) => (
          <SignInRow
            key={token.id}
            token={token}
            busy={busy !== null}
            onSignOut={() => onSignOut(token)}
          />
        ))
      )}

      {consent.auto_authorize && (
        <SettingsRow
          icon={<FlashRegular />}
          label={t("connectedApps.autoAuthorizeLabel")}
          description={t("connectedApps.autoAuthorizeDesc", { name })}
        >
          <Button
            size="small"
            disabled={busy !== null}
            onClick={onAutoAuthorizeOff}
          >
            {t("connectedApps.turnOff")}
          </Button>
        </SettingsRow>
      )}

      <SettingsFooter
        start={
          <CopyIdTrigger
            id={consent.client_id}
            label={t("common.copyClientId")}
            copiedLabel={t("common.copiedClientId")}
            className={styles.clientId}
          >
            <span>{consent.client_id}</span>
            <CopyRegular />
          </CopyIdTrigger>
        }
      >
        {website && (
          <Button
            as="a"
            href={website.href}
            target="_blank"
            rel="noopener noreferrer"
            size="small"
            appearance="subtle"
            icon={<OpenRegular />}
          >
            {t("connectedApps.visitWebsite")}
          </Button>
        )}
        <Button
          size="small"
          className={styles.danger}
          disabled={busy !== null}
          onClick={onRevoke}
        >
          {t("connectedApps.revokeAccess")}
        </Button>
      </SettingsFooter>
    </div>
  );
}

export function ConnectedApps() {
  const api = useApi();
  const styles = useStyles();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { confirm, confirmDialog } = useConfirm();
  const { message, showMsg } = useToastMessage();
  const { data: site } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });
  const siteName = site?.site_name ?? "Prism";

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  // One change at a time; holds what's being changed.
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [query]);

  const { data, isFetching } = useQuery({
    queryKey: ["consents", page, debouncedQuery],
    queryFn: () =>
      api.listConsents({
        page,
        limit: PAGE_SIZE,
        q: debouncedQuery || undefined,
      }),
  });

  const toggle = (clientId: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });

  const run = async (
    key: string,
    action: () => Promise<unknown>,
    done: string,
    failed: string,
  ) => {
    if (busy) return;
    setBusy(key);
    try {
      await action();
      await qc.invalidateQueries({ queryKey: ["consents"] });
      showMsg("success", done);
    } catch (err) {
      showMsg("error", apiErrorText(err, failed));
    } finally {
      setBusy(null);
    }
  };

  const signOut = (consent: OAuthConsent, token: OAuthToken) =>
    run(
      `token:${token.id}`,
      () => api.revokeToken(token.id),
      t("connectedApps.signedOut", { name: consent.app.name }),
      t("connectedApps.revokeFailed"),
    );

  const autoAuthorizeOff = (consent: OAuthConsent) =>
    run(
      `auto:${consent.client_id}`,
      () => api.updateConsent(consent.client_id, { auto_authorize: false }),
      t("connectedApps.autoAuthorizeOff", { name: consent.app.name }),
      t("connectedApps.disableAutoAuthorizeFailed"),
    );

  const revoke = async (consent: OAuthConsent) => {
    const name = consent.app.name;
    const ok = await confirm({
      title: t("connectedApps.revokeTitle", { name }),
      body: t("connectedApps.revokeDesc", { name }),
      confirmLabel: t("connectedApps.revokeAccess"),
    });
    if (!ok) return;
    await run(
      `consent:${consent.client_id}`,
      () => api.revokeConsent(consent.client_id),
      t("connectedApps.revoked", { name }),
      t("connectedApps.revokeFailed"),
    );
  };

  const head = (
    <div className={styles.head} aria-hidden>
      <span>{t("connectedApps.colApp")}</span>
      <span>{t("connectedApps.colAccess")}</span>
      <span>{t("connectedApps.colSignIns")}</span>
      <span>{t("connectedApps.colAuthorized")}</span>
      <span />
    </div>
  );

  const consents = data?.consents ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <PageHeader
        title={t("connectedApps.title")}
        subtitle={t("connectedApps.description")}
      />

      {message && (
        <div className={styles.toast}>
          <SettingsToast message={message} />
        </div>
      )}

      {isFetching && !data && (
        <Skeleton aria-busy>
          <div className={styles.list}>
            {head}
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className={mergeClasses(styles.item, styles.row)}>
                <div className={styles.nameCell}>
                  <SkeletonItem shape="square" size={32} />
                  <SkeletonItem
                    size={12}
                    style={{ width: `${40 + (i % 3) * 12}%` }}
                  />
                </div>
                <SkeletonItem size={12} style={{ width: "70%" }} />
                <SkeletonItem size={12} style={{ width: 48 }} />
                <SkeletonItem size={12} style={{ width: 72 }} />
                <span />
              </div>
            ))}
          </div>
        </Skeleton>
      )}

      {!isFetching && data?.consents.length === 0 && !debouncedQuery && (
        <GetStartedPanel
          art={<ConnectedAppsArt />}
          title={t("connectedApps.getStarted.title")}
          description={t("connectedApps.getStarted.desc", { siteName })}
          steps={[
            t("connectedApps.getStarted.step1", { siteName }),
            t("connectedApps.getStarted.step2"),
            t("connectedApps.getStarted.step3"),
          ]}
        />
      )}

      {/* Stays up while a search finds nothing, so it can be cleared. */}
      {data && (data.consents.length > 0 || debouncedQuery) && (
        <div className={styles.toolbar}>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("connectedApps.searchConsentsPlaceholder")}
            contentBefore={<SearchRegular />}
            contentAfter={
              query ? (
                <Button
                  appearance="transparent"
                  size="small"
                  icon={<DismissRegular />}
                  aria-label={t("common.clear")}
                  onClick={() => setQuery("")}
                />
              ) : undefined
            }
            style={{ minWidth: 220, flex: "1 1 220px" }}
          />
        </div>
      )}

      {!isFetching && data?.consents.length === 0 && debouncedQuery && (
        <EmptyState icon={<GlobeRegular />} title={t("teams.noResultsMatch")} />
      )}

      {data && consents.length > 0 && (
        <>
          <div className={styles.list}>
            {head}
            {consents.map((consent) => {
              const isOpen = open.has(consent.client_id);
              const website = webUrl(consent.app.website_url);
              const hasSite = consent.scopes.some((s) => scopeLabel(t, s).site);
              return (
                <div key={consent.client_id} className={styles.item}>
                  <button
                    type="button"
                    className={styles.row}
                    aria-expanded={isOpen}
                    aria-controls={`consent-${consent.client_id}`}
                    onClick={() => toggle(consent.client_id)}
                  >
                    <div className={styles.nameCell}>
                      <Avatar
                        image={
                          consent.app.icon_url
                            ? { src: consent.app.icon_url }
                            : undefined
                        }
                        name={consent.app.name}
                        size={32}
                        shape="square"
                      />
                      <div className={styles.nameText}>
                        <div className={styles.nameLine}>
                          <span className={styles.name}>
                            {consent.app.name}
                          </span>
                          {consent.app.is_verified && (
                            <Badge
                              appearance="outline"
                              color="success"
                              size="small"
                            >
                              {t("connectedApps.verified")}
                            </Badge>
                          )}
                        </div>
                        {(website || consent.app.description) && (
                          <span className={styles.sub}>
                            {website?.host ?? consent.app.description}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className={styles.secondary}>
                      {hasSite && (
                        <Badge appearance="tint" color="danger" size="small">
                          {t("connectedApps.siteAccess")}
                        </Badge>
                      )}
                      <span className={styles.ellipsis}>
                        {accessSummary(t, consent.scopes)}
                      </span>
                    </div>
                    <div className={styles.secondary}>
                      <span className={styles.muted}>
                        {consent.tokens.length > 0
                          ? t("connectedApps.signInsCount", {
                              count: consent.tokens.length,
                            })
                          : "—"}
                      </span>
                    </div>
                    <div className={styles.secondary}>
                      <span className={styles.muted}>
                        {formatDate(consent.granted_at)}
                      </span>
                    </div>
                    <ChevronDownRegular
                      className={mergeClasses(
                        styles.chevron,
                        isOpen && styles.chevronOpen,
                      )}
                    />
                  </button>
                  {isOpen && (
                    <ConsentDetails
                      consent={consent}
                      busy={busy}
                      onSignOut={(token) => signOut(consent, token)}
                      onAutoAuthorizeOff={() => autoAuthorizeOff(consent)}
                      onRevoke={() => revoke(consent)}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {(data.total > PAGE_SIZE || page > 1) && (
            <Pagination
              page={page}
              pageCount={Math.max(1, Math.ceil((data.total || 0) / PAGE_SIZE))}
              total={data.total}
              onChange={setPage}
              disabled={isFetching}
            />
          )}
        </>
      )}

      {confirmDialog}
    </div>
  );
}
